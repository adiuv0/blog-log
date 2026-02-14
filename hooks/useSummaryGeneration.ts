import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { logger } from "../services/logger";
import { summarize } from "../services/nlp/textrank";

/**
 * Background hook that generates TextRank summaries for articles that don't have one.
 * Runs after import, yielding to the event loop to avoid blocking UI.
 */
export function useSummaryGeneration(blogId: string | undefined) {
  const queryClient = useQueryClient();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!blogId || runningRef.current) return;

    const run = async () => {
      runningRef.current = true;

      try {
        // Find articles without summaries that have content
        const pending = db.$client.getAllSync(
          `SELECT id, content_text FROM articles
           WHERE blog_id = ? AND summary IS NULL AND content_text IS NOT NULL AND length(content_text) > 100`,
          [blogId]
        ) as Array<{ id: string; content_text: string }>;

        if (pending.length === 0) return;

        logger.debug("SummaryGen", `Generating summaries for ${pending.length} articles in blog ${blogId}`);

        let generated = 0;
        for (let i = 0; i < pending.length; i++) {
          const article = pending[i];

          try {
            const summary = summarize(article.content_text);

            db.$client.runSync(
              `UPDATE articles SET summary = ? WHERE id = ?`,
              [summary, article.id]
            );
            generated++;
          } catch (err) {
            logger.warn("SummaryGen", `Failed to generate summary for article ${article.id}`, err instanceof Error ? err.message : String(err));
            // Continue with next article
          }

          // Yield every 10 articles
          if (i % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        logger.info("SummaryGen", `Generated ${generated}/${pending.length} summaries for blog ${blogId}`);

        // Invalidate article queries to show summaries
        queryClient.invalidateQueries({ queryKey: ["articles", blogId] });
      } catch (err) {
        logger.error("SummaryGen", `Summary generation failed for blog ${blogId}`, err instanceof Error ? err.message : String(err));
      } finally {
        runningRef.current = false;
      }
    };

    // Delay slightly to let the UI render first
    const timer = setTimeout(run, 2000);
    return () => clearTimeout(timer);
  }, [blogId, queryClient]);
}
