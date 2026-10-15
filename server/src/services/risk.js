import { all } from '../db.js';
import { displayStatus, absentCutoff, isAttendedStatus, todayInTz } from '../classify.js';

// Transparent attendance-risk model.
//
// A logistic regression over a small set of engineered, risk-oriented features
// (each scaled so that larger = more risk). Because the model is linear in the
// log-odds, its SHAP values have a closed form:
//
//     phi_i(x) = w_i * (x_i - E[x_i])
//
// so the explanation is exact (not approximated) and needs no Python runtime.
// Contributions are expressed in log-odds space; the base value is the model
// output at the cohort-average feature vector. The weights are calibrated
// priors (there is no labelled outcome data yet) and are intentionally simple
// and auditable.
export const RISK_FEATURES = [
  { key: 'missRate', label: 'Missed check-ins', weight: 4.0, describe: 'Share of events with no check-in.' },
  { key: 'recentMissRate', label: 'Recent absences', weight: 3.0, describe: 'Absences across the last few events.' },
  { key: 'streakNorm', label: 'Consecutive absences', weight: 2.0, describe: 'Current run of back-to-back absences.' },
  { key: 'lateRate', label: 'Tardiness', weight: 1.5, describe: 'Share of events arrived late.' },
  { key: 'recencyNorm', label: 'Time since last attendance', weight: 1.2, describe: 'How long since the last check-in.' },
  { key: 'excusedRate', label: 'Excused absences', weight: -0.8, describe: 'Excused absences count as lower risk.' },
];

export const RISK_BIAS = -3.0;
const STREAK_CAP = 5;
const RECENCY_CAP_DAYS = 21;
const RECENT_WINDOW = 3;

const LABELS = Object.fromEntries(RISK_FEATURES.map((f) => [f.key, f.label]));

export const featureLabel = (key) => LABELS[key] || key;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function daysBetween(a, b) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

function riskLevel(probability) {
  if (probability >= 0.75) return 'critical';
  if (probability >= 0.5) return 'high';
  if (probability >= 0.25) return 'moderate';
  return 'low';
}

function featureText(key, raw) {
  switch (key) {
    case 'missRate':
      return `${raw.absent}/${raw.total} missed`;
    case 'lateRate':
      return `${raw.late}/${raw.total} late`;
    case 'excusedRate':
      return `${raw.excused}/${raw.total} excused`;
    case 'recentMissRate':
      return `${raw.recentMiss}/${raw.recentTotal} recent absences`;
    case 'streakNorm':
      return raw.streak > 0 ? `${raw.streak} absence${raw.streak === 1 ? '' : 's'} in a row` : 'no active streak';
    case 'recencyNorm':
      return raw.daysSince >= RECENCY_CAP_DAYS && !raw.everAttended
        ? 'never attended'
        : `last attended ${raw.daysSince}d ago`;
    default:
      return '';
  }
}

