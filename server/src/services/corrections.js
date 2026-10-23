import { get, all, run } from '../db.js';
import { displayStatus, eventStart, todayInTz } from '../classify.js';
import { isExcluded, includeStudents, exclusionsByEvent } from './roster.js';
import { refreshClosedSummary } from './eventSummary.js';
import { logAudit } from './audit.js';
import { notifyCorrectionRequested } from './notifications.js';

// Statuses a student may ask for. "Absent" is deliberately not requestable —
// there is nothing to gain from asking to be marked absent.
export const REQUESTABLE_STATUSES = ['early', 'on-time', 'present', 'late', 'excused'];

const correctionSelect = `c.id, c.event_id AS eventId, c.student_id AS studentId,
  c.requested_status AS requestedStatus, c.reason, c.status,
  c.resolution_note AS resolutionNote, c.reviewed_by AS reviewedBy,
  c.reviewed_at AS reviewedAt, c.submitted_by AS submittedBy, c.created_at AS createdAt,
  s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
  s.course, s.year_level AS yearLevel, s.section,
  e.name AS eventName, e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime,
  e.status AS eventStatus, e.archived AS archived,
  a.status AS attendanceStatus, a.method AS attendanceMethod, a.checked_in_at AS checkedInAt,
  u.name AS reviewedByName`;

const correctionJoins = `FROM attendance_corrections c
  JOIN students s ON s.id = c.student_id
  JOIN events e ON e.id = c.event_id
  LEFT JOIN attendance a ON a.event_id = c.event_id AND a.student_id = c.student_id
  LEFT JOIN users u ON u.id = c.reviewed_by`;

// Current time as a SQLite-style UTC timestamp.
function nowUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function withClassification(row) {
  if (!row) return row;
  const eventLike = { event_date: row.eventDate, start_time: row.startTime, end_time: row.endTime };
  return {
    ...row,
    archived: Number(row.archived) ? 1 : 0,
    classification: row.attendanceStatus
      ? displayStatus(eventLike, {
          status: row.attendanceStatus,
          method: row.attendanceMethod,
          checkedInAt: row.checkedInAt,
        })
      : null,
  };
}

// Compare a typed name against the student record ignoring case, spacing and
// punctuation, accepting "First Last" or "Last First" arrangements.
function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Public identity check: student number must exist and the typed full name must
// match the record. This is the gate for everything student-facing.
export async function findStudent({ studentNo, name }) {
  const no = String(studentNo || '').trim();
  if (!no) return { error: 'Student number is required', status: 400 };
  const student = await get('SELECT * FROM students WHERE student_no = ?', [no]);
  if (!student) {
    return { error: 'Student number not found. Please check and try again.', status: 404 };
  }
  const input = normName(name);
  if (!input) return { error: 'Full name is required', status: 400 };
  if (input !== normName(`${student.first_name} ${student.last_name}`) && input !== normName(`${student.last_name} ${student.first_name}`)) {
    return { error: 'The name you entered does not match our records.', status: 400 };
  }
  return { student };
}

// The student's recent, non-archived events with attendance, any correction
// request, and whether a new request is allowed right now.
export async function recordsFor(studentId) {
  const events = await all(
    `SELECT id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime,
            status, archived, closed_at AS closedAt
     FROM events
     WHERE archived = 0 AND event_date <= ?
     ORDER BY event_date DESC, id DESC
     LIMIT 30`,
    [todayInTz()]
  );
  const ids = events.map((e) => e.id);
  const attendance = ids.length
    ? await all(
        `SELECT id, event_id AS eventId, status, method, checked_in_at AS checkedInAt, note
         FROM attendance
         WHERE student_id = ? AND event_id IN (${ids.map(() => '?').join(',')})`,
        [studentId, ...ids]
      )
    : [];
  const corrections = ids.length
    ? await all(
        `SELECT id, event_id AS eventId, requested_status AS requestedStatus, status, reason,
                resolution_note AS resolutionNote, reviewed_at AS reviewedAt, created_at AS createdAt
         FROM attendance_corrections
         WHERE student_id = ? AND event_id IN (${ids.map(() => '?').join(',')})
         ORDER BY id DESC`,
        [studentId, ...ids]
      )
    : [];
  const excludedByEvent = ids.length ? await exclusionsByEvent(ids) : new Map();
  const attByEvent = new Map(attendance.map((r) => [r.eventId, r]));
  const latestCorr = new Map();
  for (const c of corrections) if (!latestCorr.has(c.eventId)) latestCorr.set(c.eventId, c);

  const now = new Date();
  return events.map((e) => {
    const att = attByEvent.get(e.id) || null;
    const corr = latestCorr.get(e.id) || null;
    const onList = !excludedByEvent.get(e.id)?.has(studentId);
    const start = eventStart(e);
    const started = !start || start.getTime() <= now.getTime();
    const pending = !!corr && corr.status === 'pending';
    return {
      eventId: e.id,
      name: e.name,
      eventDate: e.eventDate,
      startTime: e.startTime,
      endTime: e.endTime,
      eventStatus: e.status,
      closedAt: e.closedAt,
      classification: att ? displayStatus(e, att) : null,
      attendance: att
        ? { status: att.status, method: att.method, checkedInAt: att.checkedInAt, note: att.note }
        : null,
      onList,
      correction: corr,
      canRequest: onList && started && !pending,
    };
  });
}

