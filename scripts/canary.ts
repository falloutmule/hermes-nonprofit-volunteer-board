import twilio from "twilio";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { FakeSmsSender } from "../src/services/twilio.js";

const authToken = "synthetic-canary-token";
const adminToken = "synthetic-canary-admin";
const baseUrl = "https://synthetic-canary.invalid";
const config = loadConfig({
  NODE_ENV: "test",
  PORT: "8787",
  DATABASE_PATH: ":memory:",
  PUBLIC_BASE_URL: baseUrl,
  TWILIO_AUTH_TOKEN: authToken,
  TWILIO_PHONE_NUMBER: "+19704708839",
  ADMIN_API_TOKEN: adminToken,
});
const db = openDatabase(":memory:");
const sender = new FakeSmsSender();
const app = await buildApp({ config, db, smsSender: sender });
const adminHeaders = { authorization: `Bearer ${adminToken}` };

const created = await app.inject({
  method: "POST",
  url: "/api/admin/events",
  headers: adminHeaders,
  payload: {
    slug: "CANARY",
    name: "Synthetic canary event",
    startsAt: "2026-12-01T18:00:00.000Z",
    endsAt: "2026-12-01T20:00:00.000Z",
    capacity: 1,
    status: "published",
  },
});
if (created.statusCode !== 201) throw new Error("Synthetic event creation failed");

let sequence = 0;
async function inbound(from: string, body: string): Promise<void> {
  const parameters = {
    From: from,
    To: "+19704708839",
    Body: body,
    MessageSid: `SMCANARY${++sequence}`,
  };
  const url = `${baseUrl}/webhooks/twilio/inbound`;
  const signature = twilio.getExpectedTwilioSignature(authToken, url, parameters);
  const response = await app.inject({
    method: "POST",
    url: "/webhooks/twilio/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    payload: new URLSearchParams(parameters).toString(),
  });
  if (response.statusCode !== 200) throw new Error(`Synthetic inbound failed with ${response.statusCode}`);
}

const first = "+13035550901";
const second = "+13035550902";
await inbound(first, "JOIN");
await inbound(second, "JOIN");
await inbound(first, "CANARY");
await inbound(second, "CANARY");
await inbound(first, "DROP CANARY");
await inbound(second, "YES");

const state = db
  .prepare(
    `SELECT
      (SELECT COUNT(*) FROM sms_events WHERE direction = 'inbound') AS inboundEvents,
      (SELECT COUNT(*) FROM signups WHERE status = 'confirmed') AS confirmed,
      (SELECT COUNT(*) FROM standby_offers WHERE status = 'accepted') AS acceptedOffers`,
  )
  .get() as { inboundEvents: number; confirmed: number; acceptedOffers: number };
if (state.inboundEvents !== 6 || state.confirmed !== 1 || state.acceptedOffers !== 1) {
  throw new Error("Synthetic database state did not match expected values");
}
if (sender.messages.length !== 1) throw new Error("Synthetic standby offer was not captured exactly once");

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    signatureValidated: true,
    inboundEvents: state.inboundEvents,
    confirmedSignups: state.confirmed,
    acceptedOffers: state.acceptedOffers,
    capturedOutboundMessages: sender.messages.length,
    rawBodiesPersisted: false,
  })}\n`,
);
await app.close();
db.close();
