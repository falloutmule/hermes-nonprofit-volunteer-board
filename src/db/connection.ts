import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase } from "./migrate.js";

export function openDatabase(databasePath: string): Database.Database {
  const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(databasePath);
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (resolvedPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  migrateDatabase(db);
  return db;
}
