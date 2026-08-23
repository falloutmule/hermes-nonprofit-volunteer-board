import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("./data/volunteer-board.sqlite"),
  PUBLIC_BASE_URL: z.url().default("http://localhost:8787"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().default("+19704708839"),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  ADMIN_API_TOKEN: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber: string;
  twilioMessagingServiceSid?: string;
  adminApiToken?: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const value = EnvironmentSchema.parse(environment);
  if (value.NODE_ENV === "production" && !value.ADMIN_API_TOKEN) {
    throw new Error("ADMIN_API_TOKEN is required in production");
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    publicBaseUrl: value.PUBLIC_BASE_URL.replace(/\/$/, ""),
    twilioPhoneNumber: value.TWILIO_PHONE_NUMBER,
    ...(value.TWILIO_ACCOUNT_SID
      ? { twilioAccountSid: value.TWILIO_ACCOUNT_SID }
      : {}),
    ...(value.TWILIO_AUTH_TOKEN
      ? { twilioAuthToken: value.TWILIO_AUTH_TOKEN }
      : {}),
    ...(value.TWILIO_MESSAGING_SERVICE_SID
      ? { twilioMessagingServiceSid: value.TWILIO_MESSAGING_SERVICE_SID }
      : {}),
    ...(value.ADMIN_API_TOKEN ? { adminApiToken: value.ADMIN_API_TOKEN } : {}),
  };
}
