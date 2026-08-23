import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";

export function migrateDatabase(db: Database.Database): void {
  const schemaPath = resolve(process.cwd(), "src", "db", "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));
}
