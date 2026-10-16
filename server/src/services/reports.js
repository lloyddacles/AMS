import { all } from '../db.js';
import { displayStatus, absentCutoff } from '../classify.js';
import { getSettings } from './settings.js';
import { buildRiskModel } from './risk.js';

const EVENT_COLS = 'id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime';
const RECORD_COLS = 'event_id AS eventId, student_id AS studentId, status, method, checked_in_at AS checkedInAt';

function bucket(counts, cls) {
  if (cls === 'early') counts.early += 1;
  else if (cls === 'on-time' || cls === 'present') counts.onTime += 1;
  else if (cls === 'late') counts.late += 1;
  else if (cls === 'excused') counts.excused += 1;
  else counts.absent += 1;
}

// Build a WHERE fragment (plus params) selecting events within an optional
// date range and/or term. Filters are inclusive and independent.
export function eventFilter({ from = '', to = '', termId = null } = {}) {
  const clauses = [];
  const params = [];
  if (from) {
    clauses.push('event_date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('event_date <= ?');
    params.push(to);
  }
  if (termId) {
    clauses.push('term_id = ?');
    params.push(termId);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

// Monday (YYYY-MM-DD) of the ISO week containing a YYYY-MM-DD date.
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function bucketKey(dateStr, granularity) {
  if (granularity === 'month') return String(dateStr).slice(0, 7);
  if (granularity === 'week') return weekStart(dateStr);
  return dateStr;
}

// Per-student summary, classified early / on-time / late / absent, over an
// optional date range and term.
export async function buildOverview({ search = '', course = '', from = '', to = '', termId = null } = {}) {
  const like = `%${search}%`;
  const ef = eventFilter({ from, to, termId });
  const events = await all(`SELECT ${EVENT_COLS} FROM events${ef.sql}`, ef.params);
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

  return { totalEvents, students: rows };
}

// Students whose attendance rate falls below the configured threshold. Each
// flagged student is annotated with an explainable risk score (logistic model,
// exact SHAP) plus its top contributing factors.
export async function buildAtRisk(filters = {}) {
  const settings = await getSettings();
  const threshold = settings.atRiskThreshold;
  const minEvents = settings.atRiskMinEvents;
  const { totalEvents, students } = await buildOverview(filters);
  const eligible = totalEvents >= minEvents;
  const list = eligible
    ? students
        .filter((s) => s.rate < threshold)
        .sort(
          (a, b) =>
            a.rate - b.rate ||
            String(a.lastName || '').localeCompare(String(b.lastName || '')) ||
            String(a.firstName || '').localeCompare(String(b.firstName || ''))
        )
    : [];

  // Attach the explainable risk model (best-effort: never block the report).
  let model = null;
  try {
    model = await buildRiskModel();
  } catch {
    model = null;
  }
  const annotated = model
    ? list.map((s) => {
        const r = model.byStudent.get(s.id);
        return r
          ? { ...s, risk: r.risk, riskLevel: r.riskLevel, riskProbability: r.riskProbability, drivers: r.drivers }
          : s;
      })
    : list;

  return {
    threshold,
    minEvents,
    totalEvents,
    students: annotated,
    model: model ? { context: model.context } : null,
  };
}

// Attendance trend over time. Produces one point per bucket (event / day /
// week / month), each with status counts and an attendance rate computed over
// decided slots (present + excused + absent) so future/open events don't drag
// the line down.
export async function buildTrends({ from = '', to = '', termId = null, course = '', granularity = 'day' } = {}) {
  const ef = eventFilter({ from, to, termId });
  const events = await all(
    `SELECT ${EVENT_COLS} FROM events${ef.sql} ORDER BY event_date, start_time`,
    ef.params
  );

  const students = await all(
    `SELECT id FROM students WHERE (? = '' OR course = ?)`,
    [course, course]
  );
  const studentIds = new Set(students.map((s) => s.id));
  const totalStudents = studentIds.size;

  let records = [];
  if (events.length) {
    const placeholders = events.map(() => '?').join(',');
    records = await all(
      `SELECT ${RECORD_COLS} FROM attendance WHERE event_id IN (${placeholders})`,
      events.map((e) => e.id)
    );
  }
  const byEvent = new Map();
  for (const r of records) {
    if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, []);
    byEvent.get(r.eventId).push(r);
  }

  const now = new Date();
  const buckets = new Map();
  const order = [];
  let sumPresent = 0;
  let sumExcused = 0;
  let sumAbsent = 0;

  for (const e of events) {
    const counts = { early: 0, onTime: 0, late: 0, absent: 0, excused: 0 };
    let recorded = 0;
    for (const r of byEvent.get(e.id) || []) {
      if (!studentIds.has(r.studentId)) continue;
      bucket(counts, displayStatus(e, r));
      recorded += 1;
    }
    const cutoff = absentCutoff(e);
    const decided = cutoff ? now > cutoff : false;
    if (decided) counts.absent += Math.max(0, totalStudents - recorded);

    const present = counts.early + counts.onTime + counts.late;
    const key = granularity === 'event' ? String(e.id) : bucketKey(e.eventDate, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: granularity === 'event' ? e.name : key,
        date: e.eventDate,
        events: 0,
        present: 0,
        early: 0,
        onTime: 0,
        late: 0,
        excused: 0,
        absent: 0,
        students: totalStudents,
      });
      order.push(key);
    }
    const b = buckets.get(key);
    b.events += 1;
    b.present += present;
    b.early += counts.early;
    b.onTime += counts.onTime;
    b.late += counts.late;
    b.excused += counts.excused;
    b.absent += counts.absent;
    sumPresent += present;
    sumExcused += counts.excused;
    sumAbsent += counts.absent;
  }

  const points = order.map((key) => {
    const b = buckets.get(key);
    const decided = b.present + b.excused + b.absent;
    return { ...b, decided, rate: decided ? Math.round((b.present / decided) * 100) : 0 };
  });

  const decidedTotal = sumPresent + sumExcused + sumAbsent;
  return {
    from: from || null,
    to: to || null,
    termId: termId || null,
    course: course || null,
    granularity,
    totalStudents,
    points,
    summary: {
      events: events.length,
      present: sumPresent,
      excused: sumExcused,
      absent: sumAbsent,
      decided: decidedTotal,
      rate: decidedTotal ? Math.round((sumPresent / decidedTotal) * 100) : 0,
      totalStudents,
    },
  };
}
