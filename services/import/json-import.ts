import * as FileSystem from "expo-file-system";
import { db } from "../../db/client";
import { blogs, articles, articleTags, importJobs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { ReadingSpeed } from "../../constants/theme";

type ProgressCallback = (progress: {
  phase: string;
  total: number;
  imported: number;
  message: string;
}) => void;

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

/**
 * Expected JSON format: History4Feed API response format
 * Either a single paginated response or an array of responses:
 * {
 *   "count": number,
 *   "results": [{ id, title, description, link, pubdate, author, categories, is_full_text }]
 * }
 *
 * Or a Blog Log export format:
 * {
 *   "blog": { title, description, feedUrl, siteUrl },
 *   "articles": [{ title, link, pubdate, author, categories, contentHtml, contentText }]
 * }
 */
type H4FJsonFormat = {
  count?: number;
  results?: Array<{
    id?: string;
    title: string;
    description?: string;
    link: string;
    pubdate?: string;
    author?: string | null;
    categories?: string[];
    is_full_text?: boolean;
  }>;
  // Blog Log export format
  blog?: {
    title: string;
    description?: string;
    feedUrl?: string;
    siteUrl?: string;
  };
  articles?: Array<{
    title: string;
    link: string;
    pubdate?: string;
    author?: string | null;
    categories?: string[];
    contentHtml?: string;
    contentText?: string;
  }>;
};

export async function importFromJsonFile(
  fileUri: string,
  onProgress?: ProgressCallback
): Promise<string | null> {
  const blogId = generateId();
  const jobId = generateId();
  const now = new Date().toISOString();

  onProgress?.({ phase: "metadata", total: 0, imported: 0, message: "Reading file..." });

  const content = await FileSystem.readAsStringAsync(fileUri);
  const data: H4FJsonFormat = JSON.parse(content);

  // Determine format
  let blogTitle = "Imported Blog";
  let blogDescription: string | null = null;
  let feedUrl: string | null = null;
  let siteUrl: string | null = null;
  let posts: Array<{
    title: string;
    link: string;
    pubdate?: string;
    author?: string | null;
    categories?: string[];
    contentHtml?: string;
    contentText?: string;
  }> = [];

  if (data.blog && data.articles) {
    // Blog Log export format
    blogTitle = data.blog.title;
    blogDescription = data.blog.description ?? null;
    feedUrl = data.blog.feedUrl ?? null;
    siteUrl = data.blog.siteUrl ?? null;
    posts = data.articles;
  } else if (data.results) {
    // History4Feed paginated format
    blogTitle = "Imported Blog";
    posts = data.results.map((r) => ({
      title: r.title,
      link: r.link,
      pubdate: r.pubdate,
      author: r.author,
      categories: r.categories,
      contentHtml: r.description,
    }));
  } else {
    throw new Error("Unrecognized JSON format. Expected History4Feed or Blog Log export format.");
  }

  await db.insert(blogs).values({
    id: blogId,
    title: blogTitle,
    description: blogDescription,
    feedUrl,
    siteUrl,
    importedAt: now,
    importSource: "json_file",
  });

  await db.insert(importJobs).values({
    id: jobId,
    blogId,
    source: "json_file",
    state: "running",
    phase: "metadata",
    startedAt: now,
  });

  onProgress?.({
    phase: "metadata",
    total: posts.length,
    imported: 0,
    message: `Found ${posts.length} articles. Importing...`,
  });

  let imported = 0;
  const batchSize = 50;

  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);

    db.$client.execSync("BEGIN TRANSACTION");
    try {
      for (const post of batch) {
        const articleId = generateId();
        const contentText = post.contentText ?? (post.contentHtml ? stripHtml(post.contentHtml) : null);
        const words = contentText ? countWords(contentText) : 0;

        db.$client.runSync(
          `INSERT OR IGNORE INTO articles (id, blog_id, title, link, author, pubdate, content_html, content_text, word_count, reading_time_minutes, is_full_text, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            articleId,
            blogId,
            post.title,
            post.link,
            post.author ?? null,
            post.pubdate ?? null,
            post.contentHtml ?? null,
            contentText,
            words,
            Math.ceil(words / ReadingSpeed.wordsPerMinute),
            contentText && contentText.length > 200 ? 1 : 0,
            now,
          ]
        );

        for (const tag of post.categories ?? []) {
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
      total: posts.length,
      imported,
      message: `Imported ${imported}/${posts.length} articles.`,
    });
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
