import Database from 'better-sqlite3';

const db = new Database('shipxy.db');
db.pragma('journal_mode = WAL');
db.pragma("encoding = 'UTF-8'");

db.exec(`
  CREATE TABLE IF NOT EXISTS ships_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    port_code TEXT,
    time_range INTEGER,
    fetched_at INTEGER,
    data_json TEXT
  );
  CREATE TABLE IF NOT EXISTS ship_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    port_code TEXT,
    mmsi TEXT,
    ship_flag TEXT,
    event_type TEXT,
    detail TEXT,
    detected_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS share_links (
    token TEXT PRIMARY KEY,
    target TEXT,
    password_hash TEXT,
    active INTEGER DEFAULT 1,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS followed_ships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mmsi TEXT UNIQUE,
    berth TEXT,
    agent TEXT,
    agent_contact_name TEXT,
    agent_contact_phone TEXT,
    remark TEXT,
    is_target INTEGER DEFAULT 0,
    crew_income_level TEXT,
    disembark_intent TEXT,
    email_status TEXT,
    crew_count INTEGER,
    expected_disembark_count INTEGER,
    actual_disembark_count INTEGER,
    disembark_date TEXT,
    updated_at INTEGER
  );
`);

const eventColumns = db.prepare("PRAGMA table_info('ship_events')").all();
const hasFlagColumn = eventColumns.some((col: any) => col.name === 'ship_flag');
if (!hasFlagColumn) {
  db.exec('ALTER TABLE ship_events ADD COLUMN ship_flag TEXT');
}

const followedColumns = db.prepare("PRAGMA table_info('followed_ships')").all();
const hasTargetFlag = followedColumns.some((col: any) => col.name === 'is_target');
if (!hasTargetFlag) {
  db.exec('ALTER TABLE followed_ships ADD COLUMN is_target INTEGER DEFAULT 0');
}
const ensureColumn = (name: string, type: string) => {
  const exists = followedColumns.some((col: any) => col.name === name);
  if (!exists) {
    db.exec(`ALTER TABLE followed_ships ADD COLUMN ${name} ${type}`);
  }
};
ensureColumn('crew_income_level', 'TEXT');
ensureColumn('disembark_intent', 'TEXT');
ensureColumn('email_status', 'TEXT');
ensureColumn('crew_count', 'INTEGER');
ensureColumn('expected_disembark_count', 'INTEGER');
ensureColumn('actual_disembark_count', 'INTEGER');
ensureColumn('agent_contact_name', 'TEXT');
ensureColumn('agent_contact_phone', 'TEXT');
ensureColumn('disembark_date', 'TEXT');

export default db;
