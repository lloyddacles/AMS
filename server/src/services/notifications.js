import { get, all, run } from '../db.js';
import { buildAtRisk, buildCompliance } from './reports.js';
import { featureLabel } from './risk.js';
import { cachedSettings } from './settings.js';
import { todayInTz, eventStart, eventEnd } from '../classify.js';

// Which audiences a given role may see. 'all' notifications are visible to everyone.
export function audiencesFor(role) {
  if (role === 'admin') return ['all', 'admin'];
  if (role === 'staff') return ['all', 'staff'];
  return ['all'];
}

function normalizeScopeId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function notificationScopeFilter(user) {
  // Admins and unassigned staff see all notifications in their audiences.
  if (!user || user.role === 'admin') return { where: '', params: [] };
  const departmentId = normalizeScopeId(user.departmentId);
  const programId = normalizeScopeId(user.programId);
  if (!departmentId && !programId) return { where: '', params: [] };
  // Scoped staff: global/unscoped notifications + notifications matching their scope.
  if (programId) {
    return {
      where: ' AND ( (n.department_id IS NULL AND n.program_id IS NULL) OR n.program_id = ? OR (n.program_id IS NULL AND n.department_id = ?) )',
      params: [programId, departmentId],
    };
  }
  return {
    where: ' AND ( (n.department_id IS NULL AND n.program_id IS NULL) OR n.department_id = ? )',
    params: [departmentId],
  };
}

// Insert a notification. With a dedupe_key, repeated calls collapse to one row.
// Returns true when a new row was written. `data` is an optional structured
// payload (stored as JSON) that lets the UI render a friendlier layout.
export async function createNotification({ type, title, body = null, severity = 'info', audience = 'all', link = null, dedupeKey = null, data = null, departmentId = null, programId = null }) {
  const dataJson = data == null ? null : JSON.stringify(data);
  const deptId = normalizeScopeId(departmentId);
  const progId = normalizeScopeId(programId);
  if (dedupeKey) {
    const info = await run(
      `INSERT OR IGNORE INTO notifications (type, title, body, severity, audience, link, data, dedupe_key, department_id, program_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [type, title, body, severity, audience, link, dataJson, dedupeKey, deptId, progId]
    );
    return info.changes > 0;
  }
  await run(
    `INSERT INTO notifications (type, title, body, severity, audience, link, data, department_id, program_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [type, title, body, severity, audience, link, dataJson, deptId, progId]
  );
  return true;
}

function parseData(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function listNotifications(user, { limit = 30, unreadOnly = false } = {}) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const scope = notificationScopeFilter(user);
  const args = [user.id, ...aud, ...scope.params];
  let sql = `SELECT n.id, n.type, n.title, n.body, n.severity, n.audience, n.link, n.data,
                    n.department_id AS departmentId, n.program_id AS programId,
                    n.created_at AS createdAt, (r.read_at IS NOT NULL) AS isRead
             FROM notifications n
             LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
             WHERE n.audience IN (${placeholders}) ${scope.where}`;
  if (unreadOnly) sql += ' AND r.read_at IS NULL';
  sql += ' ORDER BY n.created_at DESC, n.id DESC LIMIT ?';
  args.push(limit);
  const rows = await all(sql, args);
  return rows.map((r) => ({ ...r, isRead: Number(r.isRead) ? true : false, data: parseData(r.data) }));
}

export async function unreadCount(user) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const scope = notificationScopeFilter(user);
  const row = await get(
    `SELECT COUNT(*) AS c FROM notifications n
     LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
     WHERE n.audience IN (${placeholders}) ${scope.where} AND r.read_at IS NULL`,
    [user.id, ...aud, ...scope.params]
  );
  return row?.c ?? 0;
}

export async function markRead(user, id) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const scope = notificationScopeFilter(user);
  const n = await get(
    `SELECT id FROM notifications n WHERE n.id = ? AND n.audience IN (${placeholders}) ${scope.where}`,
    [id, ...aud, ...scope.params]
  );
  if (!n) return { ok: false, status: 404, error: 'Notification not found' };
  await run('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)', [id, user.id]);
  return { ok: true };
}

export async function markAllRead(user) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const scope = notificationScopeFilter(user);
  await run(
    `INSERT OR IGNORE INTO notification_reads (notification_id, user_id)
     SELECT n.id, ? FROM notifications n
     WHERE n.audience IN (${placeholders}) ${scope.where}
       AND n.id NOT IN (SELECT notification_id FROM notification_reads WHERE user_id = ?)`,
    [user.id, ...aud, ...scope.params, user.id]
  );
  return { ok: true };
}

// ---- Event lifecycle notifications ----

