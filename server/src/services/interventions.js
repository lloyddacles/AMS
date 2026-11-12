import { all, get, run } from '../db.js';
import { buildRiskModel } from './risk.js';
import { buildOverview } from './reports.js';
import { logAudit } from './audit.js';
import { studentScopeFilter } from './academic.js';

export const CAUSE_CATEGORIES = [
  'Medical Issues',
  'Family Problems',
  'Financial Concerns',
  'Personal/Emotional Issues',
  'Academic Difficulties',
  'Transportation Issues',
  'Bullying/Safety Concerns',
  'Other',
];

export const FLAG_RULES = {
  consecutiveAbsences: 3,
  consecutiveLates: 3,
  totalAbsences: 5,
  totalLates: 5,
  combinedAbsenceLate: 8,
};

const RISK_EXEMPT_STATUSES = new Set(['Deceased', 'Dropped', 'LOA']);

function studentName(s) {
  return `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, '').trim() || s.studentNo || 'Student';
}

export function computeInterventionFlags(raw = {}) {
  const absent = Number(raw.absent || 0);
  const late = Number(raw.late || 0);
  const streak = Number(raw.streak || 0);
  const lateStreak = Number(raw.lateStreak || 0);
  const total = Number(raw.total || 0);
  const triggers = [];
  if (streak >= FLAG_RULES.consecutiveAbsences) {
    triggers.push({ code: 'consecutive_absences', label: `${streak} consecutive absences`, priority: 'High' });
  }
  if (lateStreak >= FLAG_RULES.consecutiveLates) {
    triggers.push({ code: 'consecutive_lates', label: `${lateStreak} consecutive lates`, priority: 'High' });
  }
  if (absent >= FLAG_RULES.totalAbsences) {
    triggers.push({ code: 'accumulated_absences', label: `${absent} total absences`, priority: absent >= 8 ? 'High' : 'Medium' });
  }
  if (late >= FLAG_RULES.totalLates) {
    triggers.push({ code: 'accumulated_lates', label: `${late} total lates`, priority: late >= 8 ? 'High' : 'Medium' });
  }
  if (absent + late >= FLAG_RULES.combinedAbsenceLate && !triggers.some((t) => t.code === 'accumulated_absences' || t.code === 'accumulated_lates')) {
    triggers.push({ code: 'accumulated_absence_late', label: `${absent + late} combined absences/lates`, priority: 'Medium' });
  }
  const flagged = triggers.length > 0;
  const priority = triggers.some((t) => t.priority === 'High') ? 'High' : triggers.length ? 'Medium' : 'Low';
  return { flagged, priority, triggers, totals: { absent, late, streak, lateStreak, expected: total } };
}

function issuePhrase(flags = {}) {
  const t = flags?.triggers || [];
  const hasAbs = t.some((x) => x.code === 'consecutive_absences' || x.code === 'accumulated_absences' || x.code === 'accumulated_absence_late');
  const hasLate = t.some((x) => x.code === 'consecutive_lates' || x.code === 'accumulated_lates' || x.code === 'accumulated_absence_late');
  if (hasAbs && hasLate) return 'many absences and times being late';
  if (hasAbs) return 'many absences';
  if (hasLate) return 'being late many times';
  return 'attendance concerns';
}

export function suggestCauseDetails({ flags, causeCategory, student } = {}) {
  const first = student?.firstName || 'The student';
  const issue = issuePhrase(flags);
  const baseByCategory = {
    'Medical Issues': `${first} may be feeling sick or has health problems that make it hard to attend or come on time. Please check if there is a medical note or if the student needs health support.`,
    'Family Problems': `${first} may be facing family concerns at home that affect attendance. Please talk kindly with the student to understand the situation and what support is needed.`,
    'Financial Concerns': `${first} may have money or allowance problems that affect going to school or coming on time. Please check if the student needs support or referral to available help.`,
    'Personal/Emotional Issues': `${first} may be feeling stressed, sad, or worried, which can affect attendance. Please check how the student is doing and offer support or referral if needed.`,
    'Academic Difficulties': `${first} may be having a hard time with schoolwork, which can affect motivation to attend. Please check if the student needs tutoring, guidance, or teacher support.`,
    'Transportation Issues': `${first} may have trouble with transportation or travel going to school, causing absences or lateness. Please ask about travel problems and possible solutions.`,
    'Bullying/Safety Concerns': `${first} may feel unsafe or uncomfortable at school, which can affect attendance. Please check the student's safety and refer to the proper school office if needed.`,
    'Other': `${first} may have other personal reasons affecting attendance. Please talk with the student to better understand the cause and needed support.`,
  };
  const base = baseByCategory[String(causeCategory || '').trim()] || `${first} is showing ${issue}. The exact reason is not yet clear. Please talk with the student (and guardian if needed) to understand what is causing this.`;
  return base;
}

