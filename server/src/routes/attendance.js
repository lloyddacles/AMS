import { Router } from 'express';
import { get, all, run } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const selectFields = `a.id, a.event_id AS eventId, a.student_id AS studentId, a.status,
  a.method, a.note, a.checked_in_at AS checkedInAt, a.checked_out_at AS checkedOutAt,
  s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
  s.course, s.year_level AS yearLevel`;

function getAttendanceRow(id) {
  return get(
    `SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.id = ?`,
    [id]
  );
}

const ATTENDED_STATUSES = ['present', 'late'];
const isAttended = (status) => ATTENDED_STATUSES.includes(status);

async function nowUtc() {
  const row = await get("SELECT datetime('now') AS t");
  return row.t;
}

// ---- Time windows (minutes) ----
const LATE_AFTER_MIN = 5; // still "present" up to this many minutes after start
const TIMEOUT_OPEN_MIN = 30; // time-out opens this many minutes before end

function toMinutes(hm) {
  if (!hm) return null;
  const [h, m] = String(hm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function fmtHM(total) {
  const m = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${ampm}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Check-in is allowed at any time. Scans after the grace period become "late".
function classifyTimeIn(event) {
  const start = toMinutes(event.start_time);
  if (start === null) return { status: 'present' };
  const diff = nowMinutes() - start;
  return { status: diff > LATE_AFTER_MIN ? 'late' : 'present' };
}

// Time-out only opens 30 minutes before the event ends.
function canTimeOut(event) {
  const end = toMinutes(event.end_time);
  if (end === null) return { ok: true };
  const opens = end - TIMEOUT_OPEN_MIN;
  if (nowMinutes() < opens) {
    return { ok: false, message: `Time-out opens ${TIMEOUT_OPEN_MIN} minutes before the event ends (at ${fmtHM(opens)}).` };
  }
  return { ok: true };
}

// Manual marking by staff. Only present/late get a time-in; absent/excused stay time-less.
async function markManual({ eventId, studentId, status, note, userId }) {
  const existing = await get('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?', [eventId, studentId]);
  if (existing) {
    const checkedIn = existing.checked_in_at || (isAttended(status) ? await nowUtc() : null);
    await run(
      `UPDATE attendance SET status = ?, method = 'manual', note = ?, marked_by = ?, checked_in_at = ? WHERE id = ?`,
      [status, note ?? existing.note, userId ?? existing.marked_by, checkedIn, existing.id]
    );
    return { row: await getAttendanceRow(existing.id), duplicate: true };
  }
  const info = await run(
    `INSERT INTO attendance (event_id, student_id, status, method, note, marked_by, checked_in_at)
     VALUES (?, ?, ?, 'manual', ?, ?, ?)`,
    [eventId, studentId, status, note || null, userId || null, isAttended(status) ? await nowUtc() : null]
  );
  return { row: await getAttendanceRow(info.lastInsertRowid), duplicate: false };
}

// QR scanning alternates: first scan = time-in (present/late by start time),
// second scan = time-out (only when the end window is open).
async function applyScan({ eventId, studentId, method, userId, event }) {
  const existing = await get('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?', [eventId, studentId]);
  if (!existing) {
    const verdict = classifyTimeIn(event || {});
    if (verdict.blocked) return { blocked: true, message: verdict.message };
    const info = await run(
      `INSERT INTO attendance (event_id, student_id, status, method, marked_by)
       VALUES (?, ?, ?, ?, ?)`,
      [eventId, studentId, verdict.status, method, userId || null]
    );
    return { row: await getAttendanceRow(info.lastInsertRowid), action: 'time-in' };
  }
  if (!existing.checked_out_at) {
    const verdict = canTimeOut(event || {});
    if (!verdict.ok) return { blocked: true, message: verdict.message };
    await run(
      `UPDATE attendance SET checked_out_at = datetime('now'), method = ?, marked_by = ? WHERE id = ?`,
      [method, userId ?? existing.marked_by, existing.id]
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

router.get('/event/:eventId', async (req, res) => {
  const rows = await all(
    `SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id
     WHERE a.event_id = ? ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`,
    [req.params.eventId]
  );
  res.json(rows);
});

// Resolve a scanned QR to a student WITHOUT recording attendance (privacy-preserving lookup).
router.post('/lookup', async (req, res) => {
  const { eventId, qrToken } = req.body || {};
  if (!eventId || !qrToken) return res.status(400).json({ error: 'eventId and qrToken are required' });
  const event = await get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const student = await get(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
            course, year_level AS yearLevel
     FROM students WHERE qr_token = ?`,
    [resolveToken(qrToken)]
  );
  if (!student) return res.status(404).json({ error: 'Unrecognized QR code' });

  const existing = await get(
    'SELECT id, status, checked_in_at AS checkedInAt, checked_out_at AS checkedOutAt FROM attendance WHERE event_id = ? AND student_id = ?',
    [eventId, student.id]
  );

  const nextAction = !existing ? 'time-in' : (!existing.checkedOutAt ? 'time-out' : 'already-complete');

  const startM = toMinutes(event.start_time);
  const endM = toMinutes(event.end_time);
  let windowBlocked = false;
  let windowMessage = '';
  let plannedStatus = null;
  if (nextAction === 'time-in') {
    plannedStatus = classifyTimeIn(event).status;
  } else if (nextAction === 'time-out') {
    const verdict = canTimeOut(event);
    if (!verdict.ok) {
      windowBlocked = true;
      windowMessage = verdict.message;
    }
  }

  res.json({
    student,
    requireStudentConfirm: !!event.require_student_confirm,
    eventClosed: event.status !== 'active',
    alreadyCheckedIn: !!existing,
    checkedInAt: existing?.checkedInAt || null,
    checkedOutAt: existing?.checkedOutAt || null,
    nextAction,
    plannedStatus,
    windowBlocked,
    windowMessage,
    checkinOpensAt: null,
    lateAfterAt: startM !== null ? fmtHM(startM + LATE_AFTER_MIN) : null,
    timeoutOpensAt: endM !== null ? fmtHM(endM - TIMEOUT_OPEN_MIN) : null,
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
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate });
});

router.put('/:id', async (req, res) => {
  const existing = await get('SELECT * FROM attendance WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Attendance record not found' });
  const { status, note } = req.body || {};
  await run('UPDATE attendance SET status = ?, note = ? WHERE id = ?', [
    status ?? existing.status,
    note ?? existing.note,
    req.params.id,
  ]);
  const row = await get(
    `SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.id = ?`,
    [req.params.id]
  );
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const info = await run('DELETE FROM attendance WHERE id = ?', [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Attendance record not found' });
  res.json({ ok: true });
});

export default router;
