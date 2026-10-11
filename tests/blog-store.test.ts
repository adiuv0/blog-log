import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import { runMigrations } from "../db/migrations";
import { createSchema, createTestDb, type TestDb } from "./sqlite-adapter";

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db/client", () => ({
  db: {
    get $client() {
      return state.db;
    },
  },
}));
vi.mock("../services/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { findOrCreateBlog, refreshBlogStats } = await import("../services/import/blog-store");

describe("findOrCreateBlog", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    createSchema(db);
    runMigrations(db as unknown as SQLiteDatabase);
    state.db = db;
  });

  const meta = {
    title: "Astral Codex Ten",
    description: null,
    siteUrl: null,
    importSource: "wayback" as const,
  };

  it("reuses the existing blog when the same feed is imported again", () => {
    const first = findOrCreateBlog({ ...meta, feedUrl: "https://www.astralcodexten.com/feed" });
    const second = findOrCreateBlog({ ...meta, feedUrl: "http://astralcodexten.com/feed/" });
    expect(first.existing).toBe(false);
    expect(second).toEqual({ blogId: first.blogId, existing: true });
    expect(db.getFirstSync(`SELECT COUNT(*) AS n FROM blogs`)).toEqual({ n: 1 });
  });

  it("creates separate blogs for different feeds", () => {
    const a = findOrCreateBlog({ ...meta, feedUrl: "https://a.example.com/feed" });
    const b = findOrCreateBlog({ ...meta, feedUrl: "https://b.example.com/feed" });
    expect(a.blogId).not.toBe(b.blogId);
  });

  it("always creates a new blog when there is no feed URL", () => {
    const a = findOrCreateBlog({ ...meta, feedUrl: null });
    const b = findOrCreateBlog({ ...meta, feedUrl: null });
    expect(a.blogId).not.toBe(b.blogId);
  });
});

describe("refreshBlogStats", () => {
  it("computes count, date range and word total", () => {
    const db = createTestDb();
    createSchema(db);
    state.db = db;
    db.runSync(`INSERT INTO blogs (id, title, imported_at) VALUES ('b1', 'Blog', 'now')`);
    db.runSync(
      `INSERT INTO articles (id, blog_id, title, link, pubdate, word_count, imported_at) VALUES
       ('a1', 'b1', 'One', 'l1', '2014-07-30T08:00:00.000Z', 100, 'now'),
       ('a2', 'b1', 'Two', 'l2', '2015-06-14T08:00:00.000Z', 250, 'now')`
    );
    expect(refreshBlogStats("b1")).toEqual({ count: 2 });
    expect(
      db.getFirstSync(`SELECT post_count, earliest_date, latest_date, total_word_count FROM blogs`)
    ).toEqual({
      post_count: 2,
      earliest_date: "2014-07-30T08:00:00.000Z",
      latest_date: "2015-06-14T08:00:00.000Z",
      total_word_count: 350,
    });
  });
});
