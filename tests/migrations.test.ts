import { beforeEach, describe, expect, it } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import { LATEST_SCHEMA_VERSION, runMigrations } from "../db/migrations";
import { buildFtsQuery } from "../services/import/normalize";
import { createSchema, createTestDb, type TestDb } from "./sqlite-adapter";

function migrate(db: TestDb) {
  runMigrations(db as unknown as SQLiteDatabase);
}

function search(db: TestDb, text: string) {
  return db.getAllSync(
    `SELECT a.id FROM articles a JOIN articles_fts fts ON fts.rowid = a.rowid
     WHERE articles_fts MATCH ? ORDER BY a.id`,
    [buildFtsQuery(text)!]
  ) as Array<{ id: string }>;
}

describe("migrations", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    createSchema(db);
    db.runSync(
      `INSERT INTO blogs (id, title, feed_url, imported_at) VALUES ('b1', 'Blog', 'https://example.com/feed', 'now')`
    );
    // Pre-migration data: raw RSS dates, one article with no excerpt
    db.runSync(
      `INSERT INTO articles (id, blog_id, title, link, pubdate, content_text, imported_at)
       VALUES ('a1', 'b1', 'Meditations on Moloch', 'https://example.com/1', 'Wed, 30 Jul 2014 08:00:00 GMT', 'Long essay', 'now')`
    );
    db.runSync(
      `INSERT INTO articles (id, blog_id, title, link, pubdate, content_text, imported_at)
       VALUES ('a2', 'b1', 'Archipelago and Atomic Communitarianism', 'https://example.com/2', 'Sun, 14 Jun 2015 08:00:00 GMT', NULL, 'now')`
    );
    db.runSync(
      `UPDATE blogs SET earliest_date = 'Sun, 14 Jun 2015 08:00:00 GMT', latest_date = 'Wed, 30 Jul 2014 08:00:00 GMT'`
    );
  });

  it("normalizes existing pubdates and fixes the blog date range", () => {
    migrate(db);
    const rows = db.getAllSync(`SELECT id, pubdate FROM articles ORDER BY pubdate DESC`);
    expect(rows).toEqual([
      { id: "a2", pubdate: "2015-06-14T08:00:00.000Z" },
      { id: "a1", pubdate: "2014-07-30T08:00:00.000Z" },
    ]);
    expect(db.getFirstSync(`SELECT earliest_date, latest_date FROM blogs`)).toEqual({
      earliest_date: "2014-07-30T08:00:00.000Z",
      latest_date: "2015-06-14T08:00:00.000Z",
    });
  });

  it("records the schema version and is safe to run twice", () => {
    migrate(db);
    migrate(db);
    expect(db.getFirstSync(`PRAGMA user_version`)).toEqual({ user_version: LATEST_SCHEMA_VERSION });
  });

  it("indexes every article for search, including ones without an excerpt", () => {
    migrate(db);
    expect(search(db, "archipelago")).toEqual([{ id: "a2" }]);
    expect(search(db, "medit")).toEqual([{ id: "a1" }]);
  });

  it("keeps the search index in sync on insert, update and delete", () => {
    migrate(db);
    db.runSync(
      `INSERT INTO articles (id, blog_id, title, link, imported_at) VALUES ('a3', 'b1', 'The Toxoplasma of Rage', 'https://example.com/3', 'now')`
    );
    expect(search(db, "toxoplasma")).toEqual([{ id: "a3" }]);

    db.runSync(`UPDATE articles SET title = 'I Can Tolerate Anything Except the Outgroup' WHERE id = 'a3'`);
    expect(search(db, "toxoplasma")).toEqual([]);
    expect(search(db, "outgroup")).toEqual([{ id: "a3" }]);

    db.runSync(`DELETE FROM blogs WHERE id = 'b1'`);
    expect(search(db, "outgroup")).toEqual([]);
    // Throws if the external-content index has drifted from the table
    db.execSync(`INSERT INTO articles_fts (articles_fts) VALUES ('integrity-check')`);
  });

  it("creates the settings table", () => {
    migrate(db);
    db.runSync(`INSERT INTO settings (key, value) VALUES ('autoMarkRead', 'false')`);
    expect(db.getFirstSync(`SELECT value FROM settings WHERE key = 'autoMarkRead'`)).toEqual({ value: "false" });
  });
});
