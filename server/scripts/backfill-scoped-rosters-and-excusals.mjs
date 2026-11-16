#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load server env/config defaults when run from repo/server context.
process.chdir(path.resolve(__dirname, '..'));

const argv = process.argv.slice(2);
const args = new Set(argv);
const applyExcusals = args.has('--apply-excusals');
const applyRosters = args.has('--apply-rosters');
const applyStudentExclusions = args.has('--apply-student-exclusions');
const dryRun = !applyExcusals && !applyRosters && !applyStudentExclusions;

function getArgValue(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) return null;
  return v;
}

const onlyProgramId = Number(getArgValue('--program-id') || 0) || null;
const onlyDepartmentId = Number(getArgValue('--department-id') || 0) || null;
const eventDateBefore = getArgValue('--event-date-before'); // YYYY-MM-DD (exclude events on/after? before means strictly before date)
const eventDateOnOrBefore = getArgValue('--event-date-on-or-before'); // YYYY-MM-DD

function usage() {
  console.log(`Usage:
  node scripts/backfill-scoped-rosters-and-excusals.mjs [--apply-excusals] [--apply-rosters] [--apply-student-exclusions] [--program-id <id>] [--department-id <id>] [--event-date-on-or-before <YYYY-MM-DD>] [--event-date-before <YYYY-MM-DD>]

Default is dry-run (report only).
  --apply-excusals            Upsert excused attendance (note=status) for Deceased/Dropped/LOA attendees and refresh closed summaries.
  --apply-rosters             Exclude students not associated with scoped events (align legacy rosters to scope). Also removes their attendance rows for those events and refreshes closed summaries. Review carefully.
  --apply-student-exclusions  Exclude students matching --program-id/--department-id from events in scope of date filters where the event is NOT explicitly scoped to those same students; removes their attendance rows and refreshes closed summaries. Useful for newly added cohorts who should not be eligible for past/ineligible events.
  --program-id                Limit affected students to this program id (e.g. newly added Entrepreneurship students).
  --department-id             Limit affected students to this department/college id.
  --event-date-on-or-before   Only affect events with event_date <= date (recommended for past events).
  --event-date-before         Only affect events with event_date < date.
`);
}

if (args.has('--help') || args.has('-h')) {
  usage();
  process.exit(0);
}

const db = await import('../src/db.js');
const { all, get, run, batch } = db;
await db.initDb();

const NON_ATTENDING = new Set(['Deceased', 'Dropped', 'LOA']);

function studentMatchesEventScope(student, event) {
  const eventProg = Number(event.program_id || event.programId || 0);
  const eventDept = Number(event.department_id || event.departmentId || 0);
  const sProg = Number(student.program_id || student.programId || 0);
  const sDept = Number(student.department_id || student.departmentId || 0);
  const sProgDept = Number(student.programDepartmentId || 0);
  if (eventProg) return sProg === eventProg;
  if (eventDept) return sDept === eventDept || sProgDept === eventDept;
  return true; // unscoped event
}

