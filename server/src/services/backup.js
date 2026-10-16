import { all, batch } from '../db.js';

// Full-fidelity snapshot of the database. Column lists are fixed here (rather
// than `SELECT *`) so imports stay stable even if column order changes.
const TABLES = {
  users: ['id', 'username', 'password_hash', 'name', 'role', 'avatar', 'active', 'must_change_password', 'created_at'],
  terms: ['id', 'name', 'start_date', 'end_date', 'min_attendance', 'is_current', 'created_at'],
  schedules: ['id', 'term_id', 'name', 'description', 'location', 'weekdays', 'start_time', 'end_time', 'start_date', 'end_date', 'require_student_confirm', 'active', 'last_generated_date', 'created_at'],
  students: ['id', 'student_no', 'first_name', 'last_name', 'email', 'course', 'year_level', 'section', 'qr_token', 'created_at'],
  events: ['id', 'name', 'description', 'location', 'event_date', 'start_time', 'end_time', 'checkin_code', 'status', 'archived', 'archived_at', 'require_student_confirm', 'created_at', 'closed_at', 'report_summary', 'term_id', 'schedule_id'],
  attendance: ['id', 'event_id', 'student_id', 'status', 'method', 'note', 'checked_in_at', 'checked_out_at', 'marked_by'],
  settings: ['key', 'value', 'updated_at'],
  scan_receipts: ['client_scan_id', 'attendance_id', 'action', 'created_at'],
  audit_log: ['id', 'user_id', 'user_name', 'action', 'entity', 'entity_id', 'detail', 'created_at'],
  notifications: ['id', 'type', 'title', 'body', 'severity', 'audience', 'link', 'data', 'dedupe_key', 'created_at'],
  notification_reads: ['notification_id', 'user_id', 'read_at'],
};

// Delete children before parents; insert parents before children.
const DELETE_ORDER = ['notification_reads', 'notifications', 'attendance', 'scan_receipts', 'audit_log', 'settings', 'events', 'schedules', 'terms', 'students', 'users'];
const INSERT_ORDER = ['users', 'terms', 'schedules', 'students', 'events', 'attendance', 'settings', 'scan_receipts', 'audit_log', 'notifications', 'notification_reads'];

export async function exportData() {
  const tables = {};
  for (const [name, cols] of Object.entries(TABLES)) {
    tables[name] = await all(`SELECT ${cols.join(', ')} FROM ${name}`);
  }
  return { app: 'AttendX', version: 1, exportedAt: new Date().toISOString(), tables };
}

export async function backupSummary() {
  const summary = {};
  for (const name of Object.keys(TABLES)) {
    summary[name] = (await all(`SELECT COUNT(*) AS c FROM ${name}`))[0].c;
  }
  return summary;
}

export async function importData(payload) {
  if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object') {
    return { ok: false, status: 400, error: 'Invalid backup file' };
  }

  const statements = [];
  for (const name of DELETE_ORDER) statements.push({ sql: `DELETE FROM ${name}`, args: [] });

  const counts = {};
  for (const name of INSERT_ORDER) {
    const rows = payload.tables[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      return { ok: false, status: 400, error: `Table "${name}" must be an array` };
    }
    const cols = TABLES[name];
    counts[name] = rows.length;
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        return { ok: false, status: 400, error: `Invalid row in "${name}"` };
      }
      // Columns the backup doesn't carry are omitted so SQLite applies the
      // column default (keeps older backup files importable).
      const present = cols.filter((c) => row[c] !== undefined);
      const placeholders = present.map(() => '?').join(', ');
      statements.push({
        sql: present.length
          ? `INSERT INTO ${name} (${present.join(', ')}) VALUES (${placeholders})`
          : `INSERT INTO ${name} DEFAULT VALUES`,
        args: present.map((c) => row[c]),
      });
    }
  }

  // One atomic batch: either the whole dataset is replaced or nothing changes.
  await batch(statements, 'write');
  return { ok: true, counts };
}
