import { all, get, run, batch } from '../db.js';

// Per-event attendee list.
//
// An event with no rows in `event_exclusions` includes every student (the
// default). A row means "this student does not attend this event", which also
// keeps them out of scans, reports and the absence roll-call when the event
// closes. Excluding a student drops their check-in record for that event so no
// orphaned attendance survives the roster change.

// Exclusion rows for the given events (all events when eventIds is null).
export async function listExclusions(eventIds = null) {
  if (eventIds && eventIds.length === 0) return [];
  if (eventIds) {
    const placeholders = eventIds.map(() => '?').join(',');
    return all(
      `SELECT event_id AS eventId, student_id AS studentId FROM event_exclusions
       WHERE event_id IN (${placeholders})`,
      eventIds
    );
  }
  return all('SELECT event_id AS eventId, student_id AS studentId FROM event_exclusions');
}

// eventId -> Set(studentId)
export async function exclusionsByEvent(eventIds = null) {
  const rows = await listExclusions(eventIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.eventId)) map.set(r.eventId, new Set());
    map.get(r.eventId).add(r.studentId);
  }
  return map;
}

// studentId -> number of excluded events (within the given scope)
export async function exclusionCountsByStudent(eventIds = null) {
  const rows = await listExclusions(eventIds);
  const map = new Map();
  for (const r of rows) map.set(r.studentId, (map.get(r.studentId) || 0) + 1);
  return map;
}

export async function isExcluded(eventId, studentId) {
  const row = await get(
    'SELECT 1 AS x FROM event_exclusions WHERE event_id = ? AND student_id = ?',
    [eventId, studentId]
  );
  return !!row;
}

// Remove students from an event: record the exclusion and drop any check-in
// they already made for it. Returns how many students were newly excluded.
export async function excludeStudents({ eventId, studentIds = [], userId = null }) {
  const ids = [...new Set(studentIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return 0;
  let changed = 0;
  const deletes = [];
  for (const sid of ids) {
    const info = await run(
      'INSERT OR IGNORE INTO event_exclusions (event_id, student_id, excluded_by) VALUES (?, ?, ?)',
      [eventId, sid, userId]
    );
    if (info.changes) changed += 1;
    deletes.push({
      sql: 'DELETE FROM attendance WHERE event_id = ? AND student_id = ?',
      args: [eventId, sid],
    });
  }
  if (deletes.length) await batch(deletes, 'write');
  return changed;
}

// Put students back on the event (fresh: their previous check-in is not restored).
export async function includeStudents({ eventId, studentIds = [] }) {
  const ids = [...new Set(studentIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const info = await run(
    `DELETE FROM event_exclusions WHERE event_id = ? AND student_id IN (${placeholders})`,
    [eventId, ...ids]
  );
  return info.changes || 0;
}

// Keep exactly these students on the list: the selected ones are put back on
// and everyone else is removed (their check-in for the event is deleted).
// Done in bulk statements so large cohorts stay fast. Returns how many were
// added back and how many were newly removed.
export async function setOnlyAttendees({ eventId, studentIds = [], userId = null }) {
  const ids = [...new Set(studentIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return { added: 0, removed: 0 };
  const keep = ids.map(() => '?').join(',');
  const added = await run(
    `DELETE FROM event_exclusions WHERE event_id = ? AND student_id IN (${keep})`,
    [eventId, ...ids]
  );
  const removed = await run(
    `INSERT OR IGNORE INTO event_exclusions (event_id, student_id, excluded_by)
     SELECT ?, id, ? FROM students WHERE id NOT IN (${keep})`,
    [eventId, userId, ...ids]
  );
  await run(`DELETE FROM attendance WHERE event_id = ? AND student_id NOT IN (${keep})`, [eventId, ...ids]);
  return { added: added.changes || 0, removed: removed.changes || 0 };
}

// Everyone attends again.
export async function clearExclusions(eventId) {
  const info = await run('DELETE FROM event_exclusions WHERE event_id = ?', [eventId]);
  return info.changes || 0;
}

// Attendee summary for the UI.
export async function attendeeStats(eventId) {
  const total = (await get('SELECT COUNT(*) AS c FROM students')).c;
  const excludedRows = await listExclusions([eventId]);
  const excludedIds = new Set(excludedRows.map((r) => r.studentId));
  return {
    mode: excludedIds.size ? 'custom' : 'all',
    totalStudents: total,
    excludedCount: excludedIds.size,
    attending: Math.max(0, total - excludedIds.size),
  };
}

// Full attendee list (every student, flagged as attending or not).
export async function attendeeList(eventId) {
  const stats = await attendeeStats(eventId);
  const rows = await all(
    `SELECT id AS studentId, student_no AS studentNo, first_name AS firstName,
            last_name AS lastName, course, year_level AS yearLevel, section
     FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`
  );
  const excludedRows = await listExclusions([eventId]);
  const excluded = new Map(excludedRows.map((r) => [r.studentId, r]));
  return {
    ...stats,
    students: rows.map((s) => ({ ...s, attending: !excluded.has(s.studentId) })),
    excludedStudentIds: rows.filter((s) => excluded.has(s.studentId)).map((s) => s.studentId),
  };
}
