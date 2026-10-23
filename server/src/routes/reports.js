import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { displayStatus, absentCutoff } from '../classify.js';
import { buildOverview, buildAtRisk, buildTrends, buildCompliance, eventFilter } from '../services/reports.js';
import { buildRiskModel } from '../services/risk.js';
import { exclusionsByEvent } from '../services/roster.js';
import { logicalUnits, seriesNameMap, aggregateUnit, unitEntries, recordsByEvent, cutoffsFor } from '../services/series.js';

const router = Router();
router.use(requireAuth);

function rangeFilters(query) {
  return {
    from: query.from || '',
    to: query.to || '',
    termId: query.termId ? Number(query.termId) : null,
  };
}

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

// "eventId:studentId" keys for students who are off an event's attendee list,
// so the matrix can render them as not attending instead of absent.
async function excludedKeysFor(eventIds) {
  const map = await exclusionsByEvent(eventIds);
  const keys = {};
  for (const [eventId, set] of map) {
    for (const sid of set) keys[`${eventId}:${sid}`] = true;
  }
  return keys;
}

// Per-student summary, classified early / on-time / late / absent.
router.get('/overview', async (req, res) => {
  const { search = '', course = '' } = req.query;
  res.json(await buildOverview({ search, course, ...rangeFilters(req.query) }));
});

// Students below the configured attendance-rate threshold.
router.get('/at-risk', async (req, res) => {
  const { search = '', course = '' } = req.query;
  res.json(await buildAtRisk({ search, course, ...rangeFilters(req.query) }));
});

// Students below their term's minimum attendance percentage (compliance).
router.get('/compliance', async (req, res) => {
  const { search = '', course = '' } = req.query;
  res.json(await buildCompliance({ search, course, ...rangeFilters(req.query) }));
});

// Time-series attendance trend (one point per event / day / week / month).
router.get('/trends', async (req, res) => {
  const { course = '', granularity = 'day' } = req.query;
  const g = ['event', 'day', 'week', 'month'].includes(granularity) ? granularity : 'day';
  res.json(await buildTrends({ course, granularity: g, ...rangeFilters(req.query) }));
});

// Event × student matrix of classifications.
router.get('/matrix', async (req, res) => {
  const ef = eventFilter(rangeFilters(req.query));
  const events = await all(`SELECT ${EVENT_COLS} FROM events${ef.sql}`, ef.params);
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
  res.json({ events, students, records: map, excluded: await excludedKeysFor(events.map((e) => e.id)) });
});

// Explainable attendance risk for every student (logistic model + exact SHAP),
// sorted most-at-risk first.
router.get('/risk', async (req, res) => {
  const model = await buildRiskModel();
  const students = [...model.students].sort(
    (a, b) => b.risk - a.risk || String(a.lastName || '').localeCompare(String(b.lastName || ''))
  );
  res.json({ totalEvents: model.totalEvents, context: model.context, students });
});

// Full explanation (all feature contributions) for a single student.
router.get('/risk/:studentId', async (req, res) => {
  const model = await buildRiskModel();
  const student = model.byStudent.get(Number(req.params.studentId));
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json({ totalEvents: model.totalEvents, context: model.context, student });
});