const evtDate = (e) => e.eventDate || e.event_date;
const evtStart = (e) => e.startTime || e.start_time;
const evtDept = (e) => e?.departmentId ?? e?.department_id ?? null;
const evtProg = (e) => e?.programId ?? e?.program_id ?? null;

export async function notifyEventOpened(event) {
  if (!event) return false;
  const time = evtStart(event);
  const where = event.location ? ` at ${event.location}` : '';
  return createNotification({
    type: 'event-opened',
    title: `Event opened: ${event.name}`,
    body: `${evtDate(event) || ''}${time ? ` · ${time}` : ''}${where}`,
    severity: 'info',
    audience: 'all',
    link: `/events/${event.id}`,
    dedupeKey: `event-opened:${event.id}`,
    departmentId: evtDept(event),
    programId: evtProg(event),
  });
}

export async function notifyEventClosed(event, summary) {
  if (!event) return false;
  const s = summary || {};
  const rate = s.rate ?? 0;
  return createNotification({
    type: 'event-closed',
    title: `Event closed: ${event.name}`,
    body: `Attended ${s.attended ?? 0}/${s.totalStudents ?? 0} (${rate}%).`,
    severity: rate < 50 ? 'warning' : 'info',
    audience: 'all',
    link: `/events/${event.id}`,
    dedupeKey: `event-closed:${event.id}`,
    departmentId: evtDept(event),
    programId: evtProg(event),
  });
}

export async function notifyEventReopened(event) {
  if (!event) return false;
  return createNotification({
    type: 'event-reopened',
    title: `Event reopened: ${event.name}`,
    body: 'Corrections are now allowed for this event.',
    severity: 'info',
    audience: 'all',
    link: `/events/${event.id}`,
    departmentId: evtDept(event),
    programId: evtProg(event),
  });
}

// ---- Correction requests (student self-service) ----

export async function notifyCorrectionRequested(correction, event, student) {
  if (!correction || !event || !student) return false;
  const reason = String(correction.reason || '').slice(0, 90);
  const suffix = reason ? ` · "${reason}${reason.length >= 90 ? '…' : ''}"` : '';
  const deptId = student.department_id ?? student.departmentId ?? null;
  const progId = student.program_id ?? student.programId ?? null;
  return createNotification({
    type: 'correction-requested',
    title: `Correction requested: ${student.first_name ?? student.firstName ?? ''} ${student.last_name ?? student.lastName ?? ''}`.trim(),
    body: `${event.name} · wants ${correction.requestedStatus ?? correction.requested_status}${suffix}`,
    severity: 'info',
    audience: 'all',
    link: '/corrections/review',
    dedupeKey: `correction-requested:${correction.id}`,
    departmentId: deptId,
    programId: progId,
  });
}

// ---- Background checks (run lazily while the app is in use) ----

function dateInTzOffset(days, base = new Date()) {
  return todayInTz(new Date(base.getTime() - days * 86400000));
}

function studentScopeKey(student) {
  const programId = normalizeScopeId(student.programId ?? student.program_id);
  const departmentId = normalizeScopeId(student.departmentId ?? student.department_id);
  if (programId) return `prog:${programId}`;
  if (departmentId) return `dept:${departmentId}`;
  return 'unscoped';
}

function scopeMetaFromKey(key, sample) {
  if (key.startsWith('prog:')) {
    return { departmentId: normalizeScopeId(sample?.departmentId ?? sample?.department_id), programId: Number(key.slice(5)) };
  }
  if (key.startsWith('dept:')) {
    return { departmentId: Number(key.slice(5)), programId: null };
  }
  return { departmentId: null, programId: null };
}

function scopeLabel(scope) {
  if (scope?.programId) return 'program';
  if (scope?.departmentId) return 'department';
  return 'unassigned scope';
}

