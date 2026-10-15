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

// Per-student summary, classified early / on-time / late / absent.
export async function buildOverview({ search = '', course = '' } = {}) {
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
