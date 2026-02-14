import * as rssParser from "react-native-rss-parser";
import { db } from "../../db/client";
import { blogs, articles, articleTags, importJobs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ReadingSpeed } from "../../constants/theme";
import { logger } from "../logger";
import {
  generateId,
  stripHtml,
  countWords,
  sleep,
  type ProgressCallback,
} from "./utils";

const CDX_API_BASE = "https://web.archive.org/cdx/search/cdx";
const WAYBACK_BASE = "https://web.archive.org/web";
const RATE_LIMIT_MS = 1100; // ~1 req/sec, safely under 60/min

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
        logger.warn("WaybackFetch", `Rate limited, backing off ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) {
        logger.warn("WaybackFetch", `fetch ${url} returned ${response.status}`);
        return null;
      }
      return response;
    } catch (err) {
      logger.warn("WaybackFetch", `fetch attempt ${attempt + 1} failed for ${url}`, err instanceof Error ? err.message : String(err));
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
    logger.warn("WaybackFetch", "RSS parse error", err instanceof Error ? err.message : String(err));
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
 * Detect if a feed URL is from a platform that supports pagination.
 * Returns the base URL for pagination, or null if not paginated.
 */
function detectPaginatedFeed(feedUrl: string): { type: "substack" | "wordpress"; baseUrl: string } | null {
  const url = feedUrl.toLowerCase();

  // Substack feeds: *.substack.com/feed or known Substack custom domains
  if (url.includes("substack.com/feed") || url.includes(".substack.com/")) {
    // Base is everything before any query params
    const base = feedUrl.split("?")[0];
    return { type: "substack", baseUrl: base };
  }

  // WordPress feeds: /feed/ or ?feed=rss2 — support ?paged=N
  if (url.includes("/feed") && !url.includes("substack")) {
    const base = feedUrl.split("?")[0];
    return { type: "wordpress", baseUrl: base };
  }

  // Check for custom domain Substack by looking at feed content structure
  // (handled at call site after fetching first page)
  return null;
}

/**
 * Detect if a feed is Substack by examining its content.
 * Substack feeds have specific patterns in their XML.
 */
function isSubstackFeedContent(feedText: string): boolean {
  return feedText.includes("substack.com") ||
    feedText.includes("substackcdn.com") ||
    feedText.includes("<generator>Substack</generator>");
}

/**
 * Fetch all pages of a paginated RSS feed.
 * Substack uses ?page=N, WordPress uses ?paged=N.
 * Returns all discovered posts and the feed metadata from page 1.
 */
async function fetchPaginatedFeed(
  feedUrl: string,
  onProgress?: ProgressCallback,
): Promise<{
  title: string;
  description: string | null;
  siteUrl: string | null;
  items: DiscoveredPost[];
} | null> {
  logger.info("WaybackFetch", `Fetching paginated feed: ${feedUrl}`);

  // Fetch page 1
  const response = await fetchWithRetry(feedUrl);
  if (!response) return null;

  let firstPageText: string;
  try {
    firstPageText = await response.text();
  } catch {
    return null;
  }

  // Verify it's XML
  const trimmed = firstPageText.trimStart();
  if (
    !trimmed.startsWith("<?xml") &&
    !trimmed.startsWith("<rss") &&
    !trimmed.startsWith("<feed") &&
    !trimmed.startsWith("<!DOCTYPE")
  ) {
    logger.warn("WaybackFetch", "Feed response does not look like XML", trimmed.substring(0, 200));
    return null;
  }

  const firstFeed = await safeParseFeed(firstPageText);
  if (!firstFeed) return null;

  const firstItems = extractPostsFromFeed(firstFeed);
  logger.info("WaybackFetch", `Page 1: ${firstItems.length} items`);

  if (firstItems.length === 0) {
    return {
      title: firstFeed.title ?? "Unknown Blog",
      description: firstFeed.description ?? null,
      siteUrl: firstFeed.links?.[0]?.url ?? null,
      items: [],
    };
  }

  // Detect pagination type
  let pagination = detectPaginatedFeed(feedUrl);

  // If no pagination detected by URL, check feed content for Substack
  if (!pagination && isSubstackFeedContent(firstPageText)) {
    const base = feedUrl.split("?")[0];
    pagination = { type: "substack", baseUrl: base };
    logger.info("WaybackFetch", "Detected Substack feed from content");
  }

  const allItems: DiscoveredPost[] = [...firstItems];
  const seenLinks = new Set(firstItems.map((p) => p.link));

  if (pagination) {
    logger.info("WaybackFetch", `Feed type: ${pagination.type}, will paginate`);

    // Paginate through remaining pages
    const MAX_PAGES = 100; // Safety limit
    let page = 2;
    let consecutiveEmpty = 0;

    while (page <= MAX_PAGES && consecutiveEmpty < 2) {
      const pageParam = pagination.type === "wordpress" ? "paged" : "page";
      const separator = pagination.baseUrl.includes("?") ? "&" : "?";
      const pageUrl = `${pagination.baseUrl}${separator}${pageParam}=${page}`;

      logger.debug("WaybackFetch", `Fetching page ${page}: ${pageUrl}`);

      onProgress?.({
        phase: "metadata",
        total: 0,
        imported: allItems.length,
        message: `Fetching feed page ${page}... (${allItems.length} posts found so far)`,
      });

      const pageResponse = await fetchWithRetry(pageUrl, 2);
      if (!pageResponse) {
        logger.info("WaybackFetch", `Page ${page} returned no response, stopping pagination`);
        break;
      }

      try {
        const pageText = await pageResponse.text();

        // Check if we got a valid feed (not an HTML error page)
        const pageTrimmed = pageText.trimStart();
        if (
          !pageTrimmed.startsWith("<?xml") &&
          !pageTrimmed.startsWith("<rss") &&
          !pageTrimmed.startsWith("<feed")
        ) {
          logger.info("WaybackFetch", `Page ${page} is not XML, stopping pagination`);
          break;
        }

        const pageFeed = await safeParseFeed(pageText);
        if (!pageFeed || !pageFeed.items || pageFeed.items.length === 0) {
          logger.info("WaybackFetch", `Page ${page} has no items, stopping pagination`);
          consecutiveEmpty++;
          page++;
          await sleep(500);
          continue;
        }

        const pageItems = extractPostsFromFeed(pageFeed);
        let newItems = 0;

        for (const item of pageItems) {
          if (item.link && !seenLinks.has(item.link)) {
            seenLinks.add(item.link);
            allItems.push(item);
            newItems++;
          }
        }

        logger.debug("WaybackFetch", `Page ${page}: ${pageItems.length} items, ${newItems} new`);

        if (newItems === 0) {
          consecutiveEmpty++;
        } else {
          consecutiveEmpty = 0;
        }
      } catch (err) {
        logger.warn("WaybackFetch", `Page ${page} parse error`, err instanceof Error ? err.message : String(err));
        consecutiveEmpty++;
      }

      page++;
      await sleep(500); // Small delay between pages
    }

    logger.info("WaybackFetch", `Pagination complete: ${allItems.length} total posts from ${page - 1} pages`);
  }

  return {
    title: firstFeed.title ?? "Unknown Blog",
    description: firstFeed.description ?? null,
    siteUrl: firstFeed.links?.[0]?.url ?? null,
    items: allItems,
  };
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

  logger.info("WaybackImport", `Starting import for: ${normalizedUrl}`);

  const blogId = generateId();
  const jobId = generateId();
  const now = new Date().toISOString();

  // Step 1: Fetch current feed for metadata (with pagination support)
  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Fetching current feed..." });

  let currentFeed: Awaited<ReturnType<typeof fetchPaginatedFeed>> = null;
  try {
    currentFeed = await fetchPaginatedFeed(normalizedUrl, onProgress);
  } catch (err) {
    logger.error("WaybackImport", "fetchPaginatedFeed threw", err instanceof Error ? err.message : String(err));
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

  logger.info("WaybackImport", `Feed "${currentFeed.title}": ${currentFeed.items.length} posts from live feed`);

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
    logger.error("WaybackImport", "Failed to insert blog", err instanceof Error ? err.message : String(err));
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
    logger.warn("WaybackImport", "Failed to create import job (non-fatal)", err instanceof Error ? err.message : String(err));
  }

  // Step 2: Discover additional posts from Wayback CDX
  onProgress?.({
    phase: "metadata",
    total: 0,
    imported: 0,
    message: "Querying Wayback Machine for historical snapshots...",
    blogTitle: currentFeed.title,
  });

  let snapshots: string[] = [];
  try {
    snapshots = await fetchCdxSnapshots(normalizedUrl);
    logger.info("WaybackImport", `CDX returned ${snapshots.length} snapshots for ${normalizedUrl}`);
  } catch (err) {
    logger.warn("WaybackImport", "CDX snapshot fetch failed (non-fatal)", err instanceof Error ? err.message : String(err));
  }

  const allPosts = new Map<string, DiscoveredPost>();

  // Add current feed posts first (these are the most authoritative)
  for (const item of currentFeed.items) {
    if (item.link) {
      allPosts.set(item.link, item);
    }
  }

  // Process each historical snapshot to find older posts
  if (snapshots.length > 0) {
    // Limit to at most 30 snapshots (spread evenly) to avoid rate limiting
    let selectedSnapshots = snapshots;
    if (snapshots.length > 30) {
      const step = Math.floor(snapshots.length / 30);
      selectedSnapshots = [];
      for (let i = 0; i < snapshots.length; i += step) {
        selectedSnapshots.push(snapshots[i]);
      }
      // Always include the oldest and newest
      if (!selectedSnapshots.includes(snapshots[0])) selectedSnapshots.unshift(snapshots[0]);
      if (!selectedSnapshots.includes(snapshots[snapshots.length - 1])) selectedSnapshots.push(snapshots[snapshots.length - 1]);
      logger.info("WaybackImport", `Sampled ${selectedSnapshots.length} snapshots from ${snapshots.length}`);
    }

    onProgress?.({
      phase: "metadata",
      total: selectedSnapshots.length,
      imported: 0,
      message: `Found ${selectedSnapshots.length} archived snapshots. Discovering older posts...`,
    });

    for (let i = 0; i < selectedSnapshots.length; i++) {
      try {
        const posts = await fetchFeedSnapshot(normalizedUrl, selectedSnapshots[i]);
        let newFromSnapshot = 0;
        for (const post of posts) {
          if (post.link && !allPosts.has(post.link)) {
            allPosts.set(post.link, post);
            newFromSnapshot++;
          }
        }
        if (newFromSnapshot > 0) {
          logger.debug("WaybackImport", `Snapshot ${i + 1}: ${newFromSnapshot} new posts`);
        }
      } catch (err) {
        logger.warn("WaybackImport", `Snapshot ${i} parse error`, err instanceof Error ? err.message : String(err));
      }

      onProgress?.({
        phase: "metadata",
        total: selectedSnapshots.length,
        imported: i + 1,
        message: `Processed ${i + 1}/${selectedSnapshots.length} snapshots. Found ${allPosts.size} unique posts.`,
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

  logger.info("WaybackImport", `Total unique posts discovered: ${allPosts.size}`);

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
      logger.error("WaybackImport", "Batch import error", err instanceof Error ? err.message : String(err));
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

    logger.info("WaybackImport", `Blog "${currentFeed.title}" updated: ${countResult?.count ?? 0} articles, ${totalWords?.total ?? 0} words`);
  } catch (err) {
    logger.error("WaybackImport", "Failed to update blog metadata", err instanceof Error ? err.message : String(err));
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
    logger.warn("WaybackImport", "Failed to update import job", err instanceof Error ? err.message : String(err));
  }

  onProgress?.({
    phase: "metadata",
    total: posts.length,
    imported,
    message: `Import complete! ${imported} articles imported.`,
  });

  logger.info("WaybackImport", `Import complete for "${currentFeed.title}": ${imported} articles`);

  return blogId;
}
