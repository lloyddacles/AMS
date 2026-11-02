import { get, all, run, batch } from '../db.js';
import { displayStatus } from '../classify.js';
import { exclusionsByEvent } from './roster.js';

// Current time as a SQLite-style UTC timestamp.
export function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Roster-aware snapshot of an event's attendance: who attends, what is recorded
// and who has no record yet (those become absent when the event closes).
export async function rosterSnapshot(eventId) {
  const excluded = (await exclusionsByEvent([Number(eventId)])).get(Number(eventId)) || new Set();
  const records = (await all('SELECT * FROM attendance WHERE event_id = ?', [eventId])).filter(
    (r) => !excluded.has(r.student_id)
  );
  const byStudent = new Map(records.map((r) => [r.student_id, r]));
  const students = (await all('SELECT id FROM students')).filter((s) => !excluded.has(s.id));
  const missing = students.filter((s) => !byStudent.has(s.id));
  return { excluded, records, byStudent, students, missing };
}

// Final per-student classification counts plus the attendance rate. Students
// off the attendee list are skipped entirely; no-record students count absent.
export function buildSummary(event, snapshot, closedAt = null) {
  const { records, students, missing } = snapshot;
  const counts = { early: 0, onTime: 0, late: 0, excused: 0, absent: 0 };
  for (const r of records) {
    const cls = displayStatus(event, r);
    if (cls === 'early') counts.early += 1;
    else if (cls === 'on-time' || cls === 'present') counts.onTime += 1;
    else if (cls === 'late') counts.late += 1;
    else if (cls === 'excused') counts.excused += 1;
    else counts.absent += 1;
  }
  counts.absent += missing.length;

  const attended = counts.early + counts.onTime + counts.late;
  const totalStudents = students.length;
  const summary = {
    totalStudents,
    attended,
    early: counts.early,
    onTime: counts.onTime,
    late: counts.late,
    excused: counts.excused,
    absent: counts.absent,
    rate: totalStudents ? Math.round((attended / totalStudents) * 100) : 0,
  };
  if (closedAt) summary.closedAt = closedAt;
  return summary;
}

// Close an event and consolidate attendance: every student without a record is
// locked in as absent, and a final summary is stored for reporting. Shared by
// the manual close route and the background automation worker.
export async function consolidateEvent(eventId) {
  const event = await get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) return null;

  // Students off the attendee list are neither rolled in as absent nor counted.
  const snapshot = await rosterSnapshot(eventId);
  if (snapshot.missing.length) {
    const statements = snapshot.missing.map((s) => ({
      sql: `INSERT INTO attendance (event_id, student_id, status, method, note)
            VALUES (?, ?, 'absent', 'auto', 'Auto-consolidated on event close')`,
      args: [eventId, s.id],
    }));
    await batch(statements, 'write');
  }

  const summary = buildSummary(event, snapshot, nowUtc());
  await run('UPDATE events SET status = ?, closed_at = ?, report_summary = ? WHERE id = ?', [
    'closed',
    summary.closedAt,
    JSON.stringify(summary),
    eventId,
  ]);
  return summary;
}

// Re-derive report_summary for a closed event after attendance changes (an
// approved correction). Only the summary JSON is rewritten — closed_at keeps
// its original value so the "locked report" timestamp stays honest.
export async function refreshClosedSummary(eventId) {
  const event = await get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event || event.status !== 'closed' || !event.report_summary) return null;
  let previous = null;
  try {
    previous = JSON.parse(event.report_summary);
  } catch {
    previous = null;
  }
  const snapshot = await rosterSnapshot(eventId);
  const summary = buildSummary(event, snapshot, previous?.closedAt || event.closed_at || null);
  await run('UPDATE events SET report_summary = ? WHERE id = ?', [JSON.stringify(summary), eventId]);
  return summary;
}
