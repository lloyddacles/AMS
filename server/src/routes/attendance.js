import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import {
  classifyByTime,
  displayStatus,
  timeoutOpensAt,
  absentCutoff,
  formatTzTime,
  isAttendedStatus,
  todayInTz,
} from '../classify.js';

const router = Router();

const selectFields = `a.id, a.event_id AS eventId, a.student_id AS studentId, a.status,
  a.method, a.note, a.checked_in_at AS checkedInAt, a.checked_out_at AS checkedOutAt,
  s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
  s.course, s.year_level AS yearLevel, s.section`;

const studentFields = `s.id AS studentId, s.student_no AS studentNo, s.first_name AS firstName,
  s.last_name AS lastName, s.course, s.year_level AS yearLevel, s.section`;

// Current time as a SQLite-style UTC timestamp.
function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function getAttendanceRow(id) {
  return get(
    `SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.id = ?`,
    [id]
  );
}

const todayCols = `a.id, a.event_id AS eventId, a.student_id AS studentId, a.status, a.method,
  a.checked_in_at AS checkedInAt, a.checked_out_at AS checkedOutAt,
  s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
  e.name AS eventName, e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime`;

// Every time-in recorded today (across all of today's events), with the
// time-based classification applied.
async function todaysCheckins(date) {
  const records = await all(
    `SELECT ${todayCols}
     FROM attendance a
     JOIN students s ON s.id = a.student_id
     JOIN events e ON e.id = a.event_id
     WHERE e.event_date = ? AND a.checked_in_at IS NOT NULL
     ORDER BY a.checked_in_at DESC`,
    [date]
  );
  return records.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    eventName: r.eventName,
    studentId: r.studentId,
    studentNo: r.studentNo,
    firstName: r.firstName,
    lastName: r.lastName,
    method: r.method,
    checkedInAt: r.checkedInAt,
    checkedOutAt: r.checkedOutAt,
    classification: displayStatus(
      { event_date: r.eventDate, start_time: r.startTime, end_time: r.endTime },
      r
    ),
  }));
}

// Manual marking by staff. Only attended statuses get a time-in.
async function markManual({ eventId, studentId, status, note, userId }) {
  const existing = await get('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?', [eventId, studentId]);
  const checkedIn = isAttendedStatus(status) ? nowUtc() : null;
  if (existing) {
    await run(
      `UPDATE attendance SET status = ?, method = 'manual', note = ?, marked_by = ?, checked_in_at = ? WHERE id = ?`,
      [status, note ?? existing.note, userId ?? existing.marked_by, existing.checked_in_at || checkedIn, existing.id]
    );
    return { row: await getAttendanceRow(existing.id), duplicate: true };
  }
  const info = await run(
    `INSERT INTO attendance (event_id, student_id, status, method, note, marked_by, checked_in_at)
     VALUES (?, ?, ?, 'manual', ?, ?, ?)`,
    [eventId, studentId, status, note || null, userId || null, checkedIn]
  );
  return { row: await getAttendanceRow(info.lastInsertRowid), duplicate: false };
}

