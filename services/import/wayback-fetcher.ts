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

/**
 * Normalize a feed URL: ensure HTTPS, follow known redirects, etc.
 */
function normalizeFeedUrl(url: string): string {
  let normalized = url.trim();
  // Ensure protocol
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  // Upgrade HTTP to HTTPS for known hosts
  normalized = normalized.replace(/^http:\/\//i, "https://");
  return normalized;
}

async function fetchWithRetry(
  url: string,
  maxRetries = 3
): Promise<Response | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "BlogLog/1.0 (RSS Reader)",
          "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        redirect: "follow",
      });
      if (response.status === 429) {
        // Rate limited — back off exponentially
        const backoff = RATE_LIMIT_MS * Math.pow(2, attempt + 1);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) {
        console.warn(`[BlogLog] fetch ${url} returned ${response.status}`);
        return null;
      }
      return response;
    } catch (err) {
      console.warn(`[BlogLog] fetch attempt ${attempt + 1} failed for ${url}:`, err);
      if (attempt < maxRetries - 1) {
        await sleep(RATE_LIMIT_MS * Math.pow(2, attempt));
      }
    }
  }
  return null;
}

/**
 * Safely parse RSS/Atom feed text. Wraps react-native-rss-parser with
 * protection against oversized feeds that could crash the parser.
 */
async function safeParseFeed(text: string): Promise<rssParser.Feed | null> {
  try {
    // Limit feed text to 5MB to prevent parser OOM on huge Substack feeds
    const MAX_FEED_SIZE = 5 * 1024 * 1024;
    const feedText = text.length > MAX_FEED_SIZE ? text.substring(0, MAX_FEED_SIZE) : text;
    const feed = await rssParser.parse(feedText);
    return feed;
  } catch (err) {
    console.warn("[BlogLog] RSS parse error:", err);
    return null;
  }
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
 * Safely extract posts from a parsed feed.
 */
function extractPostsFromFeed(feed: rssParser.Feed): DiscoveredPost[] {
  if (!feed.items || !Array.isArray(feed.items)) return [];

  return feed.items
    .map((item) => {
      try {
        return {
          title: (item.title ?? "Untitled").trim(),
          link: item.links?.[0]?.url ?? item.id ?? "",
          pubdate: item.published ?? null,
          author: item.authors?.[0]?.name ?? null,
          categories:
            (item.categories
              ?.map((c) => c.name)
              .filter((n): n is string => typeof n === "string" && n.length > 0)) ?? [],
          description: item.description ?? null,
        };
      } catch {
        return null;
      }
    })
    .filter((p): p is DiscoveredPost => p !== null && p.link !== "");
}

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
    const feed = await safeParseFeed(text);
    if (!feed) return [];
    return extractPostsFromFeed(feed);
  } catch {
    return [];
  }
}

/**
 * Fetch the current (live) RSS feed to get blog metadata and recent posts.
 * Follows redirects and handles various feed formats.
 */
