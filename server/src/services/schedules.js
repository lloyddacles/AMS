import { get, all, batch, run } from '../db.js';
import { newToken } from './users.js';

// Weekdays are stored as a CSV of JS day numbers (0 = Sunday … 6 = Saturday).
export function parseWeekdays(value) {
  return String(value || '')
    .split(',')
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export function weekdayLabel(days) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return [...new Set(days)].sort((a, b) => a - b).map((d) => names[d]).join(', ');
}

function toDate(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const SCHEDULE_FIELDS = `s.id, s.term_id AS termId, s.name, s.description, s.location,
  s.weekdays, s.start_time AS startTime, s.end_time AS endTime,
  s.start_date AS startDate, s.end_date AS endDate,
  s.require_student_confirm AS requireStudentConfirm, s.active,
  s.last_generated_date AS lastGeneratedDate, s.created_at AS createdAt,
  t.name AS termName,
  (SELECT COUNT(*) FROM events e WHERE e.schedule_id = s.id) AS eventCount`;

export function parseSchedule(row) {
  if (!row) return row;
  const days = parseWeekdays(row.weekdays);
  return { ...row, active: Number(row.active) ? 1 : 0, weekdayList: days, weekdayLabel: weekdayLabel(days) };
}

export function getSchedule(id) {
  return get(`SELECT ${SCHEDULE_FIELDS} FROM schedules s LEFT JOIN terms t ON t.id = s.term_id WHERE s.id = ?`, [id]).then(parseSchedule);
}

const MAX_OCCURRENCES = 400;

// Materialize one event per matching weekday between the schedule (or its term)
// start and end date. Idempotent: dates that already have an event for this
// schedule are skipped, so it is safe to run repeatedly.
export async function generateScheduleEvents(scheduleId) {
  const schedule = await get('SELECT * FROM schedules WHERE id = ?', [scheduleId]);
  if (!schedule) return null;

  const days = new Set(parseWeekdays(schedule.weekdays));
  if (!days.size) return { created: 0, skipped: 0, dates: [] };

  let start = schedule.start_date;
  let end = schedule.end_date;
  if (schedule.term_id) {
    const term = await get('SELECT start_date, end_date FROM terms WHERE id = ?', [schedule.term_id]);
    if (term) {
      if (term.start_date > start) start = term.start_date;
      if (term.end_date < end) end = term.end_date;
    }
  }

  const startMs = toDate(start);
  const endMs = toDate(end);
  if (startMs == null || endMs == null || endMs < startMs) {
    return { created: 0, skipped: 0, dates: [] };
  }

  const existing = await all('SELECT event_date AS d FROM events WHERE schedule_id = ?', [scheduleId]);
  const existingDates = new Set(existing.map((r) => r.d));

  const statements = [];
  const createdDates = [];
  let skipped = 0;
  for (let ms = startMs, i = 0; ms <= endMs && i < MAX_OCCURRENCES; ms += 86400000, i++) {
    const weekday = new Date(ms).getUTCDay();
    if (!days.has(weekday)) continue;
    const date = iso(ms);
    if (existingDates.has(date)) {
      skipped += 1;
      continue;
    }
    statements.push({
      sql: `INSERT INTO events (name, description, location, event_date, start_time, end_time, checkin_code, status, require_student_confirm, term_id, schedule_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      args: [
        schedule.name,
        schedule.description,
        schedule.location,
        date,
        schedule.start_time,
        schedule.end_time,
        newToken(),
        schedule.require_student_confirm ? 1 : 0,
        schedule.term_id,
        scheduleId,
      ],
    });
    createdDates.push(date);
  }

  if (statements.length) await batch(statements, 'write');
  if (createdDates.length) {
    await run('UPDATE schedules SET last_generated_date = ? WHERE id = ?', [createdDates[createdDates.length - 1], scheduleId]);
  }

  return { created: createdDates.length, skipped, dates: createdDates };
}
