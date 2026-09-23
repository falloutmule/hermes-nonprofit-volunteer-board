import { resolve } from "node:path";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { databaseReady } from "./operations.js";
import { VolunteerBoard } from "./domain/board.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerTwilioInbound } from "./routes/twilio-inbound.js";
import {
  type SmsSender,
  TwilioSmsSender,
  UnconfiguredSmsSender,
} from "./services/twilio.js";

export interface AppOptions {
  config: AppConfig;
  db?: Database.Database;
  smsSender?: SmsSender;
  logger?: boolean;
}

function configuredSender(config: AppConfig): SmsSender {
  if (config.twilioAccountSid && config.twilioAuthToken) {
    return new TwilioSmsSender(config.twilioAccountSid, config.twilioAuthToken, {
      ...(config.twilioMessagingServiceSid
        ? { messagingServiceSid: config.twilioMessagingServiceSid }
        : { from: config.twilioPhoneNumber }),
    });
  }
  return new UnconfiguredSmsSender();
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const ownsDatabase = options.db === undefined;
  const db = options.db ?? openDatabase(options.config.databasePath);
  const board = new VolunteerBoard(db);
  const smsSender = options.smsSender ?? configuredSender(options.config);

  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), "public"),
    prefix: "/assets/",
    wildcard: false,
  });
  app.get("/ready", async (_request, reply) => {
    const ok = databaseReady(db);
    return reply.code(ok ? 200 : 503).send({ ok });
  });
  await registerPublicRoutes(app, board);
  await registerTwilioInbound(app, { config: options.config, board, smsSender });
  await registerAdminRoutes(app, { config: options.config, board, smsSender });
  app.addHook("onClose", async () => {
    if (ownsDatabase) db.close();
  });
  return app;
}
