// Minimal stand-in for expo-sqlite's synchronous API, backed by Node's
// built-in SQLite, so database code can be tested outside React Native.
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../db/ddl";

type Params = Array<string | number | null>;

export function createTestDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  const db = {
    execSync: (sql: string) => raw.exec(sql),
    getAllSync: (sql: string, params: Params = []) => raw.prepare(sql).all(...params),
    getFirstSync: (sql: string, params: Params = []) => raw.prepare(sql).get(...params) ?? null,
    runSync: (sql: string, params: Params = []) => {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
  };
  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;

export function createSchema(db: TestDb) {
  for (const statement of SCHEMA_SQL) db.execSync(statement);
}
