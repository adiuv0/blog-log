import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { blogs, articles, readingProgress } from "../db/schema";
import { eq, sql, count } from "drizzle-orm";

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
      await db.delete(blogs).where(eq(blogs.id, blogId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogs"] });
    },
  });
}
