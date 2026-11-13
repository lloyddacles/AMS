#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load server env/config defaults when run from repo/server context.
process.chdir(path.resolve(__dirname, '..'));

const args = new Set(process.argv.slice(2));
const applyExcusals = args.has('--apply-excusals');
const applyRosters = args.has('--apply-rosters');
const dryRun = !applyExcusals && !applyRosters;

function usage() {
  console.log(`Usage:
  node scripts/backfill-scoped-rosters-and-excusals.mjs [--apply-excusals] [--apply-rosters]

Default is dry-run (report only).
  --apply-excusals  Upsert excused attendance (note=status) for Deceased/Dropped/LOA attendees and refresh closed summaries.
  --apply-rosters   Exclude students not associated with scoped events (align legacy rosters to scope). Review carefully.
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
    `SELECT id, name, department_id, program_id, event_date AS eventDate
     FROM events
     WHERE department_id IS NOT NULL OR program_id IS NOT NULL
     ORDER BY event_date DESC, id DESC`
  );
  if (!scopedEvents.length) {
    console.log('[rosters] No scoped events found.');
    return { events: 0, exclusionsToAdd: 0 };
  }

  const students = await all(
    `SELECT s.id, s.student_no AS studentNo, s.department_id, s.program_id,
            p.department_id AS programDepartmentId
     FROM students s
     LEFT JOIN programs p ON p.id = s.program_id`
  );
  const exclusions = await all(`SELECT event_id AS eventId, student_id AS studentId FROM event_exclusions`);
  const exByEvent = new Map();
  for (const r of exclusions) {
    if (!exByEvent.has(r.eventId)) exByEvent.set(r.eventId, new Set());
    exByEvent.get(r.eventId).add(r.studentId);
  }

  let totalToAdd = 0;
  const plan = [];
  for (const ev of scopedEvents) {
    const ex = exByEvent.get(ev.id) || new Set();
    const missing = [];
    for (const s of students) {
      if (ex.has(s.id)) continue;
      if (!studentMatchesEventScope(s, ev)) missing.push(s.id);
    }
    if (missing.length) {
      totalToAdd += missing.length;
      plan.push({ eventId: ev.id, name: ev.name, count: missing.length, studentIds: missing });
    }
  }

  console.log(`[rosters] scopedEvents=${scopedEvents.length} eventsNeedingExclusions=${plan.length} exclusionsToAdd=${totalToAdd} mode=${dryRun ? 'dry-run' : (applyRosters ? 'apply' : 'skip')}`);
  for (const p of plan.slice(0, 20)) {
    console.log(`  - event ${p.eventId} "${p.name}": +${p.count} exclusions`);
  }
  if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more events`);

  if (!applyRosters) return { events: plan.length, exclusionsToAdd: totalToAdd };

  // Apply in chunks to avoid huge batches.
  for (const p of plan) {
    const stmts = p.studentIds.map((sid) => ({
      sql: `INSERT OR IGNORE INTO event_exclusions (event_id, student_id, excluded_by) VALUES (?, ?, NULL)`,
      args: [p.eventId, sid],
    }));
    if (stmts.length) await batch(stmts, 'write');
  }
  console.log(`[rosters] applied exclusions=${totalToAdd} across events=${plan.length}`);
  return { events: plan.length, exclusionsToAdd: totalToAdd };
}

console.log(`Backfill check starting (${dryRun ? 'DRY RUN' : 'APPLY MODE'})`);
const exc = await reportAndApplyExcusals();
const ros = await reportAndApplyRosters();
console.log('Done.', { excusals: exc, rosters: ros });
if (dryRun) {
  console.log('No changes applied. Re-run with --apply-excusals and/or --apply-rosters after review.');
}
process.exit(0);
