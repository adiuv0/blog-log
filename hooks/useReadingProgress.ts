import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { readingProgress, readingSessions } from "../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../services/logger";
import type { ReadingStatus } from "./useArticles";

export function useUpdateReadingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      articleId,
      status,
    }: {
      articleId: string;
      status: ReadingStatus;
    }) => {
      logger.debug("ReadingProgress", `Updating status for ${articleId} to ${status}`);
      const now = new Date().toISOString();

      try {
        const existing = await db
          .select()
          .from(readingProgress)
          .where(eq(readingProgress.articleId, articleId))
          .get();

        if (existing) {
          await db
            .update(readingProgress)
            .set({
              status,
              startedAt:
                status === "in_progress" && !existing.startedAt
                  ? now
                  : existing.startedAt,
              completedAt: status === "read" ? now : null,
            })
            .where(eq(readingProgress.articleId, articleId));
        } else {
          await db.insert(readingProgress).values({
            articleId,
            status,
            startedAt: status !== "unread" ? now : null,
            completedAt: status === "read" ? now : null,
          });
        }
        logger.debug("ReadingProgress", `Status updated successfully for ${articleId}`);
      } catch (err) {
        logger.error("ReadingProgress", `Failed to update status for ${articleId}`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["blogs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      logger.error("ReadingProgress", "Mutation onError", err instanceof Error ? err.message : String(err));
    },
  });
}

export function useCycleReadingStatus() {
  const updateStatus = useUpdateReadingStatus();

  return {
    cycle: (articleId: string, currentStatus: ReadingStatus) => {
      const nextStatus: ReadingStatus =
        currentStatus === "unread"
          ? "in_progress"
          : currentStatus === "in_progress"
          ? "read"
          : "unread";

      updateStatus.mutate({ articleId, status: nextStatus });
    },
    ...updateStatus,
  };
}

export function useStartReadingSession() {
  return useMutation({
    mutationFn: async (articleId: string): Promise<number | undefined> => {
      logger.debug("ReadingSession", `Starting session for ${articleId}`);
      const now = new Date().toISOString();

      try {
        // Use raw SQL instead of .returning() which may not work with Expo SQLite
        db.$client.runSync(
          `INSERT INTO reading_sessions (article_id, started_at) VALUES (?, ?)`,
          [articleId, now]
        );

        const lastRow = db.$client.getFirstSync(
          `SELECT last_insert_rowid() as id`
        ) as { id: number } | null;

        const sessionId = lastRow?.id;
        logger.info("ReadingSession", `Session started: ${sessionId} for article ${articleId}`);
        return sessionId ?? undefined;
      } catch (err) {
        logger.error("ReadingSession", `Failed to start session for ${articleId}`, err instanceof Error ? err.message : String(err));
        // Don't rethrow — session tracking is non-critical, shouldn't crash the app
        return undefined;
      }
    },
    onError: (err) => {
      logger.error("ReadingSession", "startSession mutation onError", err instanceof Error ? err.message : String(err));
    },
  });
}

export function useEndReadingSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: number) => {
      logger.debug("ReadingSession", `Ending session ${sessionId}`);
      const now = new Date().toISOString();

      try {
        const session = await db
          .select()
          .from(readingSessions)
          .where(eq(readingSessions.id, sessionId))
          .get();

        if (session?.startedAt) {
          const durationSeconds = Math.floor(
            (new Date(now).getTime() - new Date(session.startedAt).getTime()) /
              1000
          );
          await db
            .update(readingSessions)
            .set({ endedAt: now, durationSeconds })
            .where(eq(readingSessions.id, sessionId));
          logger.info("ReadingSession", `Session ${sessionId} ended, duration: ${durationSeconds}s`);
        }
      } catch (err) {
        logger.error("ReadingSession", `Failed to end session ${sessionId}`, err instanceof Error ? err.message : String(err));
        // Don't rethrow — non-critical
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      logger.error("ReadingSession", "endSession mutation onError", err instanceof Error ? err.message : String(err));
    },
  });
}
