import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
`);

// Lightweight migrations for databases created before a column existed.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// Older databases had `checked_in_at NOT NULL`, which forced an artificial time-in
// even for absent/excused marks. Rebuild the table to allow NULL.
function makeCheckinNullable() {
  const cols = db.prepare('PRAGMA table_info(attendance)').all();
  const checkin = cols.find((c) => c.name === 'checked_in_at');
  if (!checkin || checkin.notnull === 0) return;
  db.exec(`
    BEGIN;
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
    COMMIT;
  `);
}

ensureColumn('events', 'require_student_confirm', 'require_student_confirm INTEGER NOT NULL DEFAULT 0');
ensureColumn('attendance', 'checked_out_at', 'checked_out_at TEXT');
ensureColumn('students', 'section', 'section TEXT');
makeCheckinNullable();
db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);');
