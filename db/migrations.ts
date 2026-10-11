/**
 * Versioned schema/data migrations, tracked with SQLite's `user_version`
 * pragma. Each migration runs once, in order, inside a transaction. Add new
 * migrations to the end of the list; never edit one that has shipped.
 */

import type { SQLiteDatabase } from "expo-sqlite";
import { normalizePubdate } from "../services/import/normalize";

type Migration = {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: "normalize article pubdates to ISO 8601",
    up: (db) => {
      const rows = db.getAllSync(
        `SELECT id, pubdate FROM articles WHERE pubdate IS NOT NULL`
      ) as Array<{ id: string; pubdate: string }>;
      for (const row of rows) {
        const normalized = normalizePubdate(row.pubdate);
        if (normalized !== row.pubdate) {
          db.runSync(`UPDATE articles SET pubdate = ? WHERE id = ?`, [normalized, row.id]);
        }
      }
      db.execSync(`
        UPDATE blogs SET
          earliest_date = (SELECT MIN(pubdate) FROM articles WHERE articles.blog_id = blogs.id),
          latest_date = (SELECT MAX(pubdate) FROM articles WHERE articles.blog_id = blogs.id);
      `);
    },
  },
  {
    version: 2,
    name: "keep the search index in sync with triggers and rebuild it",
    up: (db) => {
      db.execSync(`
        CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
          INSERT INTO articles_fts (rowid, title, content_text)
          VALUES (new.rowid, new.title, new.content_text);
        END;
      `);
      db.execSync(`
        CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
          INSERT INTO articles_fts (articles_fts, rowid, title, content_text)
          VALUES ('delete', old.rowid, old.title, old.content_text);
        END;
      `);
      db.execSync(`
        CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE OF title, content_text ON articles BEGIN
          INSERT INTO articles_fts (articles_fts, rowid, title, content_text)
          VALUES ('delete', old.rowid, old.title, old.content_text);
          INSERT INTO articles_fts (rowid, title, content_text)
          VALUES (new.rowid, new.title, new.content_text);
        END;
      `);
      // Index every existing article (previously only ones with an excerpt were indexed)
      db.execSync(`INSERT INTO articles_fts (articles_fts) VALUES ('rebuild');`);
    },
  },
  {
    version: 3,
    name: "app settings table",
    up: (db) => {
      db.execSync(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version;

export function runMigrations(db: SQLiteDatabase): void {
  const row = db.getFirstSync(`PRAGMA user_version`) as { user_version: number } | null;
  const current = row?.user_version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.execSync("BEGIN TRANSACTION");
    try {
      migration.up(db);
      // PRAGMA does not accept bound parameters; version is a trusted constant
      db.execSync(`PRAGMA user_version = ${migration.version}`);
      db.execSync("COMMIT");
    } catch (err) {
      db.execSync("ROLLBACK");
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}