// One aggregated alert per day when students fall below the attendance
// threshold. Student-related notifications are generated per department/program
// scope so scoped staff only see students from their own scope.
export async function evaluateAtRisk() {
  const { threshold, students } = await buildAtRisk({});
  if (!students.length) return false;

  const groups = new Map();
  for (const s of students) {
    const key = studentScopeKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  let created = false;
  for (const [key, list] of groups.entries()) {
    const scope = scopeMetaFromKey(key, list[0]);
    // Unscoped-student notifications: visible to admins and unrestricted staff.
    // Scoped staff cannot see these (no matching scope, and null-scope student
    // alerts are treated as admin-only to avoid leaking across departments).
    const isUnscoped = key === 'unscoped';
    const audience = isUnscoped ? 'admin' : 'all';

    const scored = list.filter((s) => typeof s.risk === 'number');
    const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.risk, 0) / scored.length) : null;
    const worst = scored.reduce((m, s) => (s.risk > m ? s.risk : m), 0);

    const importance = new Map();
    for (const s of scored) {
      for (const d of s.drivers || []) {
        importance.set(d.key, (importance.get(d.key) || 0) + Math.abs(d.contribution));
      }
    }
    const topDrivers = [...importance.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => featureLabel(k));

    const count = list.length;
    const noun = count === 1 ? 'student is' : 'students are';
    const reasons = topDrivers.length ? ` Mainly due to ${topDrivers.join(', ').toLowerCase()}.` : '';
    const body = `${count} ${noun} below ${threshold}% attendance${avg != null ? ` (avg risk ${avg}%)` : ''}.${reasons}`;

    const data = {
      kind: 'at-risk',
      threshold,
      count,
      averageRisk: avg,
      drivers: topDrivers,
      scope: key,
      students: scored
        .slice()
        .sort((a, b) => b.risk - a.risk)
        .slice(0, 5)
        .map((s) => ({
          id: s.id,
          name: `${s.lastName}, ${s.firstName}`,
          studentNo: s.studentNo,
          risk: s.risk,
          riskLevel: s.riskLevel,
          departmentId: s.departmentId || null,
          programId: s.programId || null,
          departmentName: s.departmentName || null,
          programName: s.programName || null,
        })),
      more: Math.max(0, scored.length - 5),
    };

    const scopePart = isUnscoped ? 'unscoped' : `d${scope.departmentId || 0}-p${scope.programId || 0}`;
    const ok = await createNotification({
      type: 'at-risk',
      title: `Attendance risk: ${count} student${count === 1 ? '' : 's'} below ${threshold}%`,
      body,
      severity: worst >= 75 ? 'critical' : 'warning',
      audience,
      link: '/reports',
      dedupeKey: `at-risk:${todayInTz()}:${scopePart}`,
      data,
      departmentId: isUnscoped ? null : scope.departmentId,
      programId: isUnscoped ? null : scope.programId,
    });
    created = created || ok;
  }
  return created;
}

