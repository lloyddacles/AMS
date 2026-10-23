import { Router } from 'express';
import { get, all, run, batch } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { newToken } from '../services/users.js';
import { logAudit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { notifyEventOpened, notifyEventClosed, notifyEventReopened } from '../services/notifications.js';
import { eventPhase } from '../classify.js';
import { rosterSnapshot, buildSummary } from '../services/eventSummary.js';
import {
  exclusionsByEvent,
  excludeStudents,
  includeStudents,
  setOnlyAttendees,
  clearExclusions,
  attendeeList,
  attendeeStats,
} from '../services/roster.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const selectFields = `e.id, e.name, e.description, e.location,
  e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime,
  e.checkin_code AS checkinCode, e.status, e.require_student_confirm AS requireStudentConfirm,
  e.auto_confirm AS autoConfirm,
  e.closed_at AS closedAt, e.report_summary AS reportSummary, e.created_at AS createdAt,
  e.term_id AS termId, e.schedule_id AS scheduleId,
  e.archived AS archived, e.archived_at AS archivedAt, e.series_id AS seriesId,
  (SELECT name FROM terms t WHERE t.id = e.term_id) AS termName,
  (SELECT name FROM event_series s WHERE s.id = e.series_id) AS seriesName,
  (SELECT COUNT(*) FROM events e2 WHERE e2.series_id = e.series_id) AS seriesDayCount,
  (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ('early','on-time','late','present')) AS attendanceCount,
  (SELECT COUNT(*) FROM students) - (SELECT COUNT(*) FROM event_exclusions x WHERE x.event_id = e.id) AS totalStudents`;

function parseEvent(row) {
  if (!row) return row;
  let reportSummary = null;
  if (row.reportSummary) {
    try {
      reportSummary = JSON.parse(row.reportSummary);
    } catch {
      reportSummary = null;
    }
  }
  return {
    ...row,
    archived: Number(row.archived) ? 1 : 0,
    reportSummary,
    phase: eventPhase(row),
    seriesId: row.seriesId || null,
    seriesName: row.seriesName || null,
    seriesDayCount: Number(row.seriesDayCount) || 0,
  };
}

function getEvent(id) {
  return get(`SELECT ${selectFields} FROM events e WHERE e.id = ?`, [id]).then(parseEvent);
}

// Current time as a SQLite-style UTC timestamp.
function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Compute the final per-student classification for an event and persist any
// missing students as absent, producing a locked-in summary for reporting.
async function consolidate(eventId) {
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

// List events. By default archived events are hidden so the main section stays
// focused on current work; pass ?archived=1 for the archive, ?archived=all for both.
router.get('/', async (req, res) => {
  const { termId, archived } = req.query;
  const clauses = [];
  const params = [];
  if (termId) {
    clauses.push('e.term_id = ?');
    params.push(termId);
  }
  const archivedView = archived === '1' || archived === 'true';
  const archivedAll = archived === 'all';
  if (!archivedAll) {
    clauses.push('e.archived = ?');
    params.push(archivedView ? 1 : 0);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = await all(
    `SELECT ${selectFields} FROM events e${where} ORDER BY e.event_date DESC, e.id DESC`,
    params
  );
  res.json(rows.map(parseEvent));
});

router.get('/:id', async (req, res) => {
  const event = await getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

// Who attends this event. Every student is listed and flagged; no exclusions
// recorded means everyone attends (the default).
router.get('/:id/attendees', async (req, res) => {
  const event = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(await attendeeList(event.id));
});

// Validate a request's studentIds: non-empty, deduped, all real students.
async function parseStudentIds(studentIds) {
  if (!Array.isArray(studentIds) || !studentIds.length) {
    return { error: 'studentIds must be a non-empty array' };
  }
  if (studentIds.length > 5000) {
    return { error: 'Too many students in one request (max 5000)' };
  }
  const ids = [...new Set(studentIds.map((n) => Number(n)))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    return { error: 'studentIds must be a non-empty array of student ids' };
  }
  const found = await get(
    `SELECT COUNT(*) AS c FROM students WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  if (found.c !== ids.length) return { error: 'One or more studentIds do not exist' };
  return { ids };
}

// Add or remove students from the attendee list. Removing also drops any
// check-in they already made for this event.
router.post('/:id/attendees', async (req, res) => {
  const { studentIds, attending = true } = req.body || {};
  const event = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const parsed = await parseStudentIds(studentIds);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const changed = attending
    ? await includeStudents({ eventId: event.id, studentIds: parsed.ids })
    : await excludeStudents({ eventId: event.id, studentIds: parsed.ids, userId: req.user.id });
  const list = await attendeeList(event.id);
  await logAudit({
    user: req.user,
    action: 'event.attendees',
    entity: 'event',
    entityId: event.id,
    detail: `${attending ? 'Added' : 'Removed'} ${changed} · ${list.attending}/${list.totalStudents} attending`,
  });
  res.json({ ...list, changed });
});

