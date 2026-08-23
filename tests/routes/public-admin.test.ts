import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { openDatabase } from "../../src/db/connection.js";
import { FakeSmsSender } from "../../src/services/twilio.js";
import { signedInbound, testConfig } from "../helpers.js";

let app: FastifyInstance;
let db: Database.Database;
let sender: FakeSmsSender;
const auth = { authorization: "Bearer synthetic-admin-token-not-a-secret" };

beforeEach(async () => {
  db = openDatabase(":memory:");
  sender = new FakeSmsSender();
  app = await buildApp({ config: testConfig(), db, smsSender: sender });
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe("public and admin routes", () => {
  it("serves health and all static pages with visible compliance placeholders", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    for (const path of ["/", "/calendar/", "/privacy/", "/terms/"]) {
      expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "GET", url: "/privacy/" })).body).toContain(
      "DOCUMENT PENDING — DO NOT USE FOR A2P SUBMISSION",
    );
    expect((await app.inject({ method: "GET", url: "/terms/" })).body).toContain(
      "DOCUMENT PENDING — DO NOT USE FOR A2P SUBMISSION",
    );
  });

  it("rejects missing admin authentication and exposes only published event data publicly", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/events" })).statusCode).toBe(401);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/events",
      headers: auth,
      payload: {
        slug: "OUTREACH",
        name: "Outreach",
        location: "Community center",
        startsAt: "2026-10-01T18:00:00.000Z",
        endsAt: "2026-10-01T20:00:00.000Z",
        capacity: 4,
        status: "published",
      },
    });
    expect(created.statusCode).toBe(201);
    const publicResponse = await app.inject({ method: "GET", url: "/api/public/events" });
    expect(publicResponse.json().events[0]).toMatchObject({
      slug: "OUTREACH",
      name: "Outreach",
      capacity: 4,
      confirmedCount: 0,
      spotsAvailable: 4,
    });
    expect(publicResponse.body).not.toContain("phone_e164");
    expect(publicResponse.body).not.toContain("volunteerId");
  });

  it("rejects admin sends to an opted-out volunteer", async () => {
    for (const [Body, MessageSid] of [["JOIN", "SMOPTIN"], ["STOP", "SMOPTOUT"]] as const) {
      const parameters = { From: "+13035550120", To: "+19704708839", Body, MessageSid };
      const signed = signedInbound(parameters);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/webhooks/twilio/inbound",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-twilio-signature": signed.signature,
            },
            payload: signed.payload,
          })
        ).statusCode,
      ).toBe(200);
    }
    const volunteer = db.prepare("SELECT id FROM volunteers").get() as { id: number };
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/messages/send",
      headers: auth,
      payload: { volunteerId: volunteer.id, body: "A test event update" },
    });
    expect(response.statusCode).toBe(409);
    expect(sender.messages).toHaveLength(0);
  });
});
