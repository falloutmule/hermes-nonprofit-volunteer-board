import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parse } from "dotenv";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("./data/volunteer-board.sqlite"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:8787"),
  LOG_PATH: z.string().optional(), BACKUP_PATH: z.string().optional(),
  PID_FILE: z.string().optional(), STOP_FILE: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(), TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().default("+19704708839"),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(), ADMIN_API_TOKEN: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number; databasePath: string; publicBaseUrl: string;
  logPath?: string; backupPath?: string; pidFile?: string; stopFile?: string;
  twilioAccountSid?: string; twilioAuthToken?: string; twilioPhoneNumber: string;
  twilioMessagingServiceSid?: string; adminApiToken?: string;
}

// Explicit test environments never load real credentials. Process settings override files.
export function loadConfig(environment?: NodeJS.ProcessEnv): AppConfig {
  let input = environment;
  if (!input) {
    const file = process.env.CONFIG_FILE ?? ".env";
    if (process.env.CONFIG_FILE && !existsSync(file)) throw new Error("CONFIG_FILE does not exist");
    input = { ...(existsSync(file) ? parse(readFileSync(file)) : {}), ...process.env };
  }
  const parsed = EnvironmentSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid configuration fields: " + parsed.error.issues.map(i => i.path.join(".")).join(", "));
  const v = parsed.data;
  if (v.NODE_ENV === "production") {
    for (const name of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "ADMIN_API_TOKEN"] as const)
      if (!v[name]?.trim()) throw new Error(name + " is required in production");
    if (!/^AC[0-9a-f]{32}$/i.test(v.TWILIO_ACCOUNT_SID!)) throw new Error("Invalid TWILIO_ACCOUNT_SID");
    if (!/^[0-9a-f]{32}$/i.test(v.TWILIO_AUTH_TOKEN!)) throw new Error("Invalid TWILIO_AUTH_TOKEN");
    if (v.ADMIN_API_TOKEN!.length < 32) throw new Error("ADMIN_API_TOKEN must contain at least 32 characters");
    if (new URL(v.PUBLIC_BASE_URL).protocol !== "https:") throw new Error("PUBLIC_BASE_URL must use HTTPS in production");
    if (!isAbsolute(v.DATABASE_PATH)) throw new Error("Production DATABASE_PATH must be absolute");
  }
  return {
    nodeEnv: v.NODE_ENV, port: v.PORT, databasePath: v.DATABASE_PATH,
    publicBaseUrl: v.PUBLIC_BASE_URL.replace(/\/$/, ""), twilioPhoneNumber: v.TWILIO_PHONE_NUMBER,
    ...(v.LOG_PATH ? { logPath: v.LOG_PATH } : {}), ...(v.BACKUP_PATH ? { backupPath: v.BACKUP_PATH } : {}),
    ...(v.PID_FILE ? { pidFile: v.PID_FILE } : {}), ...(v.STOP_FILE ? { stopFile: v.STOP_FILE } : {}),
    ...(v.TWILIO_ACCOUNT_SID ? { twilioAccountSid: v.TWILIO_ACCOUNT_SID } : {}),
    ...(v.TWILIO_AUTH_TOKEN ? { twilioAuthToken: v.TWILIO_AUTH_TOKEN } : {}),
    ...(v.TWILIO_MESSAGING_SERVICE_SID ? { twilioMessagingServiceSid: v.TWILIO_MESSAGING_SERVICE_SID } : {}),
    ...(v.ADMIN_API_TOKEN ? { adminApiToken: v.ADMIN_API_TOKEN } : {}),
  };
}
