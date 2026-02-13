import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import * as schema from "./schema";

const DB_NAME = "bloglog.db";

const expoDb = openDatabaseSync(DB_NAME, { enableChangeListener: true });

export const db = drizzle(expoDb, { schema });

export function initializeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      expoDb.execSync(`PRAGMA journal_mode = WAL;`);
      expoDb.execSync(`PRAGMA foreign_keys = ON;`);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS blogs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      feed_url TEXT,
      site_url TEXT,
      post_count INTEGER DEFAULT 0,
      earliest_date TEXT,
      latest_date TEXT,
      imported_at TEXT NOT NULL,
      import_source TEXT,
      total_word_count INTEGER DEFAULT 0
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      link TEXT,
      author TEXT,
      pubdate TEXT,
      content_html TEXT,
      content_text TEXT,
      summary TEXT,
      word_count INTEGER DEFAULT 0,
      reading_time_minutes INTEGER DEFAULT 0,
      is_full_text INTEGER DEFAULT 0,
      imported_at TEXT NOT NULL
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS article_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unread',
      started_at TEXT,
      completed_at TEXT,
      rating INTEGER
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS article_embeddings (
      article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      embedding BLOB,
      model TEXT DEFAULT 'minilm-l6-v2',
      computed_at TEXT
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS reading_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at TEXT NOT NULL
    );
  `);

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      phase TEXT DEFAULT 'metadata',
      total_items INTEGER DEFAULT 0,
      imported_items INTEGER DEFAULT 0,
      last_error TEXT,
      started_at TEXT,
      completed_at TEXT
    );
  `);

  // Create indexes
  expoDb.execSync(`
    CREATE INDEX IF NOT EXISTS idx_articles_blog_pubdate ON articles(blog_id, pubdate);
  `);
  expoDb.execSync(`
    CREATE INDEX IF NOT EXISTS idx_articles_blog_title ON articles(blog_id, title);
  `);
  expoDb.execSync(`
    CREATE INDEX IF NOT EXISTS idx_reading_progress_status ON reading_progress(status);
  `);
  expoDb.execSync(`
    CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag);
  `);
  expoDb.execSync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_blog_link ON articles(blog_id, link);
  `);

  // FTS5 virtual table for full-text search
  expoDb.execSync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      title,
      content_text,
      content='articles',
      content_rowid='rowid'
    );
  `);

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
