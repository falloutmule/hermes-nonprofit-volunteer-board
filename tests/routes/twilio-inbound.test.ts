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
    expect(response.body).toContain("opted in");
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
    expect(help.body).toContain("Reply with an event keyword");
    expect(unknown.body).toContain("didn't understand");
  });
});
