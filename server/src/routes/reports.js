import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { displayStatus, absentCutoff } from '../classify.js';

const router = Router();
router.use(requireAuth);

function csvEscape(value) {
  let str = value === null || value === undefined ? '' : String(value);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function isoUtc(value) {
  return value ? String(value).replace(' ', 'T') + 'Z' : '';
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\n');
}

const EVENT_COLS = 'id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime';
const RECORD_COLS = 'event_id AS eventId, student_id AS studentId, status, checked_in_at AS checkedInAt';

function bucket(counts, cls) {
  if (cls === 'early') counts.early += 1;
  else if (cls === 'on-time') counts.onTime += 1;
  else if (cls === 'late') counts.late += 1;
  else if (cls === 'excused') counts.excused += 1;
  else counts.absent += 1;
}

// Per-student summary, classified early / on-time / late / absent.
router.get('/overview', async (req, res) => {
  const { search = '', course = '' } = req.query;
  const like = `%${search}%`;
  const events = await all(`SELECT ${EVENT_COLS} FROM events`);
  const students = await all(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName,
            course, year_level AS yearLevel
     FROM students
     WHERE (student_no LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
       AND (? = '' OR course = ?)
     ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
    [like, like, like, course, course]
  );
  const records = await all(`SELECT ${RECORD_COLS} FROM attendance`);

  const byStudent = new Map();
  for (const r of records) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, new Map());
    byStudent.get(r.studentId).set(r.eventId, r);
  }
  const now = new Date();
  const cutoffs = new Map(events.map((e) => [e.id, absentCutoff(e)]));

  const totalEvents = events.length;
  const rows = students.map((s) => {
    const counts = { early: 0, onTime: 0, late: 0, absent: 0, excused: 0 };
    const recs = byStudent.get(s.id) || new Map();
    for (const e of events) {
      const record = recs.get(e.id);
      if (record) {
        bucket(counts, displayStatus(e, record));
      } else {
        const cutoff = cutoffs.get(e.id);
        if (cutoff && now > cutoff) counts.absent += 1;
      }
    }
    const attended = counts.early + counts.onTime + counts.late;
    return {
      id: s.id,
      studentNo: s.studentNo,
      firstName: s.firstName,
      lastName: s.lastName,
      course: s.course,
      yearLevel: s.yearLevel,
      ...counts,
      attended,
      rate: totalEvents ? Math.round((attended / totalEvents) * 100) : 0,
    };
  });

  res.json({ totalEvents, students: rows });
});

// Event × student matrix of classifications.
router.get('/matrix', async (req, res) => {
  const events = await all(`SELECT ${EVENT_COLS} FROM events`);
  const students = await all(
    'SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
  );
  const records = await all(`SELECT ${RECORD_COLS} FROM attendance`);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const map = {};
  for (const r of records) {
    const cls = displayStatus(eventById.get(r.eventId), r);
    if (cls) map[`${r.eventId}:${r.studentId}`] = cls;
  }
  res.json({ events, students, records: map });
});

router.get('/export', async (req, res) => {
  const { type = 'students', eventId } = req.query;

  if (type === 'event') {
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const event = await get(`SELECT ${EVENT_COLS} FROM events WHERE id = ?`, [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const records = await all(
      `SELECT ${RECORD_COLS}, method, checked_out_at AS checkedOutAt FROM attendance WHERE event_id = ?`,
      [event.id]
    );
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const students = await all(
      'SELECT id, student_no, first_name, last_name, course, year_level FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
    );
    const cutoff = absentCutoff(event);
    const windowPassed = cutoff ? new Date() > cutoff : false;
    const rows = students.map((s) => {
      const r = byStudent.get(s.id);
      return [
        s.student_no, s.first_name, s.last_name, s.course, s.year_level,
        r ? displayStatus(event, r) : (windowPassed ? 'absent' : ''),
        r?.method || '',
        isoUtc(r?.checkedInAt),
        isoUtc(r?.checkedOutAt),
      ];
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="event-${event.id}-attendance.csv"`);
    return res.send(toCsv(['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Classification', 'Method', 'Time In', 'Time Out'], rows));
  }

  if (type === 'matrix') {
    const events = await all(`SELECT ${EVENT_COLS} FROM events`);
    const students = await all(
      'SELECT id, student_no, first_name, last_name FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
    );
    const records = await all(`SELECT ${RECORD_COLS} FROM attendance`);
    const eventById = new Map(events.map((e) => [e.id, e]));
    const map = {};
    for (const r of records) {
      const cls = displayStatus(eventById.get(r.eventId), r);
      if (cls) map[`${r.eventId}:${r.studentId}`] = cls;
    }
    const headers = ['Student No', 'First Name', 'Last Name', ...events.map((e) => e.name)];
    const csv = toCsv(
      headers,
      students.map((s) => [
        s.student_no, s.first_name, s.last_name,
        ...events.map((e) => map[`${e.id}:${s.id}`] || 'absent'),
      ])
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-matrix.csv"');
    return res.send(csv);
  }

  // default: per-student summary
  const totalEvents = (await get('SELECT COUNT(*) AS c FROM events')).c;
  const rows = await all(
    `SELECT s.student_no, s.first_name, s.last_name, s.course, s.year_level,
            SUM(CASE WHEN a.status IN ('early','on-time','late','present') THEN 1 ELSE 0 END) AS attended
     FROM students s LEFT JOIN attendance a ON a.student_id = s.id
     GROUP BY s.id ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`
  );
  const csv = toCsv(
    ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Events Attended', 'Total Events', 'Rate %'],
    rows.map((r) => [
      r.student_no, r.first_name, r.last_name, r.course, r.year_level,
      r.attended, totalEvents,
      totalEvents ? Math.round((Number(r.attended) / totalEvents) * 100) : 0,
    ])
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="student-attendance-summary.csv"');
  res.send(csv);
});

export default router;
