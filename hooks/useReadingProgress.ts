import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { readingProgress, readingSessions } from "../db/schema";
import { eq } from "drizzle-orm";
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
      const now = new Date().toISOString();
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["blogs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
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
    mutationFn: async (articleId: string) => {
      const now = new Date().toISOString();
      const result = await db
        .insert(readingSessions)
        .values({
          articleId,
          startedAt: now,
        })
        .returning({ id: readingSessions.id });
      return result[0]?.id;
    },
  });
}

export function useEndReadingSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: number) => {
      const now = new Date().toISOString();
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
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
