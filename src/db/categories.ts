import type Database from 'better-sqlite3';

export function migrateCategories(db:Database.Database) {
  db.transaction(()=>{
    const add=(table:string,column:string,type:string)=>{
      if(!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    db.exec(`
      CREATE TABLE IF NOT EXISTS category_definitions (
        id INTEGER PRIMARY KEY, series_id TEXT, event_id INTEGER REFERENCES events(id),
        keyword TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)), sort_order INTEGER NOT NULL,
        CHECK((series_id IS NULL)!=(event_id IS NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS category_active_keyword ON category_definitions(keyword COLLATE NOCASE) WHERE active=1;
      CREATE UNIQUE INDEX IF NOT EXISTS category_series_key ON category_definitions(series_id,keyword COLLATE NOCASE) WHERE series_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS category_event_key ON category_definitions(event_id,keyword COLLATE NOCASE) WHERE event_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS category_defaults (
        id INTEGER PRIMARY KEY,category_id INTEGER NOT NULL REFERENCES category_definitions(id),effective_from TEXT NOT NULL,
        name TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>=0),standby_enabled INTEGER NOT NULL,active INTEGER NOT NULL,sort_order INTEGER NOT NULL,
        UNIQUE(category_id,effective_from)
      );
      CREATE TABLE IF NOT EXISTS event_categories (
        id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),category_id INTEGER NOT NULL REFERENCES category_definitions(id),
        name TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>=0),standby_enabled INTEGER NOT NULL,active INTEGER NOT NULL,sort_order INTEGER NOT NULL,
        is_override INTEGER NOT NULL DEFAULT 0,UNIQUE(event_id,category_id)
      );
      CREATE TABLE IF NOT EXISTS sms_context (
        volunteer_id INTEGER PRIMARY KEY REFERENCES volunteers(id),stage TEXT NOT NULL,context_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,expires_at TEXT NOT NULL
      );
    `);
    for(const table of ['signups','standby_openings','standby_offers'])add(table,'category_id','INTEGER REFERENCES event_categories(id)');
    add('activity','category_id','INTEGER');add('activity','category_key','TEXT');add('activity','category_name','TEXT');
    db.exec(`
      DROP INDEX IF EXISTS standby_offers_one_pending_per_event;
      CREATE UNIQUE INDEX IF NOT EXISTS offers_one_pending_generic_event ON standby_offers(event_id) WHERE status='pending' AND category_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS offers_one_pending_category ON standby_offers(category_id) WHERE status='pending' AND category_id IS NOT NULL;
    `);
    for(const table of ['signups','standby_offers','standby_openings'])for(const operation of ['INSERT','UPDATE']){
      db.exec(`DROP TRIGGER IF EXISTS audit_${table}_${operation};
        CREATE TRIGGER audit_${table}_${operation} AFTER ${operation} ON ${table} BEGIN
          INSERT INTO activity(event_id,source,action,target,result,created_at,category_id,category_key,category_name)
          VALUES(NEW.event_id,(SELECT source FROM operation_context WHERE id=1),'${table}.${operation.toLowerCase()}','${table}:'||NEW.id,NEW.status,
            strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.category_id,
            (SELECT d.keyword FROM event_categories c JOIN category_definitions d ON d.id=c.category_id WHERE c.id=NEW.category_id),
            (SELECT name FROM event_categories WHERE id=NEW.category_id));
        END;`);
    }
    for(const table of ['category_definitions','category_defaults','event_categories'])for(const operation of ['INSERT','UPDATE']){
      const event=table==='category_definitions'?'NEW.event_id':table==='event_categories'?'NEW.event_id':'NULL';
      const category=table==='event_categories'?'NEW.id':'NULL';
      const key=table==='category_definitions'?'NEW.keyword':`(SELECT keyword FROM category_definitions WHERE id=NEW.category_id)`;
      const result=table==='category_definitions'?"json_object('active',NEW.active,'name',NEW.name)": "json_object('capacity',NEW.capacity,'active',NEW.active,'standbyEnabled',NEW.standby_enabled)";
      db.exec(`CREATE TRIGGER IF NOT EXISTS audit_${table}_${operation} AFTER ${operation} ON ${table} BEGIN
        INSERT INTO activity(event_id,source,action,target,result,created_at,category_id,category_key,category_name)
        VALUES(${event},(SELECT source FROM operation_context WHERE id=1),'${table}.${operation.toLowerCase()}','${table}:'||NEW.id,${result},strftime('%Y-%m-%dT%H:%M:%fZ','now'),${category},${key},NEW.name);
      END;`);
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(4,?)').run(new Date().toISOString());
  })();
}