async function fetchCurrentFeed(feedUrl: string) {
  const response = await fetchWithRetry(feedUrl);
  if (!response) return null;

  try {
    const text = await response.text();

    // Verify we actually got XML/RSS content, not an HTML error page
    const trimmed = text.trimStart();
    if (
      !trimmed.startsWith("<?xml") &&
      !trimmed.startsWith("<rss") &&
      !trimmed.startsWith("<feed") &&
      !trimmed.startsWith("<!DOCTYPE") // some feeds start with DOCTYPE
    ) {
      // Might be an HTML redirect page or error page
      console.warn("[BlogLog] Feed response does not look like XML, first 200 chars:", trimmed.substring(0, 200));
      return null;
    }

    const feed = await safeParseFeed(text);
    if (!feed) return null;

    return {
      title: feed.title ?? "Unknown Blog",
      description: feed.description ?? null,
      siteUrl: feed.links?.[0]?.url ?? null,
      items: extractPostsFromFeed(feed),
    };
  } catch (err) {
    console.warn("[BlogLog] fetchCurrentFeed error:", err);
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
  // Normalize the URL (add protocol, upgrade to HTTPS)
  const normalizedUrl = normalizeFeedUrl(feedUrl);

  const blogId = generateId();
  const jobId = generateId();
  const now = new Date().toISOString();

  // Step 1: Fetch current feed for metadata
  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Fetching current feed..." });

  let currentFeed: Awaited<ReturnType<typeof fetchCurrentFeed>> = null;
  try {
    currentFeed = await fetchCurrentFeed(normalizedUrl);
  } catch (err) {
    console.warn("[BlogLog] fetchCurrentFeed threw:", err);
    throw new Error(
      "Could not fetch the RSS feed. Please check the URL and your internet connection."
    );
  }

  if (!currentFeed) {
    throw new Error(
      "Could not fetch or parse the RSS feed. Please check the URL is a valid RSS/Atom feed."
    );
  }

  if (currentFeed.items.length === 0) {
    throw new Error(
      "The feed was fetched but contains no articles. It may be empty or in an unsupported format."
    );
  }

  // Create blog entry
  try {
    await db.insert(blogs).values({
      id: blogId,
      title: currentFeed.title,
      description: currentFeed.description,
      feedUrl: normalizedUrl,
      siteUrl: currentFeed.siteUrl,
      importedAt: now,
      importSource: "wayback",
    });
  } catch (err) {
    console.error("[BlogLog] Failed to insert blog:", err);
    throw new Error("Failed to save blog to database.");
  }

  // Create import job
  try {
    await db.insert(importJobs).values({
      id: jobId,
      blogId,
      source: "wayback",
      state: "running",
      phase: "metadata",
      startedAt: now,
    });
  } catch (err) {
    console.error("[BlogLog] Failed to create import job:", err);
    // Non-fatal — continue without job tracking
  }

  // Step 2: Discover all posts from Wayback CDX
  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Querying Wayback Machine for historical snapshots..." });

  let snapshots: string[] = [];
  try {
    snapshots = await fetchCdxSnapshots(normalizedUrl);
  } catch (err) {
    console.warn("[BlogLog] CDX snapshot fetch failed:", err);
    // Non-fatal — continue with just the current feed posts
  }

  const allPosts = new Map<string, DiscoveredPost>();

  // Add current feed posts first
  for (const item of currentFeed.items) {
    if (item.link) {
      allPosts.set(item.link, item);
    }
  }

  // Process each historical snapshot
  if (snapshots.length > 0) {
    onProgress?.({
      phase: "metadata",
      total: snapshots.length,
      imported: 0,
      message: `Found ${snapshots.length} archived snapshots. Discovering posts...`,
    });

    for (let i = 0; i < snapshots.length; i++) {
      try {
        const posts = await fetchFeedSnapshot(normalizedUrl, snapshots[i]);
        for (const post of posts) {
          if (post.link && !allPosts.has(post.link)) {
            allPosts.set(post.link, post);
          }
        }
      } catch (err) {
        console.warn(`[BlogLog] Snapshot ${i} parse error:`, err);
        // Continue with other snapshots
      }

      onProgress?.({
        phase: "metadata",
        total: snapshots.length,
        imported: i + 1,
        message: `Processed ${i + 1}/${snapshots.length} snapshots. Found ${allPosts.size} unique posts.`,
      });

      await sleep(RATE_LIMIT_MS);
    }
  } else {
    onProgress?.({
      phase: "metadata",
      total: 0,
      imported: 0,
      message: `No Wayback snapshots found. Importing ${allPosts.size} posts from current feed...`,
    });
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

        // Safely extract content text from description
        let contentText: string | null = null;
        try {
          contentText = post.description ? stripHtml(post.description) : null;
        } catch {
          contentText = null;
        }

        const words = contentText ? countWords(contentText) : 0;

        db.$client.runSync(
          `INSERT OR IGNORE INTO articles (id, blog_id, title, link, author, pubdate, content_text, word_count, reading_time_minutes, is_full_text, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            articleId,
            blogId,
            post.title || "Untitled",
            post.link,
            post.author ?? null,
            post.pubdate ?? null,
            contentText,
            words,
            Math.max(1, Math.ceil(words / ReadingSpeed.wordsPerMinute)),
            contentText && contentText.length > 200 ? 1 : 0,
            now,
          ]
        );

        // Insert tags (each in its own try-catch so one bad tag doesn't kill the batch)
        for (const tag of post.categories) {
          try {
            db.$client.runSync(
              `INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)`,
              [articleId, tag]
            );
          } catch {
            // Skip bad tag
          }
        }

        // Populate FTS index
        if (contentText) {
          try {
            db.$client.runSync(
              `INSERT INTO articles_fts (rowid, title, content_text)
               SELECT rowid, title, content_text FROM articles WHERE id = ?`,
              [articleId]
            );
          } catch {
            // FTS insert failure is non-fatal
          }
        }
      }
      db.$client.execSync("COMMIT");
    } catch (err) {
      try {
        db.$client.execSync("ROLLBACK");
      } catch {
        // Rollback failed — DB state might be inconsistent
      }
      console.error("[BlogLog] Batch import error:", err);
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
  try {
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
  } catch (err) {
    console.error("[BlogLog] Failed to update blog metadata:", err);
  }

  // Update import job
  try {
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
  } catch (err) {
    console.error("[BlogLog] Failed to update import job:", err);
  }

  onProgress?.({
    phase: "metadata",
    total: posts.length,
    imported,
    message: `Import complete! ${imported} articles imported.`,
  });

  return blogId;
}
