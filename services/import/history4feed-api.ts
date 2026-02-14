import { db } from "../../db/client";
import { blogs, articles, articleTags, importJobs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ReadingSpeed } from "../../constants/theme";
import { generateId, stripHtml, countWords, type ProgressCallback } from "./utils";

type H4FFeed = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  count_of_posts?: number;
  earliest_item_pubdate?: string;
  latest_item_pubdate?: string;
};

type H4FPost = {
  id: string;
  title: string;
  description: string;
  link: string;
  pubdate: string;
  author: string | null;
  categories: string[];
  is_full_text: boolean;
};

type H4FPaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/**
 * List available feeds on a History4Feed instance.
 */
export async function listFeeds(baseUrl: string): Promise<H4FFeed[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/feeds/`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch feeds: ${response.status}`);

  const data: H4FPaginatedResponse<H4FFeed> = await response.json();
  return data.results;
}

/**
 * Import all posts from a History4Feed instance for a specific feed.
 */
export async function importFromHistory4Feed(
  baseUrl: string,
  feedId: string,
  onProgress?: ProgressCallback
): Promise<string | null> {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const blogId = generateId();
  const jobId = generateId();
  const now = new Date().toISOString();

  // Step 1: Get feed metadata
  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Fetching feed info..." });

  const feedResponse = await fetch(`${normalizedBase}/api/v1/feeds/${feedId}/`);
  if (!feedResponse.ok) throw new Error(`Failed to fetch feed: ${feedResponse.status}`);
  const feed: H4FFeed = await feedResponse.json();

  await db.insert(blogs).values({
    id: blogId,
    title: feed.title,
    description: feed.description,
    feedUrl: feed.url,
    importedAt: now,
    importSource: "history4feed",
  });

  await db.insert(importJobs).values({
    id: jobId,
    blogId,
    source: "history4feed",
    state: "running",
    phase: "metadata",
    startedAt: now,
  });

  // Step 2: Paginate through all posts
  let page = 1;
  const pageSize = 500;
  let totalPosts = 0;
  let imported = 0;

  let nextUrl: string | null =
    `${normalizedBase}/api/v1/feeds/${feedId}/posts/?page=${page}&page_size=${pageSize}`;

  while (nextUrl) {
    onProgress?.({
      phase: "metadata",
      total: totalPosts,
      imported,
      message: `Fetching page ${page}...`,
      blogTitle: feed.title,
    });

    const response = await fetch(nextUrl);
    if (!response.ok) break;

    const data: H4FPaginatedResponse<H4FPost> = await response.json();
    totalPosts = data.count;
    nextUrl = data.next;

    db.$client.execSync("BEGIN TRANSACTION");
    try {
      for (const post of data.results) {
        const articleId = generateId();
        const contentHtml = post.description;
        const contentText = stripHtml(contentHtml);
        const words = countWords(contentText);

        db.$client.runSync(
          `INSERT OR IGNORE INTO articles (id, blog_id, title, link, author, pubdate, content_html, content_text, word_count, reading_time_minutes, is_full_text, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            articleId,
            blogId,
            post.title,
            post.link,
            post.author,
            post.pubdate,
            contentHtml,
            contentText,
            words,
            Math.ceil(words / ReadingSpeed.wordsPerMinute),
            post.is_full_text ? 1 : 0,
            now,
          ]
        );

        for (const tag of post.categories) {
          db.$client.runSync(
            `INSERT INTO article_tags (article_id, tag) VALUES (?, ?)`,
            [articleId, tag]
          );
        }

        if (contentText) {
          db.$client.runSync(
            `INSERT INTO articles_fts (rowid, title, content_text)
             SELECT rowid, title, content_text FROM articles WHERE id = ?`,
            [articleId]
          );
        }

        imported++;
      }
      db.$client.execSync("COMMIT");
    } catch (err) {
      db.$client.execSync("ROLLBACK");
      console.error("Batch import error:", err);
    }

    onProgress?.({
      phase: "metadata",
      total: totalPosts,
      imported,
      message: `Imported ${imported}/${totalPosts} articles.`,
    });

    page++;
  }

  // Update blog metadata
  const countResult = db.$client.getFirstSync(
    `SELECT COUNT(*) as count, MIN(pubdate) as earliest, MAX(pubdate) as latest
     FROM articles WHERE blog_id = ?`,
    [blogId]
  ) as { count: number; earliest: string | null; latest: string | null } | null;

  const totalWords = db.$client.getFirstSync(
    `SELECT COALESCE(SUM(word_count), 0) as total FROM articles WHERE blog_id = ?`,
    [blogId]
  ) as { total: number } | null;

  await db
    .update(blogs)
    .set({
      postCount: countResult?.count ?? 0,
      earliestDate: countResult?.earliest,
      latestDate: countResult?.latest,
      totalWordCount: totalWords?.total ?? 0,
    })
    .where(eq(blogs.id, blogId));

  await db
    .update(importJobs)
    .set({
      state: "completed",
      totalItems: totalPosts,
      importedItems: imported,
      completedAt: new Date().toISOString(),
    })
    .where(eq(importJobs.id, jobId));

  onProgress?.({
    phase: "metadata",
    total: totalPosts,
    imported,
    message: `Import complete! ${imported} articles imported.`,
  });

  return blogId;
}
