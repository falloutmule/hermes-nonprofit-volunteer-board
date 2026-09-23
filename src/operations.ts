import Database from "better-sqlite3";
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const domainTables = ["volunteers", "consent_events", "events", "signups", "standby_openings", "standby_offers", "sms_events"];
export function databaseReady(db: Database.Database): boolean {
  try {
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {version: number}[];
    if (versions.map(v => v.version).join(",") !== "1,2") return false;
    for (const table of domainTables) db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    db.prepare("SELECT twilio_opt_out_type, twilio_message_sid FROM sms_events LIMIT 1").get();
    return true;
  } catch { return false; }
}
export function inspectDatabase(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok" || !databaseReady(db)) throw new Error("Database integrity or schema check failed");
    if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Database foreign-key check failed");
    return Object.fromEntries(domainTables.map(table => [table, (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
  } finally { db.close(); }
}
export async function snapshotDatabase(source: string, destination: string) {
  if (resolve(source) === resolve(destination) || existsSync(destination) || existsSync(destination + ".partial")) throw new Error("Backup destination already exists or matches source");
  mkdirSync(dirname(destination), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(destination + ".partial"); } finally { db.close(); }
  const counts = inspectDatabase(destination + ".partial");
  renameSync(destination + ".partial", destination);
  return counts;
}
export async function restoreDatabase(source: string, destination: string) {
  // Caller must stop the application and disable its automatic restart first.
  const staged = destination + ".restore-" + Date.now();
  const counts = await snapshotDatabase(source, staged);
  const rollback = destination + ".before-restore-" + Date.now();
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(destination + suffix)) renameSync(destination + suffix, rollback + suffix);
  renameSync(staged, destination);
  inspectDatabase(destination);
  return { counts, rollback };
}
export function operationalLog(folder: string | undefined, event: string, fields: Record<string, string | number | boolean> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...fields }) + "\n";
  if (!folder) { process.stdout.write(line); return; }
  mkdirSync(folder, { recursive: true });
  appendFileSync(join(folder, "host-" + new Date().toISOString().slice(0, 10) + ".log"), line);
}
export function pruneFiles(folder: string, pattern: RegExp, days: number, now = Date.now()) {
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder)) {
    const file = join(folder, name);
    if (pattern.test(name) && statSync(file).isFile() && statSync(file).mtimeMs < now - days * 86400000) unlinkSync(file);
  }
}
