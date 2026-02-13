import * as rssParser from "react-native-rss-parser";
import { db } from "../../db/client";
import { blogs, articles, articleTags, importJobs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ReadingSpeed } from "../../constants/theme";

const CDX_API_BASE = "https://web.archive.org/cdx/search/cdx";
const WAYBACK_BASE = "https://web.archive.org/web";
const RATE_LIMIT_MS = 1100; // ~1 req/sec, safely under 60/min

type ImportProgress = {
  phase: "metadata" | "content" | "nlp";
  total: number;
  imported: number;
  message: string;
};

type ProgressCallback = (progress: ImportProgress) => void;

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  maxRetries = 3
): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        // Rate limited — back off exponentially
        const backoff = RATE_LIMIT_MS * Math.pow(2, attempt + 1);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) return null;
      return response;
    } catch {
      if (attempt < maxRetries - 1) {
        await sleep(RATE_LIMIT_MS * Math.pow(2, attempt));
      }
    }
  }
  return null;
}

/**
 * Fetch historical snapshots of an RSS feed from the Wayback Machine CDX API.
 * Returns an array of unique snapshot timestamps.
 */
async function fetchCdxSnapshots(feedUrl: string): Promise<string[]> {
  const params = new URLSearchParams({
    url: feedUrl,
    output: "json",
    fl: "timestamp",
    filter: "statuscode:200",
    collapse: "digest",
  });

  const response = await fetchWithRetry(`${CDX_API_BASE}?${params}`);
  if (!response) return [];

  const data = await response.json();
  if (!Array.isArray(data) || data.length < 2) return [];

  // First row is headers, rest are data
  return data.slice(1).map((row: string[]) => row[0]);
}

type DiscoveredPost = {
  title: string;
  link: string;
  pubdate: string | null;
  author: string | null;
  categories: string[];
  description: string | null;
};

/**
 * Fetch and parse an archived RSS feed snapshot to discover posts.
 */
