import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const isLocalFile = config.dbUrl.startsWith('file:');

// Ensure the local data directory exists for file-based (development) databases.
if (isLocalFile) {
  const filePath = config.dbUrl.slice('file:'.length);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// Use the native client for local files and the pure-HTTP (web) client for
// remote libSQL/Turso URLs, so serverless deploys don't need a native binding.
const { createClient } = isLocalFile
  ? await import('@libsql/client')
  : await import('@libsql/client/web');

export const db = createClient({ url: config.dbUrl, authToken: config.dbAuthToken });

// ---- Small helpers mirroring the previous better-sqlite3 API ----
export async function get(sql, args = []) {
  const rs = await db.execute({ sql, args });
  return rs.rows[0] ?? null;
}

export async function all(sql, args = []) {
  const rs = await db.execute({ sql, args });
  return rs.rows;
}

export async function run(sql, args = []) {
  const rs = await db.execute({ sql, args });
  return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_no TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    course TEXT,
    year_level TEXT,
    section TEXT,
    qr_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    location TEXT,
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    checkin_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    require_student_confirm INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'present',
    method TEXT NOT NULL DEFAULT 'manual',
    note TEXT,
    checked_in_at TEXT,
    checked_out_at TEXT,
    marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (event_id, student_id)
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
`;

// Lightweight migrations for databases created before a column existed.
async function ensureColumn(table, column, ddl) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// Older databases had `checked_in_at NOT NULL`, which forced an artificial time-in
// even for absent/excused marks. Rebuild the table to allow NULL.
async function makeCheckinNullable() {
  const cols = await all('PRAGMA table_info(attendance)');
  const checkin = cols.find((c) => c.name === 'checked_in_at');
  if (!checkin || Number(checkin.notnull) === 0) return;
  await db.executeMultiple(`
    CREATE TABLE attendance_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'present',
      method TEXT NOT NULL DEFAULT 'manual',
      note TEXT,
      checked_in_at TEXT,
      checked_out_at TEXT,
      marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (event_id, student_id)
    );
    INSERT INTO attendance_new (id, event_id, student_id, status, method, note, checked_in_at, checked_out_at, marked_by)
      SELECT id, event_id, student_id, status, method, note, checked_in_at, checked_out_at, marked_by FROM attendance;
    DROP TABLE attendance;
    ALTER TABLE attendance_new RENAME TO attendance;
    CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
  `);
}

let initPromise = null;

export function initDb() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit() {
  await db.executeMultiple('PRAGMA foreign_keys = ON;');
  await db.executeMultiple(SCHEMA);
  await ensureColumn('events', 'require_student_confirm', 'require_student_confirm INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('attendance', 'checked_out_at', 'checked_out_at TEXT');
  await ensureColumn('students', 'section', 'section TEXT');
  await makeCheckinNullable();
  await db.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
  `);
}
