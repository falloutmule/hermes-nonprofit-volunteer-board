import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const migrations = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
process.stdout.write(`${JSON.stringify({ ok: true, databasePath: config.databasePath, migrations })}\n`);
db.close();
