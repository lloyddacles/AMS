import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const selectFields = `a.id, a.event_id AS eventId, a.student_id AS studentId, a.status,
  a.method, a.note, a.checked_in_at AS checkedInAt, a.checked_out_at AS checkedOutAt,
  s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
  s.course, s.year_level AS yearLevel`;

function getAttendanceRow(id) {
  return db
    .prepare(`SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.id = ?`)
    .get(id);
}

const ATTENDED_STATUSES = ['present', 'late'];
const isAttended = (status) => ATTENDED_STATUSES.includes(status);

function nowUtc() {
  return db.prepare("SELECT datetime('now') AS t").get().t;
}

// ---- Time windows (minutes) ----
const OPEN_EARLY_MIN = 15; // check-in opens this many minutes before start
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

// Present = scanned within the 15-min pre-start window (or up to 5 min after start).
// Late = scanned more than 5 min after start. Scanning earlier than the window is rejected.
function classifyTimeIn(event) {
  const start = toMinutes(event.start_time);
  if (start === null) return { status: 'present' };
  const diff = nowMinutes() - start;
  if (diff < -OPEN_EARLY_MIN) {
    return { blocked: true, message: `Check-in opens ${OPEN_EARLY_MIN} minutes before the event (at ${fmtHM(start - OPEN_EARLY_MIN)}).` };
  }
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
function markManual({ eventId, studentId, status, note, userId }) {
  const existing = db
    .prepare('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?')
    .get(eventId, studentId);
  if (existing) {
    const checkedIn = existing.checked_in_at || (isAttended(status) ? nowUtc() : null);
    db.prepare(
      `UPDATE attendance SET status = ?, method = 'manual', note = ?, marked_by = ?, checked_in_at = ? WHERE id = ?`
    ).run(status, note ?? existing.note, userId ?? existing.marked_by, checkedIn, existing.id);
    return { row: getAttendanceRow(existing.id), duplicate: true };
  }
  const info = db
    .prepare(
      `INSERT INTO attendance (event_id, student_id, status, method, note, marked_by, checked_in_at)
       VALUES (?, ?, ?, 'manual', ?, ?, ?)`
    )
    .run(eventId, studentId, status, note || null, userId || null, isAttended(status) ? nowUtc() : null);
  return { row: getAttendanceRow(info.lastInsertRowid), duplicate: false };
}

// QR scanning alternates: first scan = time-in (present/late by start time),
// second scan = time-out (only when the end window is open).
function applyScan({ eventId, studentId, method, userId, event }) {
  const existing = db
    .prepare('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?')
    .get(eventId, studentId);
  if (!existing) {
    const verdict = classifyTimeIn(event || {});
    if (verdict.blocked) return { blocked: true, message: verdict.message };
    const info = db
      .prepare(
        `INSERT INTO attendance (event_id, student_id, status, method, marked_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(eventId, studentId, verdict.status, method, userId || null);
    return { row: getAttendanceRow(info.lastInsertRowid), action: 'time-in' };
  }
  if (!existing.checked_out_at) {
    const verdict = canTimeOut(event || {});
    if (!verdict.ok) return { blocked: true, message: verdict.message };
    db.prepare(
      `UPDATE attendance SET checked_out_at = datetime('now'), method = ?, marked_by = ? WHERE id = ?`
    ).run(method, userId ?? existing.marked_by, existing.id);
    return { row: getAttendanceRow(existing.id), action: 'time-out' };
  }
  return { row: getAttendanceRow(existing.id), action: 'already-complete' };
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

router.get('/public/:code', (req, res) => {
  const event = db
    .prepare('SELECT id, name, location, event_date AS eventDate, start_time AS startTime, end_time AS endTime, status FROM events WHERE checkin_code = ?')
    .get(req.params.code);
  if (!event) return res.status(404).json({ error: 'Invalid or unknown check-in code' });
  res.json(event);
});

router.post('/public/:code/checkin', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE checkin_code = ?').get(req.params.code);
  if (!event) return res.status(404).json({ error: 'Invalid or unknown check-in code' });
  if (event.status !== 'active') return res.status(400).json({ error: 'Check-in for this event is closed' });
  const { studentNo } = req.body || {};
  if (!studentNo) return res.status(400).json({ error: 'Student number is required' });
  const student = db.prepare('SELECT * FROM students WHERE student_no = ?').get(String(studentNo).trim());
  if (!student) return res.status(404).json({ error: 'Student number not found. Please contact the organizer.' });
  const result = applyScan({ eventId: event.id, studentId: student.id, method: 'self-qr', event });
  if (result.blocked) return res.status(400).json({ error: result.message });
  res.status(result.action === 'time-in' ? 201 : 200).json({ ...result.row, action: result.action });
});

router.use(requireAuth);

router.get('/event/:eventId', (req, res) => {
  const rows = db
    .prepare(
      `SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id
       WHERE a.event_id = ? ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`
    )
    .all(req.params.eventId);
  res.json(rows);
});

// Resolve a scanned QR to a student WITHOUT recording attendance (privacy-preserving lookup).
router.post('/lookup', (req, res) => {
  const { eventId, qrToken } = req.body || {};
  if (!eventId || !qrToken) return res.status(400).json({ error: 'eventId and qrToken are required' });
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const student = db
    .prepare(
      `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
              course, year_level AS yearLevel
       FROM students WHERE qr_token = ?`
    )
    .get(resolveToken(qrToken));
  if (!student) return res.status(404).json({ error: 'Unrecognized QR code' });

  const existing = db
    .prepare('SELECT id, status, checked_in_at AS checkedInAt, checked_out_at AS checkedOutAt FROM attendance WHERE event_id = ? AND student_id = ?')
    .get(eventId, student.id);

  const nextAction = !existing ? 'time-in' : (!existing.checkedOutAt ? 'time-out' : 'already-complete');

  const startM = toMinutes(event.start_time);
  const endM = toMinutes(event.end_time);
  let windowBlocked = false;
  let windowMessage = '';
  let plannedStatus = null;
  if (nextAction === 'time-in') {
    const verdict = classifyTimeIn(event);
    if (verdict.blocked) {
      windowBlocked = true;
      windowMessage = verdict.message;
    } else {
      plannedStatus = verdict.status;
    }
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
    checkinOpensAt: startM !== null ? fmtHM(startM - OPEN_EARLY_MIN) : null,
    lateAfterAt: startM !== null ? fmtHM(startM + LATE_AFTER_MIN) : null,
    timeoutOpensAt: endM !== null ? fmtHM(endM - TIMEOUT_OPEN_MIN) : null,
    startTime: event.start_time || null,
    endTime: event.end_time || null,
    attendance: existing || null,
  });
});

// QR scan check-in: the scanned QR text is the student's qr_token.
router.post('/scan', (req, res) => {
  const { eventId, qrToken, confirmValue } = req.body || {};
  if (!eventId || !qrToken) return res.status(400).json({ error: 'eventId and qrToken are required' });
  const event = db
    .prepare('SELECT * FROM events WHERE id = ?')
    .get(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.status !== 'active') return res.status(400).json({ error: 'Check-in for this event is closed' });

  const student = db.prepare('SELECT * FROM students WHERE qr_token = ?').get(resolveToken(qrToken));
  if (!student) return res.status(404).json({ error: 'Unrecognized QR code' });

  // Identity confirmation: enforced server-side so it holds even if the client is bypassed.
  if (event.require_student_confirm || confirmValue !== undefined) {
    if (!studentNoMatches(confirmValue, student.student_no)) {
      return res.status(400).json({ error: 'Student number confirmation did not match this QR code' });
    }
  }

  const result = applyScan({
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
router.post('/', (req, res) => {
  const { eventId, studentId, status = 'present', note } = req.body || {};
  if (!eventId || !studentId) return res.status(400).json({ error: 'eventId and studentId are required' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { row, duplicate } = markManual({ eventId, studentId, status, note, userId: req.user.id });
  res.status(duplicate ? 200 : 201).json({ ...row, duplicate });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Attendance record not found' });
  const { status, note } = req.body || {};
  db.prepare('UPDATE attendance SET status = ?, note = ? WHERE id = ?').run(
    status ?? existing.status,
    note ?? existing.note,
    req.params.id
  );
  const row = db
    .prepare(`SELECT ${selectFields} FROM attendance a JOIN students s ON s.id = a.student_id WHERE a.id = ?`)
    .get(req.params.id);
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Attendance record not found' });
  res.json({ ok: true });
});

export default router;
