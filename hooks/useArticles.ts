import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { articles, readingProgress, articleTags } from "../db/schema";
import { eq, sql, and, desc, asc } from "drizzle-orm";

export type ReadingStatus = "unread" | "in_progress" | "read";

export type ArticleWithProgress = {
  id: string;
  blogId: string;
  title: string;
  link: string | null;
  author: string | null;
  pubdate: string | null;
  summary: string | null;
  wordCount: number;
  readingTimeMinutes: number;
  isFullText: boolean;
  status: ReadingStatus;
  tags: string[];
};

export type SortField = "pubdate" | "title" | "reading_time_minutes";
export type SortDirection = "asc" | "desc";
export type FilterStatus = "all" | ReadingStatus;

export function useArticles(
  blogId: string,
  options?: {
    filter?: FilterStatus;
    sortField?: SortField;
    sortDirection?: SortDirection;
    searchQuery?: string;
  }
) {
  const {
    filter = "all",
    sortField = "pubdate",
    sortDirection = "desc",
    searchQuery,
  } = options ?? {};

  return useQuery({
    queryKey: ["articles", blogId, filter, sortField, sortDirection, searchQuery],
    queryFn: async (): Promise<ArticleWithProgress[]> => {
      let query: string;
      const params: (string | number | null)[] = [];

      if (searchQuery && searchQuery.trim().length > 0) {
        // FTS5 search
        query = `
          SELECT a.id, a.blog_id, a.title, a.link, a.author, a.pubdate,
                 a.summary, a.word_count, a.reading_time_minutes, a.is_full_text,
                 COALESCE(rp.status, 'unread') as status
          FROM articles a
          LEFT JOIN reading_progress rp ON a.id = rp.article_id
          JOIN articles_fts fts ON fts.rowid = a.rowid
          WHERE a.blog_id = ? AND articles_fts MATCH ?
        `;
        params.push(blogId, searchQuery.trim());
      } else {
        query = `
          SELECT a.id, a.blog_id, a.title, a.link, a.author, a.pubdate,
                 a.summary, a.word_count, a.reading_time_minutes, a.is_full_text,
                 COALESCE(rp.status, 'unread') as status
          FROM articles a
          LEFT JOIN reading_progress rp ON a.id = rp.article_id
          WHERE a.blog_id = ?
        `;
        params.push(blogId);
      }

      if (filter !== "all") {
        if (filter === "unread") {
          query += ` AND (rp.status IS NULL OR rp.status = 'unread')`;
        } else {
          query += ` AND rp.status = ?`;
          params.push(filter);
        }
      }

      const sortCol =
        sortField === "pubdate"
          ? "a.pubdate"
          : sortField === "title"
          ? "a.title"
          : "a.reading_time_minutes";
      // Push NULLs to the end regardless of sort direction
      // (e.g. articles with no pubdate go last in both "Newest" and "Oldest" modes)
      query += ` ORDER BY ${sortCol} IS NULL ASC, ${sortCol} ${sortDirection === "asc" ? "ASC" : "DESC"}`;

      const rows = db.$client.getAllSync(query, params) as Array<{
        id: string;
        blog_id: string;
        title: string;
        link: string | null;
        author: string | null;
        pubdate: string | null;
        summary: string | null;
        word_count: number;
        reading_time_minutes: number;
        is_full_text: number;
        status: string;
      }>;

      // Batch fetch tags for all articles
      const articleIds = rows.map((r) => r.id);
      const allTags =
        articleIds.length > 0
          ? (db.$client.getAllSync(
              `SELECT article_id, tag FROM article_tags WHERE article_id IN (${articleIds.map(() => "?").join(",")})`,
              articleIds
            ) as Array<{ article_id: string; tag: string }>)
          : [];

      const tagMap = new Map<string, string[]>();
      for (const t of allTags) {
        const existing = tagMap.get(t.article_id) ?? [];
        existing.push(t.tag);
        tagMap.set(t.article_id, existing);
      }

      return rows.map((row) => ({
        id: row.id,
        blogId: row.blog_id,
        title: row.title,
        link: row.link,
        author: row.author,
        pubdate: row.pubdate,
        summary: row.summary,
        wordCount: row.word_count ?? 0,
        readingTimeMinutes: row.reading_time_minutes ?? 0,
        isFullText: !!row.is_full_text,
        status: (row.status ?? "unread") as ReadingStatus,
        tags: tagMap.get(row.id) ?? [],
      }));
    },
    enabled: !!blogId,
  });
}

export function useArticleContent(articleId: string) {
  return useQuery({
    queryKey: ["article-content", articleId],
    queryFn: async () => {
      return db
        .select({
          id: articles.id,
          contentHtml: articles.contentHtml,
          contentText: articles.contentText,
          link: articles.link,
        })
        .from(articles)
        .where(eq(articles.id, articleId))
        .get();
    },
    enabled: !!articleId,
  });
}