export function suggestInterventionAction({ flags, causeCategory, student } = {}) {
  const issue = issuePhrase(flags);
  const t = flags?.triggers || [];
  const severe = t.some((x) => x.priority === 'High') || Number(flags?.totals?.streak || 0) >= 3 || Number(flags?.totals?.lateStreak || 0) >= 3;
  const cat = String(causeCategory || '').trim();
  const steps = [];
  steps.push(`Talked with the student about ${issue} and listened to their concerns in simple and clear words.`);
  if (cat === 'Medical Issues') steps.push('Asked for a medical note if available and discussed how the student can catch up after absences.');
  else if (cat === 'Family Problems') steps.push('Discussed family-related concerns and offered understanding, support, and follow-up.');
  else if (cat === 'Financial Concerns') steps.push('Discussed money-related concerns and checked possible school support or referrals.');
  else if (cat === 'Personal/Emotional Issues') steps.push('Checked the student’s well-being and offered guidance or referral for emotional support.');
  else if (cat === 'Academic Difficulties') steps.push('Discussed school difficulties and planned support such as extra help, reminders, or teacher check-ins.');
  else if (cat === 'Transportation Issues') steps.push('Discussed travel problems and agreed on practical ways to come to school on time.');
  else if (cat === 'Bullying/Safety Concerns') steps.push('Checked safety concerns, reassured the student, and referred the concern to the proper school office for support.');
  else steps.push('Asked about possible reasons (health, family, travel, personal, or school concerns) and noted what the student shared.');
  if (severe) steps.push('Explained why regular attendance is important and set a clear plan to improve attendance.');
  steps.push('Informed/reminded that CARES or the proper school office can help if the problem continues, and scheduled a follow-up check.');
  return steps.join(' ');
}

export function generateInterventionSummary({ student, flags, causeCategory, causeDetails, actionTaken, interventionDate, recordedBy }) {
  const name = studentName(student || {});
  const no = student?.studentNo ? ` (${student.studentNo})` : '';
  const course = [student?.course, student?.yearLevel, student?.section].filter(Boolean).join(' · ');
  const trig = (flags?.triggers || []).map((t) => t.label);
  const totals = flags?.totals || {};
  const parts = [];
  parts.push(`Intervention Summary for ${name}${no}${course ? ` — ${course}` : ''}.`);
  if (interventionDate) parts.push(`Date of intervention: ${interventionDate}.`);
  if (trig.length) {
    parts.push(`Reason for intervention/flag: ${trig.join('; ')}.`);
  } else {
    parts.push('Reason for intervention/flag: attendance concern requiring follow-up.');
  }
  const statBits = [];
  if (Number.isFinite(totals.expected) && totals.expected > 0) statBits.push(`${totals.expected} expected event(s)`);
  if (Number.isFinite(totals.absent)) statBits.push(`${totals.absent} absence(s)`);
  if (Number.isFinite(totals.late)) statBits.push(`${totals.late} late(s)`);
  if (Number.isFinite(totals.streak) && totals.streak > 0) statBits.push(`${totals.streak} consecutive absence(s)`);
  if (Number.isFinite(totals.lateStreak) && totals.lateStreak > 0) statBits.push(`${totals.lateStreak} consecutive late(s)`);
  if (statBits.length) parts.push(`Attendance snapshot: ${statBits.join(', ')}.`);
  if (causeCategory || causeDetails) {
    const cause = [causeCategory || 'Unspecified cause', causeDetails].filter(Boolean).join(' — ');
    parts.push(`Identified/possible cause: ${cause}.`);
  }
  if (actionTaken) {
    parts.push(`Intervention/action taken (proof): ${actionTaken}`);
    if (!/[.!?]$/.test(String(actionTaken).trim())) parts[parts.length - 1] += '.';
  }
  parts.push('Recommended follow-up: continue monitoring attendance, coordinate with the student/guardian as needed, and refer to CARES/support services if concerns persist.');
  if (recordedBy) parts.push(`Recorded by: ${recordedBy}.`);
  parts.push('Note: This summary is system-generated from recorded attendance and intervention details to support documentation; verify student context before formal reporting.');
  return parts.join(' ');
}