router.get('/export', async (req, res) => {
  const { type = 'students', eventId, search = '', course = '' } = req.query;
  const range = rangeFilters(req.query);

  if (type === 'at-risk') {
    const { threshold, minEvents, totalEvents, students } = await buildAtRisk({ search, course, ...range });
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

  if (type === 'compliance') {
    const { termName, minimum, totalEvents, students } = await buildCompliance({ search, course, ...range });
    const headers = ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Attended', 'Absent', 'Excused', 'Rate %', 'Needed'];
    const rows = students.map((s) => [
      s.studentNo, s.firstName, s.lastName, s.course, s.yearLevel, s.attended, s.absent, s.excused, s.rate, s.needed,
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="compliance-students.csv"');
    res.setHeader('X-Compliance-Minimum', String(minimum));
    res.setHeader('X-Compliance-Term', termName || '');
    res.setHeader('X-Total-Events', String(totalEvents));
    return res.send(toCsv(headers, rows));
  }

  if (type === 'event') {
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const event = await get(`SELECT ${EVENT_COLS} FROM events WHERE id = ?`, [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const records = await all(
      `SELECT ${RECORD_COLS}, note, checked_out_at AS checkedOutAt FROM attendance WHERE event_id = ?`,
      [event.id]
    );
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const students = await all(
      'SELECT id, student_no, first_name, last_name, course, year_level FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
    );
    const cutoff = absentCutoff(event);
    const windowPassed = cutoff ? new Date() > cutoff : false;
    const out = (await exclusionsByEvent([event.id])).get(event.id) || new Set();
    const rows = students.map((s) => {
      const r = byStudent.get(s.id);
      const classification = out.has(s.id)
        ? 'n/a'
        : r
          ? displayStatus(event, r)
          : (windowPassed ? 'absent' : '');
      return [
        s.student_no, s.first_name, s.last_name, s.course, s.year_level,
        classification,
        r?.method || '',
        isoUtc(r?.checkedInAt),
        isoUtc(r?.checkedOutAt),
        r?.note || '',
      ];
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="event-${event.id}-attendance.csv"`);
    return res.send(toCsv(['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Classification', 'Method', 'Time In', 'Time Out', 'Reason'], rows));
  }

  if (type === 'matrix') {
    const ef = eventFilter(range);
    const events = await all(`SELECT ${EVENT_COLS} FROM events${ef.sql}`, ef.params);
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
    const excluded = await excludedKeysFor(events.map((e) => e.id));
    const headers = ['Student No', 'First Name', 'Last Name', ...events.map((e) => e.name)];
    const csv = toCsv(
      headers,
      students.map((s) => [
        s.student_no, s.first_name, s.last_name,
        ...events.map((e) => (excluded[`${e.id}:${s.id}`] ? 'n/a' : map[`${e.id}:${s.id}`] || 'absent')),
      ])
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-matrix.csv"');
    return res.send(csv);
  }

  // default: per-student summary (within the selected date range / term)
  const ef = eventFilter(range);
  const evRows = await all(`SELECT id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime, series_id AS seriesId FROM events${ef.sql}`, ef.params);
  const seriesNames = await seriesNameMap();
  const units = logicalUnits(evRows, seriesNames);
  const totalEvents = units.length;
  let rows;
  if (totalEvents === 0) {
    rows = await all(
      `SELECT id, student_no, first_name, last_name, course, year_level, 0 AS attended
       FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`
    );
    const csv = toCsv(
      ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Events Attended', 'Total Events', 'Rate %'],
      rows.map((r) => [r.student_no, r.first_name, r.last_name, r.course, r.year_level, 0, 0, 0])
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="student-attendance-summary.csv"');
    return res.send(csv);
  }
  const eventIds = evRows.map((e) => e.id);
  const students = await all(
    'SELECT id, student_no, first_name, last_name, course, year_level FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
  );
  const records = await all(
    `SELECT event_id AS eventId, student_id AS studentId, status, method, checked_in_at AS checkedInAt FROM attendance WHERE event_id IN (${eventIds.map(() => '?').join(',')})`,
    eventIds
  );
  const excluded = await exclusionsByEvent(eventIds);
  const now = new Date();
  const ctx = { excluded, records: recordsByEvent(records), cutoffs: cutoffsFor(evRows), now };
  const csv = toCsv(
    ['Student No', 'First Name', 'Last Name', 'Course', 'Year Level', 'Events Attended', 'Total Events', 'Rate %'],
    students.map((s) => {
      let attended = 0;
      let expected = 0;
      for (const u of units) {
        const agg = aggregateUnit(unitEntries(u, s.id, ctx));
        if (!agg.expected) continue;
        expected += 1;
        if (agg.status === 'early' || agg.status === 'on-time' || agg.status === 'present' || agg.status === 'late') attended += 1;
      }
      return [s.student_no, s.first_name, s.last_name, s.course, s.year_level, attended, expected, expected ? Math.round((attended / expected) * 100) : 0];
    })
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="student-attendance-summary.csv"');
  res.send(csv);
});

export default router;
