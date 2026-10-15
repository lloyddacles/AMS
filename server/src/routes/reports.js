import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { displayStatus, absentCutoff } from '../classify.js';
import { buildOverview, buildAtRisk } from '../services/reports.js';

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
const RECORD_COLS = 'event_id AS eventId, student_id AS studentId, status, method, checked_in_at AS checkedInAt';

// Per-student summary, classified early / on-time / late / absent.
router.get('/overview', async (req, res) => {
  const { search = '', course = '' } = req.query;
  res.json(await buildOverview({ search, course }));
});

// Students below the configured attendance-rate threshold.
router.get('/at-risk', async (req, res) => {
  const { search = '', course = '' } = req.query;
  res.json(await buildAtRisk({ search, course }));
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
  const { type = 'students', eventId, search = '', course = '' } = req.query;

  if (type === 'at-risk') {
    const { threshold, minEvents, totalEvents, students } = await buildAtRisk({ search, course });
    const headers = ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Attended', 'Absent', 'Excused', 'Rate %'];
    const rows = students.map((s) => [
      s.studentNo, s.firstName, s.lastName, s.course, s.yearLevel, s.attended, s.absent, s.excused, s.rate,
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="at-risk-students.csv"');
    res.setHeader('X-At-Risk-Threshold', String(threshold));
    res.setHeader('X-At-Risk-Min-Events', String(minEvents));
    res.setHeader('X-Total-Events', String(totalEvents));
    return res.send(toCsv(headers, rows));
  }

  if (type === 'event') {
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const event = await get(`SELECT ${EVENT_COLS} FROM events WHERE id = ?`, [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const records = await all(
      `SELECT ${RECORD_COLS}, checked_out_at AS checkedOutAt FROM attendance WHERE event_id = ?`,
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
