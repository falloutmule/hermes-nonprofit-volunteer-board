import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { openDatabase } from "../../src/db/connection.js";
import { FakeSmsSender } from "../../src/services/twilio.js";
import { signedInbound, scalar, testConfig } from "../helpers.js";

let app: FastifyInstance;
let db: Database.Database;
let sender: FakeSmsSender;

async function postInbound(parameters: Record<string, string>, signature?: string) {
  const signed = signedInbound(parameters);
  return app.inject({
    method: "POST",
    url: "/webhooks/twilio/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signature === "missing"
        ? {}
        : { "x-twilio-signature": signature ?? signed.signature }),
    },
    payload: signed.payload,
  });
}

beforeEach(async () => {
  db = openDatabase(":memory:");
  sender = new FakeSmsSender();
  app = await buildApp({ config: testConfig(), db, smsSender: sender });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("Twilio inbound route", () => {
  it("accepts a valid signature and parses form-encoded JOIN", async () => {
    const response = await postInbound({
      From: "+13035550110",
      To: "+19704708839",
      Body: "JOIN",
      MessageSid: "SMROUTE1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/xml");
    expect(response.body).toContain("You're enrolled in volunteer SMS testing");
    expect(response.body).toContain("Msg &amp; data rates may apply");
    expect(scalar(db, "SELECT COUNT(*) AS value FROM consent_events")).toBe(1);
  });

  it("rejects invalid and missing signatures without mutation", async () => {
    const input = {
      From: "+13035550110",
      To: "+19704708839",
      Body: "JOIN",
      MessageSid: "SMROUTE2",
    };
    expect((await postInbound(input, "invalid")).statusCode).toBe(403);
    expect((await postInbound(input, "missing")).statusCode).toBe(403);
    expect(scalar(db, "SELECT COUNT(*) AS value FROM sms_events")).toBe(0);
  });

  it("returns safe success without repeating a duplicate MessageSid mutation", async () => {
    const input = {
      From: "+13035550110",
      To: "+19704708839",
      Body: "JOIN",
      MessageSid: "SMROUTE3",
    };
    expect((await postInbound(input)).statusCode).toBe(200);
    const duplicate = await postInbound(input);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body).not.toContain("opted in");
    expect(scalar(db, "SELECT COUNT(*) AS value FROM consent_events")).toBe(1);
  });

  it("routes event keywords and uses the fake sender for a standby offer", async () => {
    const authorization = { authorization: "Bearer synthetic-admin-token-not-a-secret" };
    const event = await app.inject({
      method: "POST",
      url: "/api/admin/events",
      headers: authorization,
      payload: {
        slug: "PANTRY",
        name: "Pantry shift",
        startsAt: "2026-09-01T18:00:00.000Z",
        endsAt: "2026-09-01T20:00:00.000Z",
        capacity: 1,
        status: "published",
      },
    });
    expect(event.statusCode).toBe(201);
    for (const [index, phone] of ["+13035550110", "+13035550111"].entries()) {
      await postInbound({ From: phone, To: "+19704708839", Body: "JOIN", MessageSid: `SMJ${index}` });
      const signup = await postInbound({
        From: phone,
        To: "+19704708839",
        Body: "PANTRY",
        MessageSid: `SMS${index}`,
      });
      expect(signup.statusCode).toBe(200);
    }
    await postInbound({
      From: "+13035550110",
      To: "+19704708839",
      Body: "DROP PANTRY",
      MessageSid: "SMDROP",
    });
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toMatchObject({ to: "+13035550111" });
    expect(sender.messages[0]?.body).not.toBe("");
  });

  it("returns bounded HELP and unknown responses", async () => {
    const help = await postInbound({
      From: "+13035550110",
      To: "+19704708839",
      Body: "HELP",
      MessageSid: "SMHELP",
    });
    const unknown = await postInbound({
      From: "+13035550110",
      To: "+19704708839",
      Body: "hello there",
      MessageSid: "SMUNKNOWN",
    });
    expect(help.body).toContain("Help at Falloutmule@gmail.com");
    expect(unknown.body).toContain("didn't understand");
  });

  it.each(["START", "start", "  StArT  "])("leaves the default Twilio START reply to Twilio without OptOutType (%s)", async (Body) => {
    const base = { From: "+13035550113", To: "+19704708839" };
    await postInbound({ ...base, Body: "JOIN", MessageSid: "SMDEFAULTJOIN" });
    await postInbound({ ...base, Body: "STOP", MessageSid: "SMDEFAULTSTOP" });
    const input = { ...base, Body, MessageSid: "SMDEFAULTSTART" };
    const response = await postInbound(input);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    expect(db.prepare("SELECT sms_status FROM volunteers").get()).toEqual({ sms_status: "opted_in" });
    expect(db.prepare("SELECT keyword, source FROM consent_events WHERE keyword = 'START'").all()).toEqual([
      { keyword: "START", source: "twilio_inbound" },
    ]);
    expect(db.prepare("SELECT twilio_opt_out_type FROM sms_events WHERE classification = 'start'").get()).toEqual({ twilio_opt_out_type: null });
    const duplicate = await postInbound(input);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body).toBe(response.body);
    const repeated = await postInbound({ ...input, MessageSid: "SMDEFAULTSTARTAGAIN" });
    expect(repeated.body).toBe(response.body);
    expect(scalar(db, "SELECT COUNT(*) AS value FROM consent_events WHERE keyword = 'START'")).toBe(1);
    expect(sender.messages).toHaveLength(0);
    await postInbound({ ...base, Body: "STOP", MessageSid: "SMDEFAULTFINALSTOP" });
    expect(db.prepare("SELECT sms_status FROM volunteers").get()).toEqual({ sms_status: "opted_out" });
  });
  it("records managed OptOutType transitions without duplicating Twilio replies", async () => {
    const phone = "+13035550112";
    await postInbound({
      From: phone,
      To: "+19704708839",
      Body: "JOIN",
      MessageSid: "SMMANAGEDJOIN",
    });
    for (const [OptOutType, Body, MessageSid] of [
      ["HELP", "HELP", "SMMANAGEDHELP"],
      ["STOP", "QUIT", "SMMANAGEDSTOP"],
      ["START", "START", "SMMANAGEDSTART"],
    ] as const) {
      const response = await postInbound({
        From: phone,
        To: "+19704708839",
        Body,
        MessageSid,
        OptOutType,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
    }
    expect(
      db.prepare("SELECT sms_status FROM volunteers WHERE phone_e164 = ?").get(phone),
    ).toEqual({ sms_status: "opted_in" });
    expect(
      db
        .prepare(
          "SELECT twilio_opt_out_type, classification FROM sms_events WHERE twilio_opt_out_type IS NOT NULL ORDER BY id",
        )
        .all(),
    ).toEqual([
      { twilio_opt_out_type: "HELP", classification: "help" },
      { twilio_opt_out_type: "STOP", classification: "stop" },
      { twilio_opt_out_type: "START", classification: "start" },
    ]);
    expect(
      db
        .prepare(
          "SELECT keyword, source, policy_version FROM consent_events WHERE keyword IN ('HELP', 'STOP', 'START') ORDER BY id",
        )
        .all(),
    ).toEqual([
      { keyword: "HELP", source: "twilio_opt_out_type", policy_version: "2026-08-23" },
      { keyword: "STOP", source: "twilio_opt_out_type", policy_version: "2026-08-23" },
      { keyword: "START", source: "twilio_opt_out_type", policy_version: "2026-08-23" },
    ]);
  });
});
