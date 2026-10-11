/**
 * Shared blog persistence for the importers: re-importing a feed merges new
 * posts into the existing blog instead of creating a duplicate.
 */

import { db } from "../../db/client";
import { logger } from "../logger";
import { feedKey } from "./normalize";
import { generateId } from "./utils";

export type BlogMeta = {
  title: string;
  description: string | null;
  feedUrl: string | null;
  siteUrl: string | null;
  importSource: "wayback" | "history4feed" | "json_file";
};

/**
 * Find an existing blog with the same feed URL, or create a new one.
 * Returns the blog id and whether it already existed.
 */
export function findOrCreateBlog(meta: BlogMeta): { blogId: string; existing: boolean } {
  if (meta.feedUrl) {
    const key = feedKey(meta.feedUrl);
    const candidates = db.$client.getAllSync(
      `SELECT id, feed_url FROM blogs WHERE feed_url IS NOT NULL`
    ) as Array<{ id: string; feed_url: string }>;
    const match = candidates.find((b) => feedKey(b.feed_url) === key);
    if (match) {
      logger.info("BlogStore", `Merging import into existing blog ${match.id} (${meta.feedUrl})`);
      return { blogId: match.id, existing: true };
    }
  }

  const blogId = generateId();
  db.$client.runSync(
    `INSERT INTO blogs (id, title, description, feed_url, site_url, imported_at, import_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      blogId,
      meta.title,
      meta.description,
      meta.feedUrl,
      meta.siteUrl,
      new Date().toISOString(),
      meta.importSource,
    ]
  );
  return { blogId, existing: false };
}

/**
 * Recompute a blog's post count, date range and word total from its articles.
 */
export function refreshBlogStats(blogId: string): { count: number } {
  const stats = db.$client.getFirstSync(
    `SELECT COUNT(*) as count, MIN(pubdate) as earliest, MAX(pubdate) as latest,
            COALESCE(SUM(word_count), 0) as words
     FROM articles WHERE blog_id = ?`,
    [blogId]
  ) as { count: number; earliest: string | null; latest: string | null; words: number } | null;

  db.$client.runSync(
    `UPDATE blogs SET post_count = ?, earliest_date = ?, latest_date = ?, total_word_count = ?
     WHERE id = ?`,
    [stats?.count ?? 0, stats?.earliest ?? null, stats?.latest ?? null, stats?.words ?? 0, blogId]
  );
  return { count: stats?.count ?? 0 };
}