// Validate and store a new pending request (public endpoint).
export async function createRequest({ eventId, studentNo, name, requestedStatus, reason }) {
  const found = await findStudent({ studentNo, name });
  if (found.error) return { error: found.error, status: found.status };
  return createForStudent({
    student: found.student,
    eventId,
    requestedStatus,
    reason,
  });
}

// Same validation and storage, for callers that already verified the student
// (the authenticated portal passes the row from the session).
export async function createForStudent({ student, eventId, requestedStatus, reason }) {
  const numericId = Number(eventId);
  if (!Number.isInteger(numericId) || numericId <= 0) return { error: 'eventId is required', status: 400 };

  // Accept both raw rows (public lookup) and the portal's aliased session row.
  const row = {
    id: student.id,
    student_no: student.student_no ?? student.studentNo,
    first_name: student.first_name ?? student.firstName,
    last_name: student.last_name ?? student.lastName,
  };

  const event = await get('SELECT * FROM events WHERE id = ?', [numericId]);
  if (!event) return { error: 'Event not found', status: 404 };
  if (Number(event.archived)) return { error: 'This event is archived. Corrections are closed.', status: 400 };
  const start = eventStart(event);
  if (start && start.getTime() > Date.now()) return { error: 'This event has not started yet.', status: 400 };

  const status = String(requestedStatus || '').trim().toLowerCase();
  if (!REQUESTABLE_STATUSES.includes(status)) {
    return { error: `Requested status must be one of: ${REQUESTABLE_STATUSES.join(', ')}`, status: 400 };
  }
  const text = String(reason || '').trim();
  if (text.length < 3 || text.length > 300) {
    return { error: 'Reason must be between 3 and 300 characters', status: 400 };
  }
  if (await isExcluded(event.id, row.id)) {
    return { error: 'You are not on the attendee list for this event. Please contact the organizer.', status: 400 };
  }
  const pending = await get(
    "SELECT id FROM attendance_corrections WHERE event_id = ? AND student_id = ? AND status = 'pending'",
    [event.id, row.id]
  );
  if (pending) return { error: 'You already have a pending request for this event.', status: 409 };

  const info = await run(
    `INSERT INTO attendance_corrections (event_id, student_id, requested_status, reason, submitted_by)
     VALUES (?, ?, ?, ?, ?)`,
    [event.id, row.id, status, text, row.student_no]
  );
  const created = withClassification(
    await get(`SELECT ${correctionSelect} ${correctionJoins} WHERE c.id = ?`, [info.lastInsertRowid])
  );
  await logAudit({
    user: { name: `${row.first_name} ${row.last_name} (${row.student_no})` },
    action: 'correction.request',
    entity: 'correction',
    entityId: created.id,
    detail: `${event.name} · wants ${status} · ${text}`,
  });
  await notifyCorrectionRequested(created, event, row).catch(() => {});
  return { correction: created };
}

