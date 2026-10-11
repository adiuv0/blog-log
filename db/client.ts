import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import * as schema from "./schema";
import { SCHEMA_SQL } from "./ddl";
import { runMigrations } from "./migrations";

const DB_NAME = "bloglog.db";

const expoDb = openDatabaseSync(DB_NAME, { enableChangeListener: true });

export const db = drizzle(expoDb, { schema });

export function initializeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      expoDb.execSync(`PRAGMA journal_mode = WAL;`);
      expoDb.execSync(`PRAGMA foreign_keys = ON;`);

      for (const statement of SCHEMA_SQL) {
        expoDb.execSync(statement);
      }

      runMigrations(expoDb);

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