async function reportAndApplyExcusals() {
  const students = await all(
    `SELECT id, student_no AS studentNo, first_name AS firstName, last_name AS lastName, status
     FROM students WHERE status IN ('Deceased','Dropped','LOA')`
  );
  if (!students.length) {
    console.log('[excusals] No Deceased/Dropped/LOA students found.');
    return { students: 0, events: 0, upserts: 0, summariesRefreshed: 0 };
  }

  const events = await all(`SELECT id, name, event_date AS eventDate, status, archived, closed_at AS closedAt, report_summary AS reportSummary FROM events`);
  const exclusions = await all(`SELECT event_id AS eventId, student_id AS studentId FROM event_exclusions`);
  const exByEvent = new Map();
  for (const r of exclusions) {
    if (!exByEvent.has(r.eventId)) exByEvent.set(r.eventId, new Set());
    exByEvent.get(r.eventId).add(r.studentId);
  }
  const attendance = await all(`SELECT id, event_id AS eventId, student_id AS studentId, status, note FROM attendance`);
  const attByKey = new Map(attendance.map((r) => [`${r.eventId}:${r.studentId}`, r]));

  let candidateUpserts = 0;
  let candidateEvents = new Set();
  const statementsByEvent = new Map();

  for (const ev of events) {
    const ex = exByEvent.get(ev.id) || new Set();
    const stmts = [];
    for (const s of students) {
      if (ex.has(s.id)) continue; // not on attendee list
      const key = `${ev.id}:${s.id}`;
      const existing = attByKey.get(key);
      const reason = s.status;
      if (!existing) {
        candidateUpserts += 1;
        candidateEvents.add(ev.id);
        stmts.push({ sql: `INSERT INTO attendance (event_id, student_id, status, method, note) VALUES (?, ?, 'excused', 'auto', ?)`, args: [ev.id, s.id, reason] });
      } else if (String(existing.status) !== 'excused' || String(existing.note || '') !== reason) {
        candidateUpserts += 1;
        candidateEvents.add(ev.id);
        stmts.push({ sql: `UPDATE attendance SET status = 'excused', method = 'auto', note = ? WHERE id = ?`, args: [reason, existing.id] });
      }
    }
    if (stmts.length) statementsByEvent.set(ev.id, stmts);
  }

  console.log(`[excusals] students=${students.length} eventsTouched=${candidateEvents.size} attendanceUpserts=${candidateUpserts} mode=${dryRun ? 'dry-run' : (applyExcusals ? 'apply' : 'skip')}`);
  if (!applyExcusals) return { students: students.length, events: candidateEvents.size, upserts: candidateUpserts, summariesRefreshed: 0 };

  for (const stmts of statementsByEvent.values()) {
    if (stmts.length) await batch(stmts, 'write');
  }

  // Refresh closed event summaries that were touched.
  let summariesRefreshed = 0;
  const { refreshClosedSummary } = await import('../src/services/eventSummary.js');
  for (const eventId of candidateEvents) {
    const ev = await get(`SELECT status, report_summary AS reportSummary FROM events WHERE id = ?`, [eventId]);
    if (ev && ev.status === 'closed' && ev.reportSummary) {
      await refreshClosedSummary(eventId);
      summariesRefreshed += 1;
    }
  }
  console.log(`[excusals] applied upserts=${candidateUpserts}, refreshedSummaries=${summariesRefreshed}`);
  return { students: students.length, events: candidateEvents.size, upserts: candidateUpserts, summariesRefreshed };
}

