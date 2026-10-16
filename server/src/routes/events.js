import { Router } from 'express';
import { get, all, run, batch } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { newToken } from '../services/users.js';
import { logAudit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { notifyEventOpened, notifyEventClosed, notifyEventReopened } from '../services/notifications.js';
import { displayStatus, eventPhase } from '../classify.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const selectFields = `e.id, e.name, e.description, e.location,
  e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime,
  e.checkin_code AS checkinCode, e.status, e.require_student_confirm AS requireStudentConfirm,
  e.closed_at AS closedAt, e.report_summary AS reportSummary, e.created_at AS createdAt,
  e.term_id AS termId, e.schedule_id AS scheduleId,
  e.archived AS archived, e.archived_at AS archivedAt,
  (SELECT name FROM terms t WHERE t.id = e.term_id) AS termName,
  (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id AND a.status IN ('early','on-time','late','present')) AS attendanceCount,
  (SELECT COUNT(*) FROM students) AS totalStudents`;

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
  return { ...row, archived: Number(row.archived) ? 1 : 0, reportSummary, phase: eventPhase(row) };
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

  const records = await all('SELECT * FROM attendance WHERE event_id = ?', [eventId]);
  const byStudent = new Map(records.map((r) => [r.student_id, r]));
  const students = await all('SELECT id FROM students');

  const missing = students.filter((s) => !byStudent.has(s.id));
  if (missing.length) {
    const statements = missing.map((s) => ({
      sql: `INSERT INTO attendance (event_id, student_id, status, method, note)
            VALUES (?, ?, 'absent', 'auto', 'Auto-consolidated on event close')`,
      args: [eventId, s.id],
    }));
    await batch(statements, 'write');
  }

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
    closedAt: nowUtc(),
  };

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
  const row = await getEvent(req.params.id);
  if (!row) return res.status(404).json({ error: 'Event not found' });
  res.json(row);
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
  res.json({ event, students, attendance, timezone: config.timezone, settings, generatedAt: nowUtc() });
});

router.post('/', async (req, res) => {
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm, termId, scheduleId } = req.body || {};
  if (!name || !eventDate) {
    return res.status(400).json({ error: 'Event name and date are required' });
  }
  const info = await run(
    `INSERT INTO events (name, description, location, event_date, start_time, end_time, checkin_code, status, require_student_confirm, term_id, schedule_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const { name, description, location, eventDate, startTime, endTime, status, requireStudentConfirm, termId, scheduleId } = req.body || {};
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
      require_student_confirm = ?, term_id = ?, schedule_id = ? WHERE id = ?`,
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
