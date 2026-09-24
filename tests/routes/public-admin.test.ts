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
  it("serves the integrated disclosure, policies, stylesheet, and calendar", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
    for (const path of ["/", "/calendar/", "/privacy/", "/terms/"]) {
      expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(200);
    }
    const home = await app.inject({ method: "GET", url: "/" });
    const operatorStatement =
      "Hermes Non-Profit is a volunteer event coordination program";
    expect(home.body).toContain(operatorStatement);
    expect(home.body.replace(/\r\n/g, "\n")).toContain("operated by\n      sole proprietor Travis Omernick");
    expect(home.body).toContain("This website does not collect your phone number or SMS consent");
    expect(home.body).not.toContain("<form");
    expect(home.body).toContain("recurring automated");
    expect(home.body).toContain("Message and data rates may apply");
    expect(home.body).toContain('href="sms:+19704708839?body=JOIN"');
    expect(home.body).toContain('href="./privacy/"');
    expect(home.body).toContain('href="./terms/"');
    const privacy = await app.inject({ method: "GET", url: "/privacy/" });
    expect(privacy.body).toContain(operatorStatement);
    expect(privacy.body).toContain("sole proprietor Travis Omernick");
    expect(privacy.body).toContain("do not share, sell, rent, or provide your mobile phone number");
    expect(privacy.body).toContain("Effective September 23, 2026");
    const terms = await app.inject({ method: "GET", url: "/terms/" });
    expect(terms.body).toContain(operatorStatement);
    expect(terms.body).toContain("sole proprietor Travis Omernick");
    expect(terms.body).toContain("Reply <strong>START</strong>");
    expect(home.body + privacy.body + terms.body).not.toMatch(/SMS testing|test participants|per test event/i);
    expect(home.body + privacy.body + terms.body).not.toContain("DOCUMENT PENDING");
    expect((await app.inject({ method: "GET", url: "/styles.css" })).statusCode).toBe(200);
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
        status: "published", staffingEnabled: true, standbyEnabled: true,
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
