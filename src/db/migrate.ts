import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";

export function migrateDatabase(db: Database.Database): void {
  const schemaPath = resolve(process.cwd(), "src", "db", "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));
  const smsColumns = db.prepare("PRAGMA table_info(sms_events)").all() as Array<{ name: string }>;
  if (!smsColumns.some(({ name }) => name === "twilio_opt_out_type")) {
    db.exec("ALTER TABLE sms_events ADD COLUMN twilio_opt_out_type TEXT");
  }
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)",
  ).run(new Date().toISOString());
}