async function latestInterventionMap(studentIds = []) {
  if (!studentIds.length) return new Map();
  const placeholders = studentIds.map(() => '?').join(',');
  const rows = await all(
    `SELECT i.*
     FROM student_interventions i
     WHERE i.student_id IN (${placeholders})
     ORDER BY i.intervention_date DESC, i.created_at DESC, i.id DESC`,
    studentIds
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.student_id)) {
      map.set(r.student_id, {
        id: r.id,
        interventionDate: r.intervention_date,
        causeCategory: r.cause_category || '',
        actionTaken: r.action_taken || '',
        summary: r.summary || '',
        status: r.status || 'recorded',
        createdAt: r.created_at,
      });
    }
  }
  return map;
}

export async function listFlaggedForIntervention({ search = '', course = '', user = null, programId = null } = {}) {
  const [model, overview] = await Promise.all([buildRiskModel({ user, programId }), buildOverview({ search, course, user, programId })]);
  const ovById = new Map((overview.students || []).map((s) => [s.id, s]));
  const ids = [];
  const base = [];
  for (const s of model.students || []) {
    if (RISK_EXEMPT_STATUSES.has(String(s.status || '').trim())) continue;
    const ov = ovById.get(s.id) || {};
    const flags = computeInterventionFlags(s.raw || {});
    const atRiskByRate = Number(ov.expected || s.raw?.total || 0) > 0 && Number(ov.rate || 0) < 75;
    if (!flags.flagged && !atRiskByRate) continue;
    if (!flags.flagged && atRiskByRate) {
      flags.flagged = true;
      flags.priority = 'Medium';
      flags.triggers.push({ code: 'low_rate', label: `Below 75% attendance (${ov.rate || 0}%)`, priority: 'Medium' });
    }
    ids.push(s.id);
    base.push({ s, ov, flags });
  }
  const latestMap = await latestInterventionMap(ids);
  const students = base.map(({ s, ov, flags }) => ({
    id: s.id,
    studentNo: s.studentNo,
    firstName: s.firstName,
    lastName: s.lastName,
    name: studentName(s),
    course: s.course || ov.course || '',
    yearLevel: s.yearLevel || ov.yearLevel || '',
    status: s.status || ov.status || 'Active',
    rate: Number(ov.rate || 0),
    attended: Number(ov.attended ?? s.raw?.attended ?? 0),
    expected: Number(ov.expected ?? s.raw?.total ?? 0),
    absent: Number(s.raw?.absent || 0),
    late: Number(s.raw?.late || 0),
    excused: Number(s.raw?.excused || 0),
    streak: Number(s.raw?.streak || 0),
    lateStreak: Number(s.raw?.lateStreak || 0),
    risk: s.risk,
    riskLevel: s.riskLevel,
    flags,
    latestIntervention: latestMap.get(s.id) || null,
  })).sort((a, b) => {
    const pr = { High: 3, Medium: 2, Low: 1 };
    return (pr[b.flags.priority] || 0) - (pr[a.flags.priority] || 0) || b.risk - a.risk || a.rate - b.rate;
  });
  return { students, causeCategories: CAUSE_CATEGORIES, rules: FLAG_RULES, generatedAt: new Date().toISOString() };
}

async function getScopedStudentBasic(studentId, user) {
  const scope = studentScopeFilter(user, { studentAlias: 's', programAlias: 'p_scope' });
  return get(
    `SELECT s.id, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName, s.course, s.year_level AS yearLevel, s.section, s.status,
            s.program_id AS programId, s.department_id AS departmentId
     FROM students s
     LEFT JOIN programs p ON p.id = s.program_id
     LEFT JOIN departments d ON d.id = COALESCE(s.department_id, p.department_id)
     ${scope.join}
     WHERE s.id = ? ${scope.where}`,
    [studentId, ...scope.params]
  );
}

