import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database", () => {
  it("migrates a blank database and reopens it cleanly", () => {
    const directory = mkdtempSync(join(tmpdir(), "volunteer-board-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "board.sqlite");
    let db = openDatabase(path);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 4 });
    db.close();
    db = openDatabase(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "volunteers",
        "consent_events",
        "events",
        "signups",
        "standby_openings",
        "standby_offers",
        "sms_events",
      ]),
    );
    expect(
      (db.prepare("PRAGMA table_info(sms_events)").all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).toContain("twilio_opt_out_type");
    db.close();
  });

  it("enforces unique phones and MessageSid values", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO volunteers(phone_e164, sms_status, created_at, updated_at) VALUES (?, 'pending', ?, ?)",
    ).run("+13035550100", now, now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO volunteers(phone_e164, sms_status, created_at, updated_at) VALUES (?, 'pending', ?, ?)",
        )
        .run("+13035550100", now, now),
    ).toThrow();
    db.prepare(
      "INSERT INTO sms_events(twilio_message_sid, direction, created_at) VALUES (?, 'inbound', ?)",
    ).run("SMUNIQUE", now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO sms_events(twilio_message_sid, direction, created_at) VALUES (?, 'inbound', ?)",
        )
        .run("SMUNIQUE", now),
    ).toThrow();
    db.close();
  });

  it("prevents multiple active signups for one volunteer and event", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const volunteer = db
      .prepare(
        "INSERT INTO volunteers(phone_e164, sms_status, created_at, updated_at) VALUES (?, 'opted_in', ?, ?)",
      )
      .run("+13035550100", now, now);
    const event = db
      .prepare(
        `INSERT INTO events(slug, name, starts_at, ends_at, capacity, status, created_at, updated_at)
         VALUES ('UNIQUE', 'Unique test', ?, ?, 2, 'published', ?, ?)`,
      )
      .run(now, new Date(Date.now() + 3_600_000).toISOString(), now, now);
    const insert = db.prepare(
      `INSERT INTO signups(event_id, volunteer_id, status, created_at, updated_at)
       VALUES (?, ?, 'confirmed', ?, ?)`,
    );
    insert.run(event.lastInsertRowid, volunteer.lastInsertRowid, now, now);
    expect(() => insert.run(event.lastInsertRowid, volunteer.lastInsertRowid, now, now)).toThrow();
    db.close();
  });

  it("upgrades a version-one SMS ledger with OptOutType evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "volunteer-board-v1-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "board.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-08-23T00:00:00.000Z');
      CREATE TABLE sms_events (
        id INTEGER PRIMARY KEY,
        twilio_message_sid TEXT UNIQUE,
        direction TEXT NOT NULL,
        volunteer_id INTEGER,
        event_id INTEGER,
        classification TEXT,
        delivery_status TEXT,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();
    const upgraded = openDatabase(path);
    expect(
      (upgraded.prepare("PRAGMA table_info(sms_events)").all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).toContain("twilio_opt_out_type");
    expect(
      upgraded.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
    ).toEqual({ version: 4 });
    upgraded.close();
  });

  it("has no attendance, check-in, or no-show state", () => {
    const db = openDatabase(":memory:");
    const schema = (db
      .prepare("SELECT sql FROM sqlite_master WHERE type IN ('table', 'index')")
      .all() as Array<{ sql: string | null }>)
      .map(({ sql }) => sql ?? "")
      .join(" ")
      .toLowerCase();
    expect(schema).not.toContain("attendance");
    expect(schema).not.toContain("check_in");
    expect(schema).not.toContain("no_show");
    db.close();
  });
});