// QR scanning alternates: first scan = time-in (early/on-time/late/absent by
// the clock), second scan = time-out (only when the end window is open).
async function applyScan({ eventId, studentId, method, userId, event }) {
  const existing = await get('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?', [eventId, studentId]);
  if (!existing) {
    const status = classifyByTime(event, nowUtc()) || 'present';
    const info = await run(
      `INSERT INTO attendance (event_id, student_id, status, method, marked_by, checked_in_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [eventId, studentId, status, method, userId || null, nowUtc()]
    );
    return { row: await getAttendanceRow(info.lastInsertRowid), action: 'time-in' };
  }
  if (!existing.checked_out_at) {
    const opens = timeoutOpensAt(event);
    if (opens && new Date() < opens) {
      return { blocked: true, message: `Time-out opens at ${formatTzTime(opens)}.` };
    }
    await run(
      `UPDATE attendance SET checked_out_at = ?, method = ?, marked_by = ? WHERE id = ?`,
      [nowUtc(), method, userId ?? existing.marked_by, existing.id]
    );
    return { row: await getAttendanceRow(existing.id), action: 'time-out' };
  }
  return { row: await getAttendanceRow(existing.id), action: 'already-complete' };
}

function resolveToken(qrToken) {
  let token = String(qrToken || '').trim();
  const urlMatch = token.match(/[?&]token=([^&]+)/);
  if (urlMatch) token = decodeURIComponent(urlMatch[1]);
  return token;
}

function studentNoMatches(provided, expected) {
  const p = String(provided || '').trim().toLowerCase().replace(/\s+/g, '');
  const e = String(expected || '').trim().toLowerCase();
  if (!p) return false;
  if (p === e) return true;
  const digits = e.replace(/\D/g, '');
  return digits.length >= 4 && p === digits.slice(-4);
}

// ---- Public self check-in (student scans event QR and enters their student number) ----

// Public list of everyone who has checked in today (names only, no numbers).
router.get('/public/today/checkins', async (req, res) => {
  const date = todayInTz();
  const records = await todaysCheckins(date);
  res.json({
    date,
    count: records.length,
    students: records.map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      checkedInAt: r.checkedInAt,
      classification: r.classification,
      eventName: r.eventName,
    })),
  });
});

router.get('/public/:code', async (req, res) => {
  const event = await get(
    'SELECT id, name, location, event_date AS eventDate, start_time AS startTime, end_time AS endTime, status FROM events WHERE checkin_code = ?',
    [req.params.code]
  );
  if (!event) return res.status(404).json({ error: 'Invalid or unknown check-in code' });
  res.json(event);
});

router.post('/public/:code/checkin', async (req, res) => {
  const event = await get('SELECT * FROM events WHERE checkin_code = ?', [req.params.code]);
  if (!event) return res.status(404).json({ error: 'Invalid or unknown check-in code' });
  if (event.status !== 'active') return res.status(400).json({ error: 'Check-in for this event is closed' });
  const { studentNo } = req.body || {};
  if (!studentNo) return res.status(400).json({ error: 'Student number is required' });
  const student = await get('SELECT * FROM students WHERE student_no = ?', [String(studentNo).trim()]);
  if (!student) return res.status(404).json({ error: 'Student number not found. Please contact the organizer.' });
  const result = await applyScan({ eventId: event.id, studentId: student.id, method: 'self-qr', event });
  if (result.blocked) return res.status(400).json({ error: result.message });
  res.status(result.action === 'time-in' ? 201 : 200).json({ ...result.row, action: result.action });
});

router.use(requireAuth);

// Everyone who has checked in today across all of today's events.
router.get('/today', async (req, res) => {
  const date = todayInTz();
  const records = await todaysCheckins(date);
  res.json({ date, count: records.length, records });
});

// Full attendance view for an event: every student, classified. Students with
// no time-in are marked absent once the absence window (start + 60 min) passes.
router.get('/event/:eventId', async (req, res) => {
  const event = await get('SELECT * FROM events WHERE id = ?', [req.params.eventId]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const records = await all(
    `SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.event_id = ?`,
    [req.params.eventId]
  );
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  const students = await all(
    `SELECT ${studentFields} FROM students s ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`
  );
  const cutoff = absentCutoff(event);
  const windowPassed = cutoff ? new Date() > cutoff : false;
  const rows = students.map((s) => {
    const r = byStudent.get(s.studentId);
    if (r) return { ...r, classification: displayStatus(event, r) };
    return {
      id: null,
      eventId: event.id,
      studentId: s.studentId,
      status: null,
      method: null,
      note: null,
      checkedInAt: null,
      checkedOutAt: null,
      studentNo: s.studentNo,
      firstName: s.firstName,
      lastName: s.lastName,
      course: s.course,
      yearLevel: s.yearLevel,
      section: s.section,
      classification: windowPassed ? 'absent' : null,
    };
  });
  res.json(rows);
});

// Resolve a scanned QR for the scanner UI (preview before committing).
router.post('/lookup', async (req, res) => {
  const { eventId, qrToken } = req.body || {};
  if (!eventId || !qrToken) return res.status(400).json({ error: 'eventId and qrToken are required' });
  const event = await get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const student = await get(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
            course, year_level AS yearLevel, section
     FROM students WHERE qr_token = ?`,
    [resolveToken(qrToken)]
  );
  if (!student) return res.status(404).json({ error: 'Unrecognized QR code' });

  const existing = await get(
    'SELECT * FROM attendance WHERE event_id = ? AND student_id = ?',
    [eventId, student.id]
  );

  const nextAction = !existing ? 'time-in' : (!existing.checked_out_at ? 'time-out' : 'already-complete');

  let plannedStatus = null;
  let windowBlocked = false;
  let windowMessage = '';
  if (nextAction === 'time-in') {
    plannedStatus = classifyByTime(event, nowUtc()) || 'present';
  } else if (nextAction === 'time-out') {
    const opens = timeoutOpensAt(event);
    if (opens && new Date() < opens) {
      windowBlocked = true;
      windowMessage = `Time-out opens at ${formatTzTime(opens)}.`;
    }
  }

  res.json({
    student,
    requireStudentConfirm: !!event.require_student_confirm,
    eventClosed: event.status !== 'active',
    alreadyCheckedIn: !!existing,
    checkedInAt: existing?.checked_in_at || null,
    checkedOutAt: existing?.checked_out_at || null,
    classification: existing ? displayStatus(event, existing) : null,
    nextAction,
    plannedStatus,
    windowBlocked,
    windowMessage,
    timeoutOpensAt: formatTzTime(timeoutOpensAt(event)),
    startTime: event.start_time || null,
    endTime: event.end_time || null,
    attendance: existing || null,
  });
});