async function fetchFeedSnapshot(
  feedUrl: string,
  timestamp: string
): Promise<DiscoveredPost[]> {
  const archiveUrl = `${WAYBACK_BASE}/${timestamp}id_/${feedUrl}`;
  const response = await fetchWithRetry(archiveUrl);
  if (!response) return [];

  try {
    const text = await response.text();
    const feed = await rssParser.parse(text);

    return feed.items.map((item) => ({
      title: item.title ?? "Untitled",
      link: item.links?.[0]?.url ?? item.id ?? "",
      pubdate: item.published ?? null,
      author: item.authors?.[0]?.name ?? null,
      categories: item.categories?.map((c) => c.name).filter(Boolean) as string[] ?? [],
      description: item.description ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch the current (live) RSS feed to get blog metadata and recent posts.
 */
async function fetchCurrentFeed(feedUrl: string) {
  const response = await fetchWithRetry(feedUrl);
  if (!response) return null;

  try {
    const text = await response.text();
    const feed = await rssParser.parse(text);
    return {
      title: feed.title ?? "Unknown Blog",
      description: feed.description ?? null,
      siteUrl: feed.links?.[0]?.url ?? null,
      items: feed.items.map((item) => ({
        title: item.title ?? "Untitled",
        link: item.links?.[0]?.url ?? item.id ?? "",
        pubdate: item.published ?? null,
        author: item.authors?.[0]?.name ?? null,
        categories: item.categories?.map((c) => c.name).filter(Boolean) as string[] ?? [],
        description: item.description ?? null,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Main import function: discovers all posts from an RSS feed using the Wayback Machine.
 * Phase 1: Metadata import (fast — title, URL, date from feed snapshots)
 * Phase 2: Content extraction (slow — full article text via fetch + readability)
 */
export async function importFromWayback(
  feedUrl: string,
  onProgress?: ProgressCallback
): Promise<string | null> {
  const blogId = generateId();
  const jobId = generateId();
  const now = new Date().toISOString();

  // Step 1: Fetch current feed for metadata
  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Fetching current feed..." });

  const currentFeed = await fetchCurrentFeed(feedUrl);
  if (!currentFeed) {
    throw new Error("Could not fetch the RSS feed. Please check the URL.");
  }

  // Create blog entry
  await db.insert(blogs).values({
    id: blogId,
    title: currentFeed.title,
    description: currentFeed.description,
    feedUrl,
    siteUrl: currentFeed.siteUrl,
    importedAt: now,
    importSource: "wayback",
  });

  // Create import job
  await db.insert(importJobs).values({
    id: jobId,
    blogId,
    source: "wayback",
    state: "running",
    phase: "metadata",
    startedAt: now,
  });

  // Step 2: Discover all posts from Wayback CDX
  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Querying Wayback Machine for historical snapshots..." });

  const snapshots = await fetchCdxSnapshots(feedUrl);
  const allPosts = new Map<string, DiscoveredPost>();

  // Add current feed posts first
  for (const item of currentFeed.items) {
    if (item.link) {
      allPosts.set(item.link, item);
    }
  }

  // Process each historical snapshot
  onProgress?.({
    phase: "metadata",
    total: snapshots.length,
    imported: 0,
    message: `Found ${snapshots.length} archived snapshots. Discovering posts...`,
  });

  for (let i = 0; i < snapshots.length; i++) {
    const posts = await fetchFeedSnapshot(feedUrl, snapshots[i]);
    for (const post of posts) {
      if (post.link && !allPosts.has(post.link)) {
        allPosts.set(post.link, post);
      }
    }

    onProgress?.({
      phase: "metadata",
      total: snapshots.length,
      imported: i + 1,
      message: `Processed ${i + 1}/${snapshots.length} snapshots. Found ${allPosts.size} unique posts.`,
    });

    await sleep(RATE_LIMIT_MS);
  }

  // Step 3: Insert all discovered posts into the database
  const posts = Array.from(allPosts.values());
  onProgress?.({
    phase: "metadata",
    total: posts.length,
    imported: 0,
    message: `Importing ${posts.length} articles...`,
  });

  let imported = 0;
  const batchSize = 50;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);

    db.$client.execSync("BEGIN TRANSACTION");
    try {
      for (const post of batch) {
        const articleId = generateId();
        const contentText = post.description ? stripHtml(post.description) : null;
        const words = contentText ? countWords(contentText) : 0;

        db.$client.runSync(
          `INSERT OR IGNORE INTO articles (id, blog_id, title, link, author, pubdate, content_text, word_count, reading_time_minutes, is_full_text, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            articleId,
            blogId,
            post.title,
            post.link,
            post.author,
            post.pubdate,
            contentText,
            words,
            Math.ceil(words / ReadingSpeed.wordsPerMinute),
            contentText && contentText.length > 200 ? 1 : 0,
            now,
          ]
        );

        // Insert tags
        for (const tag of post.categories) {
          db.$client.runSync(
            `INSERT INTO article_tags (article_id, tag) VALUES (?, ?)`,
            [articleId, tag]
          );
        }

        // Populate FTS index
        if (contentText) {
          db.$client.runSync(
            `INSERT INTO articles_fts (rowid, title, content_text)
             SELECT rowid, title, content_text FROM articles WHERE id = ?`,
            [articleId]
          );
        }
      }
      db.$client.execSync("COMMIT");
    } catch (err) {
      db.$client.execSync("ROLLBACK");
      console.error("Batch import error:", err);
    }

    imported += batch.length;
    onProgress?.({
      phase: "metadata",
      total: posts.length,
      imported,
      message: `Imported ${imported}/${posts.length} articles.`,
    });
  }

  // Update blog post count and date range
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

  // Update import job
  await db
    .update(importJobs)
    .set({
      state: "completed",
      phase: "metadata",
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
