import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { FakeSmsSender } from "../src/services/twilio.js";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  PUBLIC_BASE_URL: "http://localhost:8787",
  TWILIO_AUTH_TOKEN: "synthetic-test-token",
  ADMIN_API_TOKEN: "synthetic-admin-token",
});
const app = await buildApp({ config, smsSender: new FakeSmsSender() });
const paths = ["/health", "/", "/calendar/", "/privacy/", "/terms/"];
for (const path of paths) {
  const response = await app.inject({ method: "GET", url: path });
  if (response.statusCode !== 200) {
    throw new Error(`${path} returned ${response.statusCode}`);
  }
  process.stdout.write(`${path} ${response.statusCode}\n`);
}
await app.close();