// Alert once a day when students fall below their current term's minimum
// attendance percentage. Generated per scope so student-related details are
// only visible to staff in the same department/program.
export async function evaluateCompliance() {
  const term = await get(
    'SELECT id, name, min_attendance AS minAttendance FROM terms WHERE is_current = 1 LIMIT 1'
  );
  if (!term) return false;

  const { minimum, totalEvents, students } = await buildCompliance({ termId: term.id });
  if (!students.length) return false;

  const groups = new Map();
  for (const s of students) {
    const key = studentScopeKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  let created = false;
  for (const [key, list] of groups.entries()) {
    const scope = scopeMetaFromKey(key, list[0]);
    const isUnscoped = key === 'unscoped';
    const audience = isUnscoped ? 'admin' : 'all';
    const count = list.length;
    const noun = count === 1 ? 'student is' : 'students are';
    const body = `${count} ${noun} below ${minimum}% for ${term.name} (${totalEvents} event${totalEvents === 1 ? '' : 's'}).`;
    const data = {
      kind: 'compliance',
      termId: term.id,
      termName: term.name,
      minimum,
      count,
      totalStudents: count,
      totalEvents,
      scope: key,
      students: list.slice(0, 5).map((s) => ({
        id: s.id,
        name: `${s.lastName}, ${s.firstName}`,
        studentNo: s.studentNo,
        rate: s.rate,
        needed: s.needed,
        departmentId: s.departmentId || null,
        programId: s.programId || null,
        departmentName: s.departmentName || null,
        programName: s.programName || null,
      })),
      more: Math.max(0, count - 5),
    };
    const scopePart = isUnscoped ? 'unscoped' : `d${scope.departmentId || 0}-p${scope.programId || 0}`;
    const ok = await createNotification({
      type: 'compliance',
      title: `Below minimum: ${count} student${count === 1 ? '' : 's'} under ${minimum}%`,
      body,
      severity: count >= 10 ? 'critical' : 'warning',
      audience,
      link: '/reports?view=compliance',
      dedupeKey: `compliance:${term.id}:${todayInTz()}:${scopePart}`,
      data,
      departmentId: isUnscoped ? null : scope.departmentId,
      programId: isUnscoped ? null : scope.programId,
    });
    created = created || ok;
  }
  return created;
}

// Alert once per active event when very few students have checked in after it starts.
export async function evaluateLowCheckins() {
  const { lowCheckinRate, lowCheckinGraceMin } = cachedSettings();
  const date = todayInTz();
  const events = await all(
    `SELECT id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime, status,
            department_id AS departmentId, program_id AS programId
     FROM events WHERE event_date = ? AND status = 'active'`,
    [date]
  );
  if (!events.length) return false;
  const hasStudents = (await get('SELECT COUNT(*) AS c FROM students')).c;
  if (!hasStudents) return false;
  const now = new Date();
  let created = false;
  for (const e of events) {
    if (!e.startTime) continue;
    const start = eventStart(e);
    if (!start) continue;
    const sinceMin = (now.getTime() - start.getTime()) / 60000;
    if (sinceMin < lowCheckinGraceMin) continue;
    // Only events that actually have an end can be "over"; a missing end time
    // makes eventEnd() resolve to midnight, which would always skip here.
    const end = e.endTime ? eventEnd(e) : null;
    if (end && now > end) continue;
    // Attendee list size for this event (everyone minus the excluded).
    const total = (
      await get(
        `SELECT (SELECT COUNT(*) FROM students) - (SELECT COUNT(*) FROM event_exclusions WHERE event_id = ?) AS c`,
        [e.id]
      )
    ).c;
    if (!total) continue;
    const attended = (
      await get(
        `SELECT COUNT(*) AS c FROM attendance WHERE event_id = ? AND status IN ('early','on-time','late','present')`,
        [e.id]
      )
    ).c;
    const rate = Math.round((attended / total) * 100);
    if (rate >= lowCheckinRate) continue;
    const ok = await createNotification({
      type: 'low-checkin',
      title: `Low check-in: ${e.name}`,
      body: `Only ${attended}/${total} (${rate}%) checked in, ${Math.round(sinceMin)} min after start.`,
      severity: 'warning',
      audience: 'all',
      link: `/events/${e.id}`,
      dedupeKey: `low-checkin:${e.id}`,
      departmentId: e.departmentId,
      programId: e.programId,
    });
    created = created || ok;
  }
  return created;
}

// A once-a-day digest summarizing the previous day's events.
export async function generateDailySummary() {
  const day = dateInTzOffset(1);
  const key = `daily-summary:${day}`;
  const existing = await get('SELECT id FROM notifications WHERE dedupe_key = ?', [key]);
  if (existing) return false;
  const events = await all('SELECT id, name, report_summary AS reportSummary FROM events WHERE event_date = ?', [day]);
  if (!events.length) return false;
  if (!(await get('SELECT COUNT(*) AS c FROM students')).c) return false;
  let attended = 0;
  let expected = 0;
  const lines = [];
  for (const e of events) {
    let summary = null;
    if (e.reportSummary) {
      try {
        summary = JSON.parse(e.reportSummary);
      } catch {
        summary = null;
      }
    }
    // Attendee list for the event: the closed summary's numbers when available,
    // otherwise the live roster size.
    const roster = summary && Number.isFinite(summary.totalStudents)
      ? summary.totalStudents
      : (
          await get(
            `SELECT (SELECT COUNT(*) FROM students) - (SELECT COUNT(*) FROM event_exclusions WHERE event_id = ?) AS c`,
            [e.id]
          )
        ).c;
    const a = summary && Number.isFinite(summary.attended)
      ? summary.attended
      : (
          await get(
            `SELECT COUNT(*) AS c FROM attendance WHERE event_id = ? AND status IN ('early','on-time','late','present')`,
            [e.id]
          )
        ).c;
    attended += a;
    expected += roster;
    lines.push(`${e.name}: ${a}/${roster}`);
  }
  const total = expected;
  const rate = total ? Math.round((attended / total) * 100) : 0;
  const body = `${events.length} event(s) · attended ${attended}/${total} (${rate}%)\n${lines.slice(0, 5).join('\n')}`;
  return createNotification({
    type: 'daily-summary',
    title: `Daily summary — ${day}`,
    body,
    severity: 'info',
    audience: 'all',
    link: '/reports',
    dedupeKey: key,
  });
}

// Run every lazy generator, isolating failures so one never blocks a request.
// The at-risk scan reads the whole attendance table, so it is throttled to at
// most once a minute per instance.
let lastAtRiskRun = 0;
const AT_RISK_INTERVAL_MS = 60000;

export async function runBackgroundChecks() {
  for (const fn of [evaluateLowCheckins, generateDailySummary]) {
    try {
      await fn();
    } catch (err) {
      console.error('notification check failed:', err);
    }
  }
  if (Date.now() - lastAtRiskRun >= AT_RISK_INTERVAL_MS) {
    lastAtRiskRun = Date.now();
    for (const fn of [evaluateAtRisk, evaluateCompliance]) {
      try {
        await fn();
      } catch (err) {
        console.error('notification check failed:', err);
      }
    }
  }
}