// QR scan check-in: the scanned QR text is the student's qr_token.
router.post('/scan', async (req, res) => {
  const { eventId, qrToken, confirmValue } = req.body || {};
  if (!eventId || !qrToken) return res.status(400).json({ error: 'eventId and qrToken are required' });
  const event = await get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.status !== 'active') return res.status(400).json({ error: 'Check-in for this event is closed' });

  const student = await get('SELECT * FROM students WHERE qr_token = ?', [resolveToken(qrToken)]);
  if (!student) return res.status(404).json({ error: 'Unrecognized QR code' });

  // Identity confirmation: enforced server-side so it holds even if the client is bypassed.
  if (event.require_student_confirm || confirmValue !== undefined) {
    if (!studentNoMatches(confirmValue, student.student_no)) {
      return res.status(400).json({ error: 'Student number confirmation did not match this QR code' });
    }
  }

  const result = await applyScan({
    eventId: event.id,
    studentId: student.id,
    method: 'qr',
    userId: req.user.id,
    event,
  });
  if (result.blocked) return res.status(400).json({ error: result.message });
  res.status(result.action === 'time-in' ? 201 : 200).json({ ...result.row, action: result.action });
});

// Manual mark / update by student id
router.post('/', async (req, res) => {
  const { eventId, studentId, status = 'present', note } = req.body || {};
  if (!eventId || !studentId) return res.status(400).json({ error: 'eventId and studentId are required' });
  const event = await get('SELECT id FROM events WHERE id = ?', [eventId]);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const student = await get('SELECT id FROM students WHERE id = ?', [studentId]);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { row, duplicate } = await markManual({ eventId, studentId, status, note, userId: req.user.id });
  await logAudit({
    user: req.user,
    action: 'attendance.mark',
    entity: 'attendance',
    entityId: row.id,
    detail: `${row.studentNo} ${row.lastName}, ${row.firstName} · ${row.status}`,
  });
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate });
});

router.put('/:id', async (req, res) => {
  const existing = await get('SELECT * FROM attendance WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Attendance record not found' });
  const { status, note } = req.body || {};
  const before = await getAttendanceRow(req.params.id);
  await run("UPDATE attendance SET status = ?, note = ?, method = 'manual' WHERE id = ?", [
    status ?? existing.status,
    note ?? existing.note,
    req.params.id,
  ]);
  const row = await getAttendanceRow(req.params.id);
  await logAudit({
    user: req.user,
    action: 'attendance.update',
    entity: 'attendance',
    entityId: row.id,
    detail: `${row.studentNo} ${row.lastName}, ${row.firstName} · ${before.status} → ${row.status}`,
  });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const before = await getAttendanceRow(req.params.id);
  const info = await run('DELETE FROM attendance WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Attendance record not found' });
  if (before) {
    await logAudit({
      user: req.user,
      action: 'attendance.delete',
      entity: 'attendance',
      entityId: req.params.id,
      detail: `${before.studentNo} ${before.lastName}, ${before.firstName} · ${before.status}`,
    });
  }
  res.json({ ok: true });
});

export default router;
