import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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

// Per-student attendance summary
router.get('/overview', async (req, res) => {
  const { search = '', course = '' } = req.query;
  const like = `%${search}%`;
  const totalEvents = (await get('SELECT COUNT(*) AS c FROM events')).c;
  const rows = await all(
    `SELECT s.id, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
            s.course, s.year_level AS yearLevel,
            COUNT(a.id) AS attended,
            COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END), 0) AS late,
            COALESCE(SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END), 0) AS excused,
            COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent
     FROM students s
     LEFT JOIN attendance a ON a.student_id = s.id
     WHERE (s.student_no LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ?)
       AND (? = '' OR s.course = ?)
     GROUP BY s.id
     ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`,
    [like, like, like, course, course]
  );

  res.json({
    totalEvents,
    students: rows.map((r) => {
      const attended = Number(r.present) + Number(r.late);
      return {
        ...r,
        attended,
        rate: totalEvents ? Math.round((attended / totalEvents) * 100) : 0,
      };
    }),
  });
});

// Attendance matrix: every student x every event
router.get('/matrix', async (req, res) => {
  const events = await all('SELECT id, name, event_date AS eventDate FROM events ORDER BY event_date, id');
  const students = await all(
    'SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
  );
  const records = await all('SELECT event_id AS eventId, student_id AS studentId, status FROM attendance');
  const map = {};
  for (const r of records) map[`${r.eventId}:${r.studentId}`] = r.status;
  res.json({ events, students, records: map });
});

router.get('/export', async (req, res) => {
  const { type = 'students', eventId } = req.query;

  if (type === 'event') {
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const event = await get('SELECT * FROM events WHERE id = ?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const rows = await all(
      `SELECT s.student_no, s.first_name, s.last_name, s.course, s.year_level,
              a.status, a.method, a.checked_in_at, a.checked_out_at
       FROM attendance a JOIN students s ON s.id = a.student_id
       WHERE a.event_id = ?
       ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`,
      [eventId]
    );
    const csv = toCsv(
      ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Status', 'Method', 'Time In', 'Time Out'],
      rows.map((r) => [r.student_no, r.first_name, r.last_name, r.course, r.year_level, r.status, r.method, isoUtc(r.checked_in_at), isoUtc(r.checked_out_at)])
    );
    const filename = `event-${event.id}-attendance.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }

  if (type === 'matrix') {
    const events = await all('SELECT id, name FROM events ORDER BY event_date, id');
    const students = await all(
      'SELECT id, student_no, first_name, last_name FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
    );
    const records = await all('SELECT event_id, student_id, status FROM attendance');
    const map = {};
    for (const r of records) map[`${r.event_id}:${r.student_id}`] = r.status;
    const headers = ['Student No', 'First Name', 'Last Name', ...events.map((e) => e.name)];
    const csv = toCsv(
      headers,
      students.map((s) => [
        s.student_no,
        s.first_name,
        s.last_name,
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
            SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) AS attended
     FROM students s LEFT JOIN attendance a ON a.student_id = s.id
     GROUP BY s.id ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`
  );
  const csv = toCsv(
    ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Events Attended', 'Total Events', 'Rate %'],
    rows.map((r) => [
      r.student_no,
      r.first_name,
      r.last_name,
      r.course,
      r.year_level,
      r.attended,
      totalEvents,
      totalEvents ? Math.round((Number(r.attended) / totalEvents) * 100) : 0,
    ])
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="student-attendance-summary.csv"');
  res.send(csv);
});

export default router;