// Compute the risk model for every student. Returns the cohort context (feature
// means/weights used as the SHAP background) plus a per-student result.
export async function buildRiskModel() {
  const events = await all(
    'SELECT id, event_date, start_time, end_time FROM events ORDER BY event_date ASC, id ASC'
  );
  const students = await all(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName, course, year_level AS yearLevel
     FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`
  );

  const emptyContext = {
    bias: RISK_BIAS,
    features: RISK_FEATURES.map((f) => ({ key: f.key, label: f.label, weight: f.weight, mean: 0, describe: f.describe })),
    expectedMargin: RISK_BIAS,
    expectedProbability: sigmoid(RISK_BIAS),
  };
  if (!events.length) {
    return { totalEvents: 0, context: emptyContext, byStudent: new Map(), students: [] };
  }

  const records = await all(
    'SELECT event_id AS eventId, student_id AS studentId, status, method, checked_in_at AS checkedInAt FROM attendance'
  );
  const recByStudent = new Map();
  for (const r of records) {
    if (!recByStudent.has(r.studentId)) recByStudent.set(r.studentId, new Map());
    recByStudent.get(r.studentId).set(r.eventId, r);
  }
  const cutoffs = new Map(events.map((e) => [e.id, absentCutoff(e)]));
  const now = new Date();
  const today = todayInTz();

  const classify = (event, rec) => {
    if (rec) return displayStatus(event, rec);
    const cutoff = cutoffs.get(event.id);
    return cutoff && now > cutoff ? 'absent' : null;
  };

  const rows = [];
  for (const s of students) {
    const recs = recByStudent.get(s.id) || new Map();
    let attended = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    let lastAttendedDate = null;
    const seq = [];
    for (const e of events) {
      const cls = classify(e, recs.get(e.id));
      seq.push(cls);
      if (cls === 'excused') excused += 1;
      else if (isAttendedStatus(cls)) {
        attended += 1;
        if (cls === 'late') late += 1;
        lastAttendedDate = e.event_date;
      } else if (cls === 'absent') absent += 1;
    }
    const total = events.length;
    const recent = seq.slice(-Math.min(RECENT_WINDOW, total));
    const recentMiss = recent.filter((c) => c === 'absent').length;
    let streak = 0;
    for (let i = seq.length - 1; i >= 0; i--) {
      const c = seq[i];
      if (c === null) continue; // pending / future event
      if (c === 'absent') streak += 1;
      else break;
    }
    const everAttended = !!lastAttendedDate;
    const daysSince = everAttended ? Math.max(0, daysBetween(today, lastAttendedDate)) : RECENCY_CAP_DAYS;
    const features = {
      missRate: total ? absent / total : 0,
      recentMissRate: recent.length ? recentMiss / recent.length : 0,
      streakNorm: Math.min(streak, STREAK_CAP) / STREAK_CAP,
      lateRate: total ? late / total : 0,
      recencyNorm: Math.min(daysSince, RECENCY_CAP_DAYS) / RECENCY_CAP_DAYS,
      excusedRate: total ? excused / total : 0,
    };
    rows.push({
      student: s,
      features,
      raw: { attended, absent, late, excused, total, recentMiss, recentTotal: recent.length, streak, daysSince, everAttended },
    });
  }

  const n = rows.length || 1;
  const means = {};
  for (const f of RISK_FEATURES) means[f.key] = rows.reduce((a, r) => a + r.features[f.key], 0) / n;

  const expectedMargin = RISK_BIAS + RISK_FEATURES.reduce((a, f) => a + f.weight * means[f.key], 0);
  const context = {
    bias: RISK_BIAS,
    features: RISK_FEATURES.map((f) => ({ key: f.key, label: f.label, weight: f.weight, mean: Number(means[f.key].toFixed(4)), describe: f.describe })),
    expectedMargin: Number(expectedMargin.toFixed(4)),
    expectedProbability: Number(sigmoid(expectedMargin).toFixed(4)),
  };

  const byStudent = new Map();
  const list = rows.map(({ student, features, raw }) => {
    let margin = RISK_BIAS;
    for (const f of RISK_FEATURES) margin += f.weight * features[f.key];
    const probability = sigmoid(margin);
    const contributions = RISK_FEATURES.map((f) => {
      const contribution = f.weight * (features[f.key] - means[f.key]);
      return {
        key: f.key,
        label: f.label,
        weight: f.weight,
        value: Number(features[f.key].toFixed(3)),
        contribution: Number(contribution.toFixed(4)),
        text: featureText(f.key, raw),
      };
    });
    const sumAbs = contributions.reduce((a, c) => a + Math.abs(c.contribution), 0) || 1;
    for (const c of contributions) {
      c.pct = Math.round((Math.abs(c.contribution) / sumAbs) * 100);
      c.direction = c.contribution >= 0 ? 'up' : 'down';
    }
    contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    const result = {
      id: student.id,
      studentNo: student.studentNo,
      firstName: student.firstName,
      lastName: student.lastName,
      course: student.course,
      yearLevel: student.yearLevel,
      risk: Math.round(probability * 100),
      riskProbability: Number(probability.toFixed(4)),
      riskMargin: Number(margin.toFixed(4)),
      riskLevel: riskLevel(probability),
      raw,
      contributions,
      drivers: contributions.slice(0, 4),
    };
    byStudent.set(student.id, result);
    return result;
  });

  return { totalEvents: events.length, context, byStudent, students: list };
}
