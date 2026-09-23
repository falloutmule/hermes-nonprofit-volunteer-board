import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { operationalLog } from "./operations.js";

try {
  const config = loadConfig();
  if (config.nodeEnv === "production" && !existsSync(config.databasePath)) throw new Error("Production database missing; restore before startup");
  // Public request bodies, headers, query strings and error details must not enter logs.
  const app = await buildApp({ config, logger: false });
  const log = (event: string, fields = {}) => operationalLog(config.logPath, event, fields);
  app.addHook("onResponse", async (request, reply) => {
    log("request", { method: request.method, status: reply.statusCode });
  });
  let stopping = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    await app.close();
    if (config.pidFile && existsSync(config.pidFile)) unlinkSync(config.pidFile);
    if (config.stopFile && existsSync(config.stopFile)) unlinkSync(config.stopFile);
    log("stopped");
  };
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("SIGINT", () => { void shutdown(); });
  await app.listen({ port: config.port, host: "127.0.0.1" });
  if (config.pidFile) writeFileSync(config.pidFile, String(process.pid));
  if (config.stopFile) timer = setInterval(() => { if (existsSync(config.stopFile!)) void shutdown(); }, 1000);
  log("started", { pid: process.pid, port: config.port });
} catch {
  // Avoid rendering validation input or SDK errors containing configuration values.
  process.stderr.write("Application startup/shutdown failed; check configuration and local permissions.\n");
  process.exitCode = 1;
}
