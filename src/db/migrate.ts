import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";

export function migrateDatabase(db: Database.Database): void {
  const schemaPath = resolve(process.cwd(), "src", "db", "schema.sql");
  db.exec(readFileSync(schemaPath, "utf8"));
  const smsColumns = db.prepare("PRAGMA table_info(sms_events)").all() as Array<{ name: string }>;
  if (!smsColumns.some(({ name }) => name === "twilio_opt_out_type")) {
    db.exec("ALTER TABLE sms_events ADD COLUMN twilio_opt_out_type TEXT");
  }
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)",
  ).run(new Date().toISOString());
  db.transaction(() => {
    const columns = new Set((db.prepare("PRAGMA table_info(events)").all() as {name:string}[]).map(c => c.name));
    const additions: Record<string,string> = {
      staffing_enabled: "INTEGER NOT NULL DEFAULT 1 CHECK(staffing_enabled IN (0,1))",
      standby_enabled: "INTEGER NOT NULL DEFAULT 1 CHECK(standby_enabled IN (0,1))",
      completion_report_required: "INTEGER NOT NULL DEFAULT 0 CHECK(completion_report_required IN (0,1))",
      completion_statement: "TEXT", timezone: "TEXT NOT NULL DEFAULT 'America/Denver'",
      series_id: "TEXT", recurrence_rule: "TEXT", occurrence_date: "TEXT"
    };
    for (const [name, type] of Object.entries(additions)) if (!columns.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS event_occurrence_identity ON events(series_id, occurrence_date) WHERE series_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS event_completions (
        event_id INTEGER PRIMARY KEY REFERENCES events(id), volunteer_id INTEGER NOT NULL REFERENCES volunteers(id),
        statement TEXT NOT NULL, completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operation_context (id INTEGER PRIMARY KEY CHECK(id=1), source TEXT NOT NULL);
      INSERT OR IGNORE INTO operation_context VALUES (1,'board');
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER REFERENCES events(id), source TEXT NOT NULL,
        action TEXT NOT NULL, target TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projection_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER NOT NULL UNIQUE REFERENCES activity(id),
        created_at TEXT NOT NULL, acknowledged_at TEXT
      );
      CREATE TRIGGER IF NOT EXISTS activity_outbox AFTER INSERT ON activity BEGIN
        INSERT INTO projection_outbox(activity_id,created_at) VALUES (NEW.id,NEW.created_at);
      END;
    `);
    for (const [table,eventColumn,details] of [
      ['events','id', "json_object('status',NEW.status,'name',NEW.name,'startsAt',NEW.starts_at,'endsAt',NEW.ends_at,'capacity',NEW.capacity,'staffingEnabled',NEW.staffing_enabled,'standbyEnabled',NEW.standby_enabled,'completionReportRequired',NEW.completion_report_required)"], ['signups','event_id', "NEW.status"],
      ['standby_offers','event_id', "NEW.status"], ['standby_openings','event_id', "NEW.status"],
      ['event_completions','event_id', "'completed'"]
    ]) {
      const target = table === 'event_completions' ? 'event_id' : 'id';
      for (const operation of ['INSERT','UPDATE']) {
        if (table === 'event_completions' && operation === 'UPDATE') continue;
        let resultSql=details;
        if (table==='events' && operation==='UPDATE') {
          const safeFields:Record<string,string>={name:'name',slug:'slug',location:'location',startsAt:'starts_at',endsAt:'ends_at',timezone:'timezone',capacity:'capacity',status:'status',staffingEnabled:'staffing_enabled',standbyEnabled:'standby_enabled',completionReportRequired:'completion_report_required',completionStatement:'completion_statement',seriesId:'series_id',recurrenceRule:'recurrence_rule',occurrenceDate:'occurrence_date'};
          resultSql=Object.entries(safeFields).reduce((sql,[key,column])=>`json_patch(${sql},CASE WHEN OLD.${column} IS NOT NEW.${column} THEN json_object('${key}',json_object('before',OLD.${column},'after',NEW.${column})) ELSE '{}' END)`,"'{}'");
          resultSql=`json_patch(${resultSql},CASE WHEN OLD.description IS NOT NEW.description THEN json_object('descriptionChanged',json('true')) ELSE '{}' END)`;
          db.exec('DROP TRIGGER IF EXISTS audit_events_UPDATE');
        }
        db.exec(`CREATE TRIGGER IF NOT EXISTS audit_${table}_${operation} AFTER ${operation} ON ${table} BEGIN
          INSERT INTO activity(event_id,source,action,target,result,created_at)
          VALUES (NEW.${eventColumn},(SELECT source FROM operation_context WHERE id=1),'${table}.${operation.toLowerCase()}', '${table}:' || NEW.${target},${resultSql},strftime('%Y-%m-%dT%H:%M:%fZ','now'));
        END;`);
      }
    }
    db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES(3,?)").run(new Date().toISOString());
  })();
}
