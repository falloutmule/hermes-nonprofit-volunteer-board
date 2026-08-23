import type Database from "better-sqlite3";
import twilio from "twilio";
import type { AppConfig } from "../src/config.js";

export const TEST_AUTH_TOKEN = "synthetic-auth-token-not-a-secret";
export const TEST_ADMIN_TOKEN = "synthetic-admin-token-not-a-secret";
export const TEST_BASE_URL = "https://board.test.invalid";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 8787,
    databasePath: ":memory:",
    publicBaseUrl: TEST_BASE_URL,
    twilioPhoneNumber: "+19704708839",
    twilioAuthToken: TEST_AUTH_TOKEN,
    adminApiToken: TEST_ADMIN_TOKEN,
    ...overrides,
  };
}

export function signedInbound(
  parameters: Record<string, string>,
  token = TEST_AUTH_TOKEN,
): { payload: string; signature: string } {
  const url = `${TEST_BASE_URL}/webhooks/twilio/inbound`;
  return {
    payload: new URLSearchParams(parameters).toString(),
    signature: twilio.getExpectedTwilioSignature(token, url, parameters),
  };
}

export function scalar(db: Database.Database, sql: string, ...parameters: unknown[]): number {
  return Number((db.prepare(sql).get(...parameters) as { value: number }).value);
}
