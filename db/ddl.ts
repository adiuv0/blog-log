/**
 * Base schema, created with IF NOT EXISTS on every launch. Changes to
 * existing tables go in db/migrations.ts instead.
 */
export const SCHEMA_SQL: string[] = [
  `
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
  `,
  `
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
  `,
  `
    CREATE TABLE IF NOT EXISTS article_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS reading_progress (
      article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unread',
      started_at TEXT,
      completed_at TEXT,
      rating INTEGER
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS article_embeddings (
      article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      embedding BLOB,
      model TEXT DEFAULT 'minilm-l6-v2',
      computed_at TEXT
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS reading_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at TEXT NOT NULL
    );
  `,
  `
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
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_articles_blog_pubdate ON articles(blog_id, pubdate);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_articles_blog_title ON articles(blog_id, title);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_reading_progress_status ON reading_progress(status);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag);
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_blog_link ON articles(blog_id, link);
  `,
  `
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      title,
      content_text,
      content='articles',
      content_rowid='rowid'
    );
  `,
];