// Keep only the listed students on the attendee list; everyone else is removed.
router.post('/:id/attendees/only', async (req, res) => {
  const event = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const parsed = await parseStudentIds(req.body?.studentIds);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { added, removed } = await setOnlyAttendees({
    eventId: event.id,
    studentIds: parsed.ids,
    userId: req.user.id,
  });
  const list = await attendeeList(event.id);
  if (added || removed) {
    await logAudit({
      user: req.user,
      action: 'event.attendees',
      entity: 'event',
      entityId: event.id,
      detail: `Only selected · +${added} −${removed} · ${list.attending}/${list.totalStudents} attending`,
    });
  }
  res.json({ ...list, changed: added + removed, added, removed });
});

// Everyone attends again (clears all exclusions for the event).
router.post('/:id/attendees/reset', async (req, res) => {
  const event = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const changed = await clearExclusions(event.id);
  const list = await attendeeList(event.id);
  if (changed) {
    await logAudit({
      user: req.user,
      action: 'event.attendees',
      entity: 'event',
      entityId: event.id,
      detail: `Restored all attendees · ${list.attending}/${list.totalStudents} attending`,
    });
  }
  res.json({ ...list, changed });
});

// Offline scan pack: everything the scanner needs to validate and record scans
// without a connection. The client caches this in IndexedDB while online.
router.get('/:id/scan-pack', async (req, res) => {
  const event = await getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const students = await all(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
            course, year_level AS yearLevel, section, qr_token AS qrToken
     FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`
  );
  const attendance = await all(
    `SELECT student_id AS studentId, status, method,
            checked_in_at AS checkedInAt, checked_out_at AS checkedOutAt
     FROM attendance WHERE event_id = ?`,
    [req.params.id]
  );
  const settings = await getSettings();
  // Offline scanners need the attendee list to keep rejecting off-list scans.
  const excluded = (await exclusionsByEvent([event.id])).get(event.id) || new Set();
  res.json({
    event,
    students,
    attendance,
    excludedStudentIds: [...excluded],
    timezone: config.timezone,
    settings,
    generatedAt: nowUtc(),
  });
});

router.post('/', async (req, res) => {
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm, autoConfirm, termId, scheduleId } = req.body || {};
  if (!name || !eventDate) {
    return res.status(400).json({ error: 'Event name and date are required' });
  }
  const info = await run(
    `INSERT INTO events (name, description, location, event_date, start_time, end_time, checkin_code, status, require_student_confirm, auto_confirm, term_id, schedule_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name.trim(),
      description || null,
      location || null,
      eventDate,
      startTime || null,
      endTime || null,
      newToken(),
      status || 'active',
      requireStudentConfirm ? 1 : 0,
      autoConfirm ? 1 : 0,
      termId || null,
      scheduleId || null,
    ]
  );
  const created = await getEvent(info.lastInsertRowid);
  await logAudit({
    user: req.user,
    action: 'event.create',
    entity: 'event',
    entityId: created.id,
    detail: created.name,
  });
  await notifyEventOpened(created).catch(() => {});
  res.status(201).json(created);
});