// Staff review queue with per-status counts for the tabs.
export async function listRequests({ status = 'pending', limit = 50, offset = 0 } = {}) {
  const where = ['c.status = ?'];
  const args = [];
  if (status && status !== 'all') args.push(String(status));
  else where.length = 0;
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (await all(
    `SELECT ${correctionSelect} ${correctionJoins} ${clause} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...args, Number(limit) || 50, Number(offset) || 0]
  )).map(withClassification);
  const total = (await get(`SELECT COUNT(*) AS c FROM attendance_corrections c ${clause}`, args)).c;

  const counts = { pending: 0, approved: 0, rejected: 0, all: 0 };
  for (const row of await all('SELECT status, COUNT(*) AS c FROM attendance_corrections GROUP BY status')) {
    counts[row.status] = row.c;
    counts.all += row.c;
  }
  return { rows, total, counts };
}

export async function getCorrection(id) {
  return withClassification(await get(`SELECT ${correctionSelect} ${correctionJoins} WHERE c.id = ?`, [id]));
}

// One student's own requests with per-status counts for their portal tabs.
export async function listForStudent({ studentId, status = 'all', limit = 50, offset = 0 } = {}) {
  const where = ['c.student_id = ?'];
  const args = [studentId];
  if (status && status !== 'all') {
    where.push('c.status = ?');
    args.push(String(status));
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = (await all(
    `SELECT ${correctionSelect} ${correctionJoins} ${clause} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...args, Number(limit) || 50, Number(offset) || 0]
  )).map(withClassification);
  const total = (await get(`SELECT COUNT(*) AS c FROM attendance_corrections c ${clause}`, args)).c;

  const counts = { pending: 0, approved: 0, rejected: 0, all: 0 };
  for (const row of await all(
    'SELECT status, COUNT(*) AS c FROM attendance_corrections WHERE student_id = ? GROUP BY status',
    [studentId]
  )) {
    counts[row.status] = row.c;
    counts.all += row.c;
  }
  return { rows, total, counts };
}

// Apply an approved correction: put the student back on the attendee list if
// needed, upsert their attendance, then refresh a closed event's frozen summary.
export async function approveRequest({ id, user, note = null }) {
  const correction = await getCorrection(id);
  if (!correction) return { error: 'Correction request not found', status: 404 };
  if (correction.status !== 'pending') return { error: 'This request has already been reviewed', status: 400 };

  const event = await get('SELECT * FROM events WHERE id = ?', [correction.eventId]);
  if (!event) return { error: 'Event not found', status: 404 };
  if (Number(event.archived)) return { error: 'This event is archived; its attendance is final', status: 400 };

  // Approving puts the student back on the attendee list (same as a manual mark).
  let readded = false;
  if (await isExcluded(event.id, correction.studentId)) {
    await includeStudents({ eventId: event.id, studentIds: [correction.studentId] });
    readded = true;
  }

  const before = correction.classification || 'unmarked';
  const existing = await get('SELECT * FROM attendance WHERE event_id = ? AND student_id = ?', [
    event.id,
    correction.studentId,
  ]);
  if (existing) {
    // Keep the original time-in: a correction fixes the status, not the clock.
    await run(`UPDATE attendance SET status = ?, method = 'manual', note = ?, marked_by = ? WHERE id = ?`, [
      correction.requestedStatus,
      correction.reason,
      user.id,
      existing.id,
    ]);
  } else {
    await run(
      `INSERT INTO attendance (event_id, student_id, status, method, note, marked_by)
       VALUES (?, ?, ?, 'manual', ?, ?)`,
      [event.id, correction.studentId, correction.requestedStatus, correction.reason, user.id]
    );
  }

  const resolutionNote = String(note || '').trim() || null;
  await run(
    `UPDATE attendance_corrections SET status = 'approved', resolution_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    [resolutionNote, user.id, nowUtc(), id]
  );

  // A closed event's report summary is frozen at close; keep it accurate.
  let summary = null;
  if (event.status === 'closed') summary = await refreshClosedSummary(event.id);

  const detail = `${correction.studentNo} ${correction.lastName}, ${correction.firstName} · ${event.name} · ${before} → ${correction.requestedStatus}${
    readded ? ' · added to attendee list' : ''
  }${summary ? ` · report now ${summary.attended}/${summary.totalStudents} (${summary.rate}%)` : ''}`;
  await logAudit({
    user,
    action: 'correction.approve',
    entity: 'correction',
    entityId: id,
    detail,
  });

  return { correction: await getCorrection(id), summary };
}

// Reject with a required note explaining why.
export async function rejectRequest({ id, user, note }) {
  const correction = await getCorrection(id);
  if (!correction) return { error: 'Correction request not found', status: 404 };
  if (correction.status !== 'pending') return { error: 'This request has already been reviewed', status: 400 };
  const resolutionNote = String(note || '').trim();
  if (!resolutionNote) return { error: 'A note is required when rejecting a request', status: 400 };

  await run(
    `UPDATE attendance_corrections SET status = 'rejected', resolution_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    [resolutionNote, user.id, nowUtc(), id]
  );
  await logAudit({
    user,
    action: 'correction.reject',
    entity: 'correction',
    entityId: id,
    detail: `${correction.studentNo} ${correction.lastName}, ${correction.firstName} · ${correction.eventName} · wanted ${correction.requestedStatus} · ${resolutionNote}`,
  });
  return { correction: await getCorrection(id) };
}
