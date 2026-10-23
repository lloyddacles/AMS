import { all, get } from '../db.js';
import { buildRiskModel } from './risk.js';
import { exclusionsByEvent } from './roster.js';
import { logicalUnits, seriesNameMap, aggregateUnit, unitEntries, recordsByEvent, cutoffsFor } from './series.js';

const EVENT_COLS = 'id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime, series_id AS seriesId';
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
  const seriesNames = await seriesNameMap();
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
  const excluded = await exclusionsByEvent(events.map((e) => e.id));

  // A series counts once no matter how many days it spans; per-day statuses
  // collapse into one logical status per student (see services/series.js).
  const units = logicalUnits(events, seriesNames);
  const now = new Date();
  const ctx = {
    excluded,
    records: recordsByEvent(records),
    cutoffs: cutoffsFor(events),
    now,
  };

  const totalEvents = units.length;
  const rows = students.map((s) => {
    const counts = { early: 0, onTime: 0, late: 0, absent: 0, excused: 0 };
    // Logical events this student is actually on the attendee list for (any
    // day) — the real denominator for their rate, needed count and risk.
    let expected = 0;
    for (const u of units) {
      const agg = aggregateUnit(unitEntries(u, s.id, ctx));
      if (!agg.expected) continue;
      expected += 1;
      if (agg.status) bucket(counts, agg.status);
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
      expected,
      excludedEvents: totalEvents - expected,
      rate: expected ? Math.round((attended / expected) * 100) : 0,
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
        // A student off every event's attendee list has no rate to judge.
        .filter((s) => s.expected > 0 && s.rate < threshold)
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

// Resolve the attendance minimum used for compliance: the selected term's
// configured minimum, the current term's minimum, or the global at-risk
// threshold when no term applies.
export async function resolveComplianceTarget({ termId = null } = {}) {
  const cols = 'id, name, min_attendance AS minAttendance, is_current AS isCurrent';
  let term = null;
  if (termId) {
    term = await get(`SELECT ${cols} FROM terms WHERE id = ?`, [termId]);
  } else {
    term = await get(`SELECT ${cols} FROM terms WHERE is_current = 1 LIMIT 1`);
  }
  if (term) return { termId: term.id, termName: term.name, minimum: term.minAttendance };
  const settings = await getSettings();
  return { termId: null, termName: null, minimum: settings.atRiskThreshold };
}

// Students who fall below their term's minimum attendance percentage. Each row
// is annotated with how many more attendances they need to reach the minimum.
export async function buildCompliance({ search = '', course = '', termId = null, from = '', to = '' } = {}) {
  const target = await resolveComplianceTarget({ termId });
  const { totalEvents, students } = await buildOverview({ search, course, termId, from, to });
  const minimum = target.minimum;
  const eligible = totalEvents > 0;
  const list = eligible
    ? students
        // Each student needs the minimum across the events they actually attend.
        .filter((s) => s.expected > 0 && s.rate < minimum)
        .map((s) => ({ ...s, needed: Math.max(0, Math.ceil((minimum / 100) * s.expected) - s.attended) }))
        .sort(
          (a, b) =>
            a.rate - b.rate ||
            String(a.lastName || '').localeCompare(String(b.lastName || '')) ||
            String(a.firstName || '').localeCompare(String(b.firstName || ''))
        )
    : [];

  return {
    termId: target.termId,
    termName: target.termName,
    minimum,
    totalEvents,
    totalStudents: students.length,
    eligible,
    below: list.length,
    compliantCount: students.length - list.length,
    students: list,
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
  const seriesNames = await seriesNameMap();

  const students = await all(
    `SELECT id FROM students WHERE (? = '' OR course = ?)`,
    [course, course]
  );
  const studentIds = new Set(students.map((s) => s.id));
  const totalStudents = studentIds.size;
  const excluded = await exclusionsByEvent(events.map((e) => e.id));

  let records = [];
  if (events.length) {
    const placeholders = events.map(() => '?').join(',');
    records = await all(
      `SELECT ${RECORD_COLS} FROM attendance WHERE event_id IN (${placeholders})`,
      events.map((e) => e.id)
    );
  }

  // Series land in the bucket of their first day and count as one event.
  const units = logicalUnits(events, seriesNames);
  const now = new Date();
  const ctx = {
    excluded,
    records: recordsByEvent(records),
    cutoffs: cutoffsFor(events),
    now,
  };

  const buckets = new Map();
  const order = [];
  let sumPresent = 0;
  let sumExcused = 0;
  let sumAbsent = 0;

  for (const u of units) {
    const counts = { early: 0, onTime: 0, late: 0, absent: 0, excused: 0 };
    for (const sid of studentIds) {
      const agg = aggregateUnit(unitEntries(u, sid, ctx));
      if (!agg.expected || !agg.status) continue;
      bucket(counts, agg.status);
    }
    const present = counts.early + counts.onTime + counts.late;

    const key = granularity === 'event' ? u.key : bucketKey(u.date, granularity);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label: granularity === 'event' ? u.name : key,
        date: u.date,
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
      events: units.length,
      present: sumPresent,
      excused: sumExcused,
      absent: sumAbsent,
      decided: decidedTotal,
      rate: decidedTotal ? Math.round((sumPresent / decidedTotal) * 100) : 0,
      totalStudents,
    },
  };
}
