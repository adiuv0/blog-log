import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { blogs, articles, readingProgress } from "../db/schema";
import { eq, sql, count } from "drizzle-orm";
import { logger } from "../services/logger";

export type BlogWithStats = {
  id: string;
  title: string;
  description: string | null;
  feedUrl: string | null;
  siteUrl: string | null;
  postCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  importedAt: string;
  importSource: string | null;
  totalWordCount: number;
  readCount: number;
  inProgressCount: number;
};

export function useBlogs() {
  return useQuery({
    queryKey: ["blogs"],
    queryFn: async (): Promise<BlogWithStats[]> => {
      const allBlogs = await db.select().from(blogs).all();

      const result: BlogWithStats[] = [];
      for (const blog of allBlogs) {
        try {
          const readCountResult = await db
            .select({ count: count() })
            .from(readingProgress)
            .innerJoin(articles, eq(readingProgress.articleId, articles.id))
            .where(
              sql`${articles.blogId} = ${blog.id} AND ${readingProgress.status} = 'read'`
            )
            .get();

          const inProgressResult = await db
            .select({ count: count() })
            .from(readingProgress)
            .innerJoin(articles, eq(readingProgress.articleId, articles.id))
            .where(
              sql`${articles.blogId} = ${blog.id} AND ${readingProgress.status} = 'in_progress'`
            )
            .get();

          result.push({
            ...blog,
            postCount: blog.postCount ?? 0,
            totalWordCount: blog.totalWordCount ?? 0,
            readCount: readCountResult?.count ?? 0,
            inProgressCount: inProgressResult?.count ?? 0,
          });
        } catch (err) {
          logger.warn("useBlogs", `Failed to get stats for blog ${blog.id}`, err instanceof Error ? err.message : String(err));
          result.push({
            ...blog,
            postCount: blog.postCount ?? 0,
            totalWordCount: blog.totalWordCount ?? 0,
            readCount: 0,
            inProgressCount: 0,
          });
        }
      }

      return result;
    },
  });
}

export function useBlog(blogId: string) {
  return useQuery({
    queryKey: ["blog", blogId],
    queryFn: async () => {
      return db.select().from(blogs).where(eq(blogs.id, blogId)).get();
    },
    enabled: !!blogId,
  });
}

export function useDeleteBlog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (blogId: string) => {
      logger.info("DeleteBlog", `Deleting blog ${blogId} and all associated data`);

      try {
        // SQLite ON DELETE CASCADE should handle articles, article_tags,
        // reading_progress, reading_sessions, article_embeddings, reading_queue.
        // But also clean up FTS and import_jobs manually for safety.

        // Delete FTS entries for articles in this blog
        db.$client.runSync(
          `DELETE FROM articles_fts WHERE rowid IN (
            SELECT rowid FROM articles WHERE blog_id = ?
          )`,
          [blogId]
        );

        // Delete import jobs
        db.$client.runSync(
          `DELETE FROM import_jobs WHERE blog_id = ?`,
          [blogId]
        );

        // Delete the blog (cascades to articles, tags, progress, sessions, etc.)
        await db.delete(blogs).where(eq(blogs.id, blogId));

        logger.info("DeleteBlog", `Blog ${blogId} deleted successfully`);
      } catch (err) {
        logger.error("DeleteBlog", `Failed to delete blog ${blogId}`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogs"] });
      queryClient.invalidateQueries({ queryKey: ["articles"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      logger.error("DeleteBlog", "Mutation onError", err instanceof Error ? err.message : String(err));
    },
  });
}
