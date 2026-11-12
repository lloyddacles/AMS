import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const isLocalFile = config.dbUrl.startsWith('file:');

// Ensure the local data directory exists for file-based (development) databases.
if (isLocalFile) {
  const filePath = config.dbUrl.slice('file:'.length);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// Lazily create the client so any failure surfaces as a normal request error
// (instead of crashing the whole function at import time). Use the native
// client for local files and the pure-HTTP (web) client for remote libSQL/Turso
// URLs, so serverless deploys don't depend on a native binding. The import
// specifiers are literal strings so the bundler can trace them.
let clientPromise = null;

function createClientPromise() {
  if (isLocalFile) {
    return import('@libsql/client').then((m) =>
      m.createClient({ url: config.dbUrl, authToken: config.dbAuthToken })
    );
  }
  return import('@libsql/client/web').then((m) =>
    m.createClient({ url: config.dbUrl, authToken: config.dbAuthToken })
  );
}

function getClient() {
  if (!clientPromise) clientPromise = createClientPromise();
  return clientPromise;
}

// ---- Small helpers mirroring the previous better-sqlite3 API ----
export async function get(sql, args = []) {
  const client = await getClient();
  const rs = await client.execute({ sql, args });
  return rs.rows[0] ?? null;
}

export async function all(sql, args = []) {
  const client = await getClient();
  const rs = await client.execute({ sql, args });
  return rs.rows;
}

export async function run(sql, args = []) {
  const client = await getClient();
  const rs = await client.execute({ sql, args });
  return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
}

export async function batch(statements, mode = 'write') {
  const client = await getClient();
  return client.batch(statements, mode);
}

// Run multiple statements atomically as a write batch/transaction.
export async function transaction(statements) {
  if (!statements || statements.length === 0) return [];
  return batch(statements, 'write');
}

async function execute(sql) {
  const client = await getClient();
  return client.execute(sql);
}

async function executeMultiple(sql) {
  const client = await getClient();
  return client.executeMultiple(sql);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    avatar TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
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
    status TEXT NOT NULL DEFAULT 'Active',
    qr_token TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    password_set_at TEXT,
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
    archived INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    require_student_confirm INTEGER NOT NULL DEFAULT 0,
    auto_confirm INTEGER NOT NULL DEFAULT 0,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Multi-day / continuation events: several events (one per day) share a
  -- series and are counted as ONE logical event in reports and stats.
  CREATE TABLE IF NOT EXISTS event_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

  CREATE TABLE IF NOT EXISTS scan_receipts (
    client_scan_id TEXT PRIMARY KEY,
    attendance_id INTEGER,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);

  -- Per-event attendee list: a row here means the student does NOT attend the
  -- event. No rows for an event = everyone attends (the default).
  CREATE TABLE IF NOT EXISTS event_exclusions (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    excluded_at TEXT NOT NULL DEFAULT (datetime('now')),
    excluded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (event_id, student_id)
  );
  CREATE INDEX IF NOT EXISTS idx_exclusions_event ON event_exclusions(event_id);
  CREATE INDEX IF NOT EXISTS idx_exclusions_student ON event_exclusions(student_id);

  -- Student-submitted attendance corrections: one pending request per student
  -- per event; staff approve (updates attendance) or reject with a note.
  CREATE TABLE IF NOT EXISTS attendance_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    requested_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolution_note TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT,
    submitted_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_corrections_status ON attendance_corrections(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_corrections_event ON attendance_corrections(event_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_corrections_pending ON attendance_corrections(event_id, student_id) WHERE status = 'pending';

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    username TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    first_failed_at TEXT,
    locked_until TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    severity TEXT NOT NULL DEFAULT 'info',
    audience TEXT NOT NULL DEFAULT 'all',
    link TEXT,
    data TEXT,
    dedupe_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

  CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (notification_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    min_attendance INTEGER NOT NULL DEFAULT 80,
    is_current INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id INTEGER REFERENCES terms(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    location TEXT,
    weekdays TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    require_student_confirm INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    last_generated_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Documented interventions/follow-up actions for students flagged due to
  -- excessive absences/tardiness (proof for reporting, e.g. CARES).
  CREATE TABLE IF NOT EXISTS student_interventions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    intervention_date TEXT NOT NULL,
    flagged_triggers TEXT,
    cause_category TEXT,
    cause_details TEXT,
    action_taken TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'recorded',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_interventions_student ON student_interventions(student_id, created_at);

  -- Academic structure for department/program scoping.
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (department_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_programs_department ON programs(department_id);
`;

// Lightweight migrations for databases created before a column existed.
async function ensureColumn(table, column, ddl) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// Older databases had `checked_in_at NOT NULL`, which forced an artificial time-in
// even for absent/excused marks. Rebuild the table to allow NULL.
async function makeCheckinNullable() {
  const cols = await all('PRAGMA table_info(attendance)');
  const checkin = cols.find((c) => c.name === 'checked_in_at');
  if (!checkin || Number(checkin.notnull) === 0) return;
  await executeMultiple(`
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

async function seedAcademicStructure() {
  const defaults = [
    {
      department: 'College of Business Management',
      programs: [
        'Bachelor of Science in Entrepreneurship with Specialization in Microfinance',
        'Bachelor of Science in Tourism Management',
      ],
    },
    {
      department: 'College of Accountancy',
      programs: [
        'Bachelor of Science in Accountancy',
        'Bachelor of Science in Accounting Information Systems',
      ],
    },
    { department: 'College of Computer Studies', programs: ['Bachelor of Science in Information Systems'] },
    { department: 'College of Criminal Justice', programs: [] },
  ];

  for (const item of defaults) {
    let dept = await get('SELECT id, name FROM departments WHERE name = ?', [item.department]);
    if (!dept) {
      const info = await run('INSERT INTO departments (name) VALUES (?)', [item.department]);
      dept = { id: info.lastInsertRowid, name: item.department };
    }
    for (const prog of item.programs) {
      const existing = await get('SELECT id FROM programs WHERE department_id = ? AND name = ?', [dept.id, prog]);
      if (!existing) {
        await run('INSERT INTO programs (department_id, name, active) VALUES (?, ?, 1)', [dept.id, prog]);
      }
    }
  }

  // Best-effort backfill: map existing student course text to a matching program.
  const programs = await all('SELECT id, name, department_id AS departmentId FROM programs WHERE active = 1');
  for (const p of programs) {
    await run(
      `UPDATE students
         SET program_id = COALESCE(program_id, ?), department_id = COALESCE(department_id, ?)
       WHERE program_id IS NULL
         AND TRIM(LOWER(COALESCE(course, ''))) = TRIM(LOWER(?))`,
      [p.id, p.departmentId, p.name]
    );
  }
  // If course contains the program name (common short forms), try a looser match for unlinked students.
  for (const p of programs) {
    await run(
      `UPDATE students
         SET program_id = COALESCE(program_id, ?), department_id = COALESCE(department_id, ?)
       WHERE program_id IS NULL
         AND course IS NOT NULL AND course != ''
         AND INSTR(LOWER(course), LOWER(?)) > 0`,
      [p.id, p.departmentId, p.name]
    );
  }
}

async function doInit() {
  await executeMultiple('PRAGMA foreign_keys = ON;');
  await executeMultiple(SCHEMA);
  await executeMultiple(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await ensureColumn('events', 'require_student_confirm', 'require_student_confirm INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('events', 'auto_confirm', 'auto_confirm INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('events', 'closed_at', 'closed_at TEXT');
  await ensureColumn('events', 'report_summary', 'report_summary TEXT');
  await ensureColumn('attendance', 'checked_out_at', 'checked_out_at TEXT');
  await ensureColumn('students', 'section', 'section TEXT');
  await ensureColumn('students', 'status', "status TEXT NOT NULL DEFAULT 'Active'");
  await ensureColumn('students', 'password_hash', 'password_hash TEXT');
  await ensureColumn('students', 'password_set_at', 'password_set_at TEXT');
  await ensureColumn('students', 'program_id', 'program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL');
  await ensureColumn('students', 'department_id', 'department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL');
  await ensureColumn('users', 'avatar', 'avatar TEXT');
  await ensureColumn('users', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('users', 'must_change_password', 'must_change_password INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('users', 'department_id', 'department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL');
  await ensureColumn('users', 'program_id', 'program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL');
  await ensureColumn('notifications', 'data', 'data TEXT');
  await ensureColumn('events', 'term_id', 'term_id INTEGER');
  await ensureColumn('events', 'schedule_id', 'schedule_id INTEGER');
  await ensureColumn('events', 'series_id', 'series_id INTEGER');
  await ensureColumn('events', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('events', 'archived_at', 'archived_at TEXT');
  await ensureColumn('events', 'department_id', 'department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL');
  await ensureColumn('events', 'program_id', 'program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL');
  await ensureColumn('schedules', 'department_id', 'department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL');
  await ensureColumn('schedules', 'program_id', 'program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL');
  await ensureColumn('terms', 'min_attendance', 'min_attendance INTEGER NOT NULL DEFAULT 80');
  await makeCheckinNullable();
  await executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance(event_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
    CREATE INDEX IF NOT EXISTS idx_events_term ON events(term_id);
    CREATE INDEX IF NOT EXISTS idx_events_schedule ON events(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);
    CREATE INDEX IF NOT EXISTS idx_events_department ON events(department_id);
    CREATE INDEX IF NOT EXISTS idx_events_program ON events(program_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_term ON schedules(term_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_department ON schedules(department_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_program ON schedules(program_id);
    CREATE INDEX IF NOT EXISTS idx_interventions_student ON student_interventions(student_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_students_program ON students(program_id);
    CREATE INDEX IF NOT EXISTS idx_students_department ON students(department_id);
    CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
    CREATE INDEX IF NOT EXISTS idx_users_program ON users(program_id);
  `);
  await seedAcademicStructure();
  // Record baseline/phase migrations so readiness checks can report status.
  for (const name of ['001_baseline_schema', '002_attendance_nullable_checkin', '003_event_archive_series_terms', '004_departments_programs_scoping', '005_event_department_program_scoping', '006_schedule_department_program_scoping']) {
    await run(`INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)`, [name]);
  }
}
