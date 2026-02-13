import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";

export const blogs = sqliteTable("blogs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  feedUrl: text("feed_url"),
  siteUrl: text("site_url"),
  postCount: integer("post_count").default(0),
  earliestDate: text("earliest_date"),
  latestDate: text("latest_date"),
  importedAt: text("imported_at").notNull(),
  importSource: text("import_source"),
  totalWordCount: integer("total_word_count").default(0),
});

export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  blogId: text("blog_id")
    .notNull()
    .references(() => blogs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  link: text("link"),
  author: text("author"),
  pubdate: text("pubdate"),
  contentHtml: text("content_html"),
  contentText: text("content_text"),
  summary: text("summary"),
  wordCount: integer("word_count").default(0),
  readingTimeMinutes: integer("reading_time_minutes").default(0),
  isFullText: integer("is_full_text", { mode: "boolean" }).default(false),
  importedAt: text("imported_at").notNull(),
});

export const articleTags = sqliteTable("article_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: text("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
});

export const readingProgress = sqliteTable("reading_progress", {
  articleId: text("article_id")
    .primaryKey()
    .references(() => articles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("unread"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  rating: integer("rating"),
});

export const readingSessions = sqliteTable("reading_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: text("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  durationSeconds: integer("duration_seconds"),
});

export const articleEmbeddings = sqliteTable("article_embeddings", {
  articleId: text("article_id")
    .primaryKey()
    .references(() => articles.id, { onDelete: "cascade" }),
  embedding: blob("embedding"),
  model: text("model").default("minilm-l6-v2"),
  computedAt: text("computed_at"),
});

export const readingQueue = sqliteTable("reading_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: text("article_id")
    .notNull()
    .references(() => articles.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  addedAt: text("added_at").notNull(),
});

export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(),
  blogId: text("blog_id")
    .notNull()
    .references(() => blogs.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  state: text("state").notNull().default("pending"),
  phase: text("phase").default("metadata"),
  totalItems: integer("total_items").default(0),
  importedItems: integer("imported_items").default(0),
  lastError: text("last_error"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});