async function reportAndApplyRosters() {
  const scopedEvents = await all(
    `SELECT id, name, department_id, program_id, event_date AS eventDate, status, report_summary AS reportSummary
     FROM events
     WHERE (department_id IS NOT NULL OR program_id IS NOT NULL)
     ORDER BY event_date DESC, id DESC`
  );
  if (!scopedEvents.length) {
    console.log('[rosters] No scoped events found.');
    return { events: 0, exclusionsToAdd: 0, attendanceDeleted: 0, summariesRefreshed: 0 };
  }

  const eventFiltered = scopedEvents.filter((ev) => {
    const d = String(ev.eventDate || '').slice(0, 10);
    if (eventDateOnOrBefore && d > eventDateOnOrBefore) return false;
    if (eventDateBefore && d >= eventDateBefore) return false;
    return true;
  });

  const students = await all(
    `SELECT s.id, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
            s.department_id, s.program_id, p.department_id AS programDepartmentId, s.course
     FROM students s
     LEFT JOIN programs p ON p.id = s.program_id`
  );
  const filteredStudents = students.filter((s) => {
    if (onlyProgramId && Number(s.program_id || 0) !== Number(onlyProgramId)) return false;
    if (onlyDepartmentId) {
      const sDept = Number(s.department_id || 0);
      const sProgDept = Number(s.programDepartmentId || 0);
      if (sDept !== Number(onlyDepartmentId) && sProgDept !== Number(onlyDepartmentId)) return false;
    }
    return true;
  });

  if (!filteredStudents.length) {
    console.log('[rosters] No matching students found for the provided filters.');
    return { events: 0, exclusionsToAdd: 0, attendanceDeleted: 0, summariesRefreshed: 0 };
  }

  const exclusions = await all(`SELECT event_id AS eventId, student_id AS studentId FROM event_exclusions`);
  const exByEvent = new Map();
  for (const r of exclusions) {
    if (!exByEvent.has(r.eventId)) exByEvent.set(r.eventId, new Set());
    exByEvent.get(r.eventId).add(r.studentId);
  }

  let totalToAdd = 0;
  const plan = [];
  for (const ev of eventFiltered) {
    const ex = exByEvent.get(ev.id) || new Set();
    const missing = [];
    for (const s of filteredStudents) {
      if (ex.has(s.id)) continue;
      if (!studentMatchesEventScope(s, ev)) missing.push(s.id);
    }
    if (missing.length) {
      totalToAdd += missing.length;
      plan.push({ eventId: ev.id, name: ev.name, eventDate: ev.eventDate, status: ev.status, reportSummary: ev.reportSummary, count: missing.length, studentIds: missing });
    }
  }

  console.log(`[rosters] scopedEvents=${scopedEvents.length} eventsConsidered=${eventFiltered.length} matchingStudents=${filteredStudents.length} eventsNeedingExclusions=${plan.length} exclusionsToAdd=${totalToAdd} mode=${dryRun ? 'dry-run' : (applyRosters ? 'apply' : 'skip')}`);
  if (onlyProgramId || onlyDepartmentId || eventDateBefore || eventDateOnOrBefore) {
    console.log(`[rosters] filters programId=${onlyProgramId || '—'} departmentId=${onlyDepartmentId || '—'} eventDateOnOrBefore=${eventDateOnOrBefore || '—'} eventDateBefore=${eventDateBefore || '—'}`);
  }
  for (const p of plan.slice(0, 20)) {
    console.log(`  - event ${p.eventId} "${p.name}" (${p.eventDate || 'no-date'}): +${p.count} exclusions`);
  }
  if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more events`);

  if (!applyRosters) return { events: plan.length, exclusionsToAdd: totalToAdd, attendanceDeleted: 0, summariesRefreshed: 0 };

  let attendanceDeleted = 0;
  let summariesRefreshed = 0;
  const { refreshClosedSummary } = await import('../src/services/eventSummary.js');

  for (const p of plan) {
    const stmts = [];
    for (const sid of p.studentIds) {
      stmts.push({ sql: `INSERT OR IGNORE INTO event_exclusions (event_id, student_id, excluded_by) VALUES (?, ?, NULL)`, args: [p.eventId, sid] });
      // Remove any attendance records (including auto-absent rows from closed events)
      // so excluded students no longer appear as absent/attended in that event.
      stmts.push({ sql: `DELETE FROM attendance WHERE event_id = ? AND student_id = ?`, args: [p.eventId, sid] });
    }
    // batch in smaller chunks
    for (let i = 0; i < stmts.length; i += 800) {
      const chunk = stmts.slice(i, i + 800);
      const before = chunk.length / 2; // approximate pairs
      await batch(chunk, 'write');
      // can't easily know exact deleted rows per statement in batch; estimate by inserted exclusions? we'll compute below
    }
    attendanceDeleted += p.count; // upper-bound estimate (rows may or may not have existed)

    const evNow = await get(`SELECT status, report_summary AS reportSummary FROM events WHERE id = ?`, [p.eventId]);
    if (evNow && evNow.status === 'closed' && evNow.reportSummary) {
      await refreshClosedSummary(p.eventId);
      summariesRefreshed += 1;
    }
  }

  console.log(`[rosters] applied exclusions=${totalToAdd} across events=${plan.length}, summariesRefreshed=${summariesRefreshed} (attendance rows for excluded students were removed)`);
  return { events: plan.length, exclusionsToAdd: totalToAdd, attendanceDeleted, summariesRefreshed };
}

console.log(`Backfill check starting (${dryRun ? 'DRY RUN' : 'APPLY MODE'})`);
const exc = await reportAndApplyExcusals();
const ros = await reportAndApplyRosters();
const stu = applyStudentExclusions ? await reportAndApplyStudentExclusions() : (dryRun && (onlyProgramId || onlyDepartmentId) ? await reportAndApplyStudentExclusions() : { skipped: true });
console.log('Done.', { excusals: exc, rosters: ros, studentExclusions: stu });
if (dryRun) {
  console.log('No changes applied. Re-run with --apply-excusals, --apply-rosters, and/or --apply-student-exclusions after review.');
}
process.exit(0);