router.put('/:id', async (req, res) => {
  const existing = await get('SELECT * FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm, autoConfirm, termId, scheduleId } = req.body || {};
  const nextName = String(name ?? existing.name).trim();
  const nextDate = String(eventDate ?? existing.event_date).trim();
  if (!nextName || !nextDate) {
    return res.status(400).json({ error: 'Event name and date are required' });
  }
  // An active event must always be visible in the main list, so reopening via
  // the edit form pulls it out of the archive automatically.
  const nextStatus = status ?? existing.status;
  const nextArchived = nextStatus === 'active' ? 0 : (Number(existing.archived) ? 1 : 0);
  const nextArchivedAt = nextArchived ? existing.archived_at : null;
  await run(
    `UPDATE events SET name = ?, description = ?, location = ?, event_date = ?,
      start_time = ?, end_time = ?, status = ?, archived = ?, archived_at = ?,
      require_student_confirm = ?, auto_confirm = ?, term_id = ?, schedule_id = ? WHERE id = ?`,
    [
      nextName,
      description ?? existing.description,
      location ?? existing.location,
      nextDate,
      startTime ?? existing.start_time,
      endTime ?? existing.end_time,
      nextStatus,
      nextArchived,
      nextArchivedAt,
      requireStudentConfirm === undefined ? existing.require_student_confirm : (requireStudentConfirm ? 1 : 0),
      autoConfirm === undefined ? existing.auto_confirm : (autoConfirm ? 1 : 0),
      termId === undefined ? existing.term_id : (termId || null),
      scheduleId === undefined ? existing.schedule_id : (scheduleId || null),
      req.params.id,
    ]
  );
  const updated = await getEvent(req.params.id);
  await logAudit({
    user: req.user,
    action: 'event.update',
    entity: 'event',
    entityId: updated.id,
    detail: updated.name,
  });
  res.json(updated);
});

router.post('/:id/regenerate-code', async (req, res) => {
  const existing = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  await run('UPDATE events SET checkin_code = ? WHERE id = ?', [newToken(), req.params.id]);
  const updated = await getEvent(req.params.id);
  await logAudit({
    user: req.user,
    action: 'event.regenerate-code',
    entity: 'event',
    entityId: updated.id,
    detail: updated.name,
  });
  res.json(updated);
});

// Close the event and consolidate attendance: every student without a record is
// locked in as absent, and a final summary is stored for reporting.
router.post('/:id/close', async (req, res) => {
  const existing = await get('SELECT id, status FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const summary = await consolidate(req.params.id);
  const event = await getEvent(req.params.id);
  await logAudit({
    user: req.user,
    action: 'event.close',
    entity: 'event',
    entityId: event.id,
    detail: `${event.name} · attended ${summary.attended}/${summary.totalStudents} (${summary.rate}%)`,
  });
  await notifyEventClosed(event, summary).catch(() => {});
  res.json({ ...event, reportSummary: summary });
});

// Reopen a closed event so corrections can be made. Removes the auto-generated
// absent rows so students can check in again; manual marks are kept.
router.post('/:id/reopen', async (req, res) => {
  const existing = await get('SELECT id FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  await run("DELETE FROM attendance WHERE event_id = ? AND method = 'auto' AND checked_in_at IS NULL", [req.params.id]);
  await run("UPDATE events SET status = 'active', closed_at = NULL, report_summary = NULL, archived = 0, archived_at = NULL WHERE id = ?", [req.params.id]);
  const event = await getEvent(req.params.id);
  await logAudit({
    user: req.user,
    action: 'event.reopen',
    entity: 'event',
    entityId: event.id,
    detail: event.name,
  });
  await notifyEventReopened(event).catch(() => {});
  res.json(event);
});

// Archive a closed event: it leaves the main list and lives in the Archived
// section instead. Attendance history is untouched, so reports still include it.
router.post('/:id/archive', async (req, res) => {
  const existing = await get('SELECT id, name, status, archived FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (Number(existing.archived)) return res.status(400).json({ error: 'Event is already archived' });
  if (existing.status !== 'closed') {
    return res.status(400).json({ error: 'Only closed events can be archived' });
  }
  await run('UPDATE events SET archived = 1, archived_at = ? WHERE id = ?', [nowUtc(), req.params.id]);
  const event = await getEvent(req.params.id);
  await logAudit({
    user: req.user,
    action: 'event.archive',
    entity: 'event',
    entityId: event.id,
    detail: event.name,
  });
  res.json(event);
});

// Move an archived event back into the main list.
router.post('/:id/unarchive', async (req, res) => {
  const existing = await get('SELECT id, name, archived FROM events WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (!Number(existing.archived)) return res.status(400).json({ error: 'Event is not archived' });
  await run('UPDATE events SET archived = 0, archived_at = NULL WHERE id = ?', [req.params.id]);
  const event = await getEvent(req.params.id);
  await logAudit({
    user: req.user,
    action: 'event.unarchive',
    entity: 'event',
    entityId: event.id,
    detail: event.name,
  });
  res.json(event);
});


// List all event series with their days.
router.get('/series/list', async (req, res) => {
  const rows = await all(
    `SELECT s.id, s.name, s.created_at AS createdAt,
            (SELECT COUNT(*) FROM events e WHERE e.series_id = s.id) AS dayCount
     FROM event_series s
     ORDER BY s.id DESC`
  );
  res.json(rows);
});

// Create a new series from existing events (or start empty).
router.post('/series', async (req, res) => {
  const { name, eventIds = [] } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Series name is required' });
  const info = await run('INSERT INTO event_series (name, created_by) VALUES (?, ?)', [String(name).trim(), req.user.id]);
  const seriesId = info.lastInsertRowid;
  if (Array.isArray(eventIds) && eventIds.length) {
    const ids = [...new Set(eventIds.map((n) => Number(n)))];
    const inPlaceholders = ids.map(() => '?').join(',');
    const conflicts = await get(
      `SELECT COUNT(*) AS c FROM events WHERE id IN (${inPlaceholders}) AND series_id IS NOT NULL`,
      ids
    );
    if (conflicts.c) return res.status(400).json({ error: 'One or more events already belong to a series' });
    for (const eid of ids) {
      await run('UPDATE events SET series_id = ? WHERE id = ?', [seriesId, eid]);
    }
  }
  const days = await all(
    `SELECT ${selectFields} FROM events e WHERE e.series_id = ? ORDER BY e.event_date, e.id`,
    [seriesId]
  );
  await logAudit({ user: req.user, action: 'event.series.create', entity: 'series', entityId: String(seriesId), detail: name.trim() });
  res.status(201).json({ id: seriesId, name: name.trim(), days: days.map(parseEvent) });
});

// Add a continuation day to an existing series.
router.post('/:id/continue', async (req, res) => {
  const existing = await getEvent(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm, autoConfirm, termId } = req.body || {};
  if (!eventDate) return res.status(400).json({ error: 'Date is required for the continuation day' });
  let seriesId = existing.seriesId;
  let seriesName = existing.seriesName;
  if (!seriesId) {
    const info = await run('INSERT INTO event_series (name, created_by) VALUES (?, ?)', [existing.name, req.user.id]);
    seriesId = info.lastInsertRowid;
    seriesName = existing.name;
    await run('UPDATE events SET series_id = ? WHERE id = ?', [seriesId, existing.id]);
  }
  const info2 = await run(
    `INSERT INTO events (name, description, location, event_date, start_time, end_time, checkin_code, status, require_student_confirm, auto_confirm, term_id, schedule_id, series_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name?.trim() || seriesName,
      description ?? existing.description,
      location ?? existing.location,
      eventDate,
      startTime ?? existing.startTime,
      endTime ?? existing.endTime,
      newToken(),
      status || 'active',
      requireStudentConfirm === undefined ? existing.requireStudentConfirm : (requireStudentConfirm ? 1 : 0),
      autoConfirm === undefined ? existing.autoConfirm : (autoConfirm ? 1 : 0),
      termId === undefined ? existing.termId : (termId || null),
      existing.scheduleId,
      seriesId,
    ]
  );
  const newId = info2.lastInsertRowid;
  const first = await get('SELECT id FROM events WHERE series_id = ? ORDER BY event_date, id LIMIT 1', [seriesId]);
  if (first) {
    const exclusions = await all('SELECT student_id AS studentId, excluded_by AS excludedBy FROM event_exclusions WHERE event_id = ?', [first.id]);
    if (exclusions.length) {
      await batch(
        exclusions.map((x) => ({
          sql: 'INSERT OR IGNORE INTO event_exclusions (event_id, student_id, excluded_by) VALUES (?, ?, ?)',
          args: [newId, x.studentId, x.excludedBy || req.user.id],
        })),
        'write'
      );
    }
  }
  const created = await getEvent(newId);
  await logAudit({ user: req.user, action: 'event.series.continue', entity: 'event', entityId: String(newId), detail: `${seriesName} · ${eventDate}` });
  res.status(201).json(created);
});

// Get all days in a series.
router.get('/series/:id', async (req, res) => {
  const series = await get('SELECT * FROM event_series WHERE id = ?', [req.params.id]);
  if (!series) return res.status(404).json({ error: 'Series not found' });
  const days = await all(
    `SELECT ${selectFields} FROM events e WHERE e.series_id = ? ORDER BY e.event_date, e.id`,
    [req.params.id]
  );
  res.json({ id: series.id, name: series.name, days: days.map(parseEvent) });
});

// Detach an event from its series.
router.post('/series/:id/detach', async (req, res) => {
  const { eventId } = req.body || {};
  if (!eventId) return res.status(400).json({ error: 'eventId required' });
  const ev = await get('SELECT id, series_id AS seriesId FROM events WHERE id = ?', [Number(eventId)]);
  if (!ev || ev.seriesId !== Number(req.params.id)) return res.status(404).json({ error: 'Event not in this series' });
  await run('UPDATE events SET series_id = NULL WHERE id = ?', [ev.id]);
  await logAudit({ user: req.user, action: 'event.series.detach', entity: 'event', entityId: String(ev.id), detail: String(req.params.id) });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const event = await getEvent(req.params.id);
  const info = await run('DELETE FROM events WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Event not found' });
  await logAudit({
    user: req.user,
    action: 'event.delete',
    entity: 'event',
    entityId: req.params.id,
    detail: event?.name || null,
  });
  res.json({ ok: true });
});

export default router;
