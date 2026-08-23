import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/connection.js";
import { VolunteerBoard } from "../../src/domain/board.js";
import { scalar } from "../helpers.js";

const phones = ["+13035550101", "+13035550102", "+13035550103", "+13035550104"];
let db: Database.Database;
let board: VolunteerBoard;
let sid = 0;

function inbound(phone: string, body: string, messageSid = `SMDOMAIN${++sid}`) {
  return board.processInbound({ from: phone, body, messageSid });
}

function addEvent(slug = "PANTRY", capacity = 1) {
  return board.createEvent({
    slug,
    name: `${slug} event`,
    startsAt: "2026-09-01T18:00:00.000Z",
    endsAt: "2026-09-01T20:00:00.000Z",
    capacity,
    status: "published",
  });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  board = new VolunteerBoard(db);
  sid = 0;
});

describe("deterministic board transitions", () => {
  it("records opt-in evidence and makes duplicate MessageSid delivery idempotent", () => {
    const first = inbound(phones[0]!, " join ", "SMJOIN1");
    const duplicate = inbound(phones[0]!, "JOIN", "SMJOIN1");
    expect(first.classification).toBe("join");
    expect(duplicate).toMatchObject({ duplicate: true, reply: null });
    expect(scalar(db, "SELECT COUNT(*) AS value FROM volunteers")).toBe(1);
    expect(scalar(db, "SELECT COUNT(*) AS value FROM consent_events WHERE action = 'opt_in'")).toBe(1);
    expect(
      db.prepare("SELECT keyword, policy_version FROM consent_events").get(),
    ).toEqual({ keyword: "JOIN", policy_version: "2026-08-23" });
    expect(scalar(db, "SELECT COUNT(*) AS value FROM sms_events")).toBe(1);
    expect(db.prepare("PRAGMA table_info(sms_events)").all()).not.toContainEqual(
      expect.objectContaining({ name: "body" }),
    );
  });

  it("confirms below capacity and assigns monotonic standby positions at capacity", () => {
    addEvent();
    for (const phone of phones.slice(0, 3)) inbound(phone, "JOIN");
    expect(inbound(phones[0]!, "PANTRY").classification).toBe("signup_confirmed");
    expect(inbound(phones[1]!, "PANTRY").classification).toBe("signup_standby");
    expect(inbound(phones[2]!, "PANTRY").classification).toBe("signup_standby");
    const signups = db
      .prepare("SELECT status, standby_position FROM signups ORDER BY id")
      .all();
    expect(signups).toEqual([
      { status: "confirmed", standby_position: null },
      { status: "standby", standby_position: 1 },
      { status: "standby", standby_position: 2 },
    ]);
  });

  it("opens exactly one serialized offer, advances on NO, and promotes on YES", () => {
    addEvent();
    for (const phone of phones.slice(0, 3)) {
      inbound(phone, "JOIN");
      inbound(phone, "PANTRY");
    }
    const dropped = inbound(phones[0]!, "DROP PANTRY");
    expect(dropped.notifications).toHaveLength(1);
    expect(dropped.notifications[0]?.to).toBe(phones[1]);
    expect(scalar(db, "SELECT COUNT(*) AS value FROM standby_offers WHERE status = 'pending'")).toBe(1);

    const declined = inbound(phones[1]!, "NO");
    expect(declined.notifications).toHaveLength(1);
    expect(declined.notifications[0]?.to).toBe(phones[2]);
    const accepted = inbound(phones[2]!, "YES");
    expect(accepted.classification).toBe("offer_accepted");
    expect(
      scalar(db, "SELECT COUNT(*) AS value FROM signups WHERE status = 'confirmed'"),
    ).toBe(1);
    expect(scalar(db, "SELECT COUNT(*) AS value FROM standby_offers WHERE status = 'accepted'")).toBe(1);
  });

  it("does not let an unoffered or duplicate YES claim the same opening", () => {
    addEvent();
    for (const phone of phones.slice(0, 3)) {
      inbound(phone, "JOIN");
      inbound(phone, "PANTRY");
    }
    inbound(phones[0]!, "DROP PANTRY");
    expect(inbound(phones[2]!, "YES").classification).toBe("offer_missing");
    expect(inbound(phones[1]!, "YES", "SMYES").classification).toBe("offer_accepted");
    expect(inbound(phones[1]!, "YES", "SMYES").duplicate).toBe(true);
    expect(inbound(phones[2]!, "YES").classification).toBe("offer_missing");
    expect(
      scalar(db, "SELECT COUNT(*) AS value FROM signups WHERE status = 'confirmed'"),
    ).toBe(1);
  });

  it("does not create a capacity opening when standby drops", () => {
    addEvent("OUTREACH", 0);
    inbound(phones[0]!, "JOIN");
    inbound(phones[0]!, "OUTREACH");
    const result = inbound(phones[0]!, "DROP OUTREACH");
    expect(result.classification).toBe("drop_standby");
    expect(result.notifications).toHaveLength(0);
    expect(scalar(db, "SELECT COUNT(*) AS value FROM standby_openings")).toBe(0);
  });

  it("records STOP, blocks event signup, and permits START re-enrollment", () => {
    addEvent();
    inbound(phones[0]!, "JOIN");
    inbound(phones[0]!, "STOP");
    expect(inbound(phones[0]!, "PANTRY").classification).toBe("signup_requires_opt_in");
    expect(
      db.prepare("SELECT sms_status FROM volunteers WHERE phone_e164 = ?").get(phones[0]),
    ).toEqual({ sms_status: "opted_out" });
    expect(inbound(phones[0]!, "START").classification).toBe("start");
    expect(
      db.prepare("SELECT sms_status FROM volunteers WHERE phone_e164 = ?").get(phones[0]),
    ).toEqual({ sms_status: "opted_in" });
    expect(
      db.prepare("SELECT keyword, policy_version FROM consent_events ORDER BY id DESC LIMIT 1").get(),
    ).toEqual({ keyword: "START", policy_version: "2026-08-23" });
  });

  it("does not treat START as first-time enrollment", () => {
    expect(inbound(phones[0]!, "START").classification).toBe("start_not_opted_out");
    expect(
      db.prepare("SELECT sms_status FROM volunteers WHERE phone_e164 = ?").get(phones[0]),
    ).toEqual({ sms_status: "pending" });
    expect(scalar(db, "SELECT COUNT(*) AS value FROM consent_events")).toBe(0);
  });

  it("cancels an opted-out volunteer's pending offer and advances to the next standby", () => {
    addEvent();
    for (const phone of phones.slice(0, 3)) {
      inbound(phone, "JOIN");
      inbound(phone, "PANTRY");
    }
    inbound(phones[0]!, "DROP PANTRY");
    const stopped = inbound(phones[1]!, "STOP");
    expect(stopped.notifications).toHaveLength(1);
    expect(stopped.notifications[0]?.to).toBe(phones[2]);
    expect(
      scalar(
        db,
        "SELECT COUNT(*) AS value FROM standby_offers WHERE volunteer_id = 2 AND status = 'cancelled'",
      ),
    ).toBe(1);
  });
});