export async function listInterventions(studentId, { user = null } = {}) {
  const student = await getScopedStudentBasic(studentId, user);
  if (!student) return null;
  const interventions = await all(
    `SELECT id, student_id AS studentId, intervention_date AS interventionDate, flagged_triggers AS flaggedTriggers,
            cause_category AS causeCategory, cause_details AS causeDetails, action_taken AS actionTaken,
            summary, status, created_by AS createdBy, created_by_name AS createdByName, created_at AS createdAt, updated_at AS updatedAt
     FROM student_interventions WHERE student_id = ? ORDER BY intervention_date DESC, created_at DESC, id DESC`,
    [studentId]
  );
  return { student, interventions };
}

export async function createIntervention({ studentId, interventionDate, causeCategory, causeDetails, actionTaken, status, flaggedTriggers }, user) {
  const student = await getScopedStudentBasic(studentId, user);
  if (!student) return { error: 'Student not found', status: 404 };
  const action = String(actionTaken || '').trim();
  if (!action) return { error: 'Please describe the intervention/action taken as proof.', status: 400 };
  const date = String(interventionDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const category = CAUSE_CATEGORIES.includes(String(causeCategory || '').trim()) ? String(causeCategory).trim() : (String(causeCategory || '').trim() || null);
  const details = String(causeDetails || '').trim() || null;

  // Compute flags for context/summary
  let flags = { triggers: [], totals: {} };
  try {
    const model = await buildRiskModel({ user });
    const r = model.byStudent.get(Number(studentId));
    if (r) flags = computeInterventionFlags(r.raw || {});
  } catch {
    // ignore
  }
  const triggersText = flaggedTriggers ? String(flaggedTriggers) : (flags.triggers || []).map((t) => t.label).join('; ');
  const recordedBy = user?.name || user?.username || 'Staff';
  const summary = generateInterventionSummary({
    student,
    flags,
    causeCategory: category,
    causeDetails: details,
    actionTaken: action,
    interventionDate: date,
    recordedBy,
  });

  const info = await run(
    `INSERT INTO student_interventions (student_id, intervention_date, flagged_triggers, cause_category, cause_details, action_taken, summary, status, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [student.id, date, triggersText || null, category, details, action, summary, String(status || 'recorded'), user?.id || null, recordedBy]
  );
  const row = await get(
    `SELECT id, student_id AS studentId, intervention_date AS interventionDate, flagged_triggers AS flaggedTriggers,
            cause_category AS causeCategory, cause_details AS causeDetails, action_taken AS actionTaken,
            summary, status, created_by AS createdBy, created_by_name AS createdByName, created_at AS createdAt, updated_at AS updatedAt
     FROM student_interventions WHERE id = ?`,
    [info.lastInsertRowid]
  );
  await logAudit({
    user,
    action: 'intervention.create',
    entity: 'student',
    entityId: String(student.id),
    detail: `${studentName(student)} · ${category || 'Cause unspecified'} · ${date}`,
  });
  return { intervention: row, summary };
}

export async function buildSummaryDraft(studentId, { causeCategory, causeDetails, actionTaken, interventionDate } = {}, user = null) {
  const student = await getScopedStudentBasic(studentId, user);
  if (!student) return null;
  let flags = { triggers: [], totals: {} };
  try {
    const model = await buildRiskModel({ user });
    const r = model.byStudent.get(Number(studentId));
    if (r) flags = computeInterventionFlags(r.raw || {});
  } catch {
    // ignore
  }
  const suggestedCauseDetails = suggestCauseDetails({ flags, causeCategory, student });
  const suggestedAction = suggestInterventionAction({ flags, causeCategory, student });
  const summary = generateInterventionSummary({
    student,
    flags,
    causeCategory,
    causeDetails: (causeDetails && String(causeDetails).trim()) ? causeDetails : suggestedCauseDetails,
    actionTaken: (actionTaken && String(actionTaken).trim()) ? actionTaken : suggestedAction,
    interventionDate: interventionDate || new Date().toISOString().slice(0, 10),
    recordedBy: 'Staff',
  });
  return { student, flags, summary, suggestedCauseDetails, suggestedAction, causeCategories: CAUSE_CATEGORIES };
}