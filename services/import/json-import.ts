import * as FileSystem from "expo-file-system";
import { db } from "../../db/client";
import { importJobs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ReadingSpeed } from "../../constants/theme";
import { findOrCreateBlog, refreshBlogStats } from "./blog-store";
import { normalizePubdate } from "./normalize";
import { generateId, stripHtml, countWords, type ProgressCallback } from "./utils";

/**
 * Expected JSON format: History4Feed API response format
 * Either a single paginated response or an array of responses:
 * {
 *   "count": number,
 *   "results": [{ id, title, description, link, pubdate, author, categories, is_full_text }]
 * }
 *
 * Or a Blog Log export format:
 * {
 *   "blog": { title, description, feedUrl, siteUrl },
 *   "articles": [{ title, link, pubdate, author, categories, contentHtml, contentText }]
 * }
 */
type H4FJsonFormat = {
  count?: number;
  results?: Array<{
    id?: string;
    title: string;
    description?: string;
    link: string;
    pubdate?: string;
    author?: string | null;
    categories?: string[];
    is_full_text?: boolean;
  }>;
  // Blog Log export format
  blog?: {
    title: string;
    description?: string;
    feedUrl?: string;
    siteUrl?: string;
  };
  articles?: Array<{
    title: string;
    link: string;
    pubdate?: string;
    author?: string | null;
    categories?: string[];
    contentHtml?: string;
    contentText?: string;
  }>;
};

export async function importFromJsonFile(
  fileUri: string,
  onProgress?: ProgressCallback
): Promise<string | null> {
  const jobId = generateId();
  const now = new Date().toISOString();

  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Reading file..." });

  const content = await FileSystem.readAsStringAsync(fileUri);
  const data: H4FJsonFormat = JSON.parse(content);

  // Determine format
  let blogTitle = "Imported Blog";
  let blogDescription: string | null = null;
  let feedUrl: string | null = null;
  let siteUrl: string | null = null;
  let posts: Array<{
    title: string;
    link: string;
    pubdate?: string;
    author?: string | null;
    categories?: string[];
    contentHtml?: string;
    contentText?: string;
  }> = [];

  if (data.blog && data.articles) {
    // Blog Log export format
    blogTitle = data.blog.title;
    blogDescription = data.blog.description ?? null;
    feedUrl = data.blog.feedUrl ?? null;
    siteUrl = data.blog.siteUrl ?? null;
    posts = data.articles;
  } else if (data.results) {
    // History4Feed paginated format
    blogTitle = "Imported Blog";
    posts = data.results.map((r) => ({
      title: r.title,
      link: r.link,
      pubdate: r.pubdate,
      author: r.author,
      categories: r.categories,
      contentHtml: r.description,
    }));
  } else {
    throw new Error("Unrecognized JSON format. Expected History4Feed or Blog Log export format.");
  }

  const { blogId } = findOrCreateBlog({
    title: blogTitle,
    description: blogDescription,
    feedUrl,
    siteUrl,
    importSource: "json_file",
  });

  await db.insert(importJobs).values({
    id: jobId,
    blogId,
    source: "json_file",
    state: "running",
    phase: "metadata",
    startedAt: now,
  });

  onProgress?.({
    phase: "metadata",
    total: posts.length,
    imported: 0,
    message: `Found ${posts.length} articles. Importing...`,
    blogTitle: blogTitle,
  });

  let imported = 0;
  const batchSize = 50;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);

    let insertedInBatch = 0;
    db.$client.execSync("BEGIN TRANSACTION");
    try {
      for (const post of batch) {
        const articleId = generateId();
        const contentText = post.contentText ?? (post.contentHtml ? stripHtml(post.contentHtml) : null);
        const words = contentText ? countWords(contentText) : 0;

        const result = db.$client.runSync(
          `INSERT OR IGNORE INTO articles (id, blog_id, title, link, author, pubdate, content_html, content_text, word_count, reading_time_minutes, is_full_text, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            articleId,
            blogId,
            post.title,
            post.link,
            post.author ?? null,
            normalizePubdate(post.pubdate),
            post.contentHtml ?? null,
            contentText,
            words,
            Math.ceil(words / ReadingSpeed.wordsPerMinute),
            contentText && contentText.length > 200 ? 1 : 0,
            now,
          ]
        );

        // Already in the library (same blog + link)
        if (result.changes === 0) continue;
        insertedInBatch++;

        for (const tag of post.categories ?? []) {
          db.$client.runSync(
            `INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)`,
            [articleId, tag]
          );
        }
      }
      db.$client.execSync("COMMIT");
      imported += insertedInBatch;
    } catch (err) {
      db.$client.execSync("ROLLBACK");
      console.error("Batch import error:", err);
    }

    onProgress?.({
      phase: "metadata",
      total: posts.length,
      imported,
      message: `Imported ${imported}/${posts.length} articles.`,
    });
  }

  // Update blog metadata
  refreshBlogStats(blogId);

  await db
    .update(importJobs)
    .set({
      state: "completed",
      totalItems: posts.length,
      importedItems: imported,
      completedAt: new Date().toISOString(),
    })
    .where(eq(importJobs.id, jobId));

  onProgress?.({
    phase: "metadata",
    total: posts.length,
    imported,
    message: `Import complete! ${imported} articles imported.`,
  });

  return blogId;
}
