import { get, all, run } from '../db.js';
import { buildAtRisk } from './reports.js';
import { featureLabel } from './risk.js';
import { todayInTz, eventStart, eventEnd } from '../classify.js';

// A check-in rate below this (once an event has started) raises a low-check-in alert.
const LOW_CHECKIN_RATE = 50;
// Only alert after the event has been running this many minutes.
const LOW_CHECKIN_GRACE_MIN = 15;

// Which audiences a given role may see. 'all' notifications are visible to everyone.
export function audiencesFor(role) {
  if (role === 'admin') return ['all', 'admin'];
  if (role === 'staff') return ['all', 'staff'];
  return ['all'];
}

// Insert a notification. With a dedupe_key, repeated calls collapse to one row.
// Returns true when a new row was written.
export async function createNotification({ type, title, body = null, severity = 'info', audience = 'all', link = null, dedupeKey = null }) {
  if (dedupeKey) {
    const info = await run(
      `INSERT OR IGNORE INTO notifications (type, title, body, severity, audience, link, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [type, title, body, severity, audience, link, dedupeKey]
    );
    return info.changes > 0;
  }
  await run(
    `INSERT INTO notifications (type, title, body, severity, audience, link)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [type, title, body, severity, audience, link]
  );
  return true;
}

export async function listNotifications(user, { limit = 30, unreadOnly = false } = {}) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const args = [user.id, ...aud];
  let sql = `SELECT n.id, n.type, n.title, n.body, n.severity, n.audience, n.link,
                    n.created_at AS createdAt, (r.read_at IS NOT NULL) AS isRead
             FROM notifications n
             LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
             WHERE n.audience IN (${placeholders})`;
  if (unreadOnly) sql += ' AND r.read_at IS NULL';
  sql += ' ORDER BY n.created_at DESC, n.id DESC LIMIT ?';
  args.push(limit);
  const rows = await all(sql, args);
  return rows.map((r) => ({ ...r, isRead: Number(r.isRead) ? true : false }));
}

export async function unreadCount(user) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const row = await get(
    `SELECT COUNT(*) AS c FROM notifications n
     LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
     WHERE n.audience IN (${placeholders}) AND r.read_at IS NULL`,
    [user.id, ...aud]
  );
  return row?.c ?? 0;
}

export async function markRead(user, id) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  const n = await get(`SELECT id FROM notifications WHERE id = ? AND audience IN (${placeholders})`, [id, ...aud]);
  if (!n) return { ok: false, status: 404, error: 'Notification not found' };
  await run('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)', [id, user.id]);
  return { ok: true };
}

export async function markAllRead(user) {
  const aud = audiencesFor(user?.role);
  const placeholders = aud.map(() => '?').join(', ');
  await run(
    `INSERT OR IGNORE INTO notification_reads (notification_id, user_id)
     SELECT id, ? FROM notifications
     WHERE audience IN (${placeholders})
       AND id NOT IN (SELECT notification_id FROM notification_reads WHERE user_id = ?)`,
    [user.id, ...aud, user.id]
  );
  return { ok: true };
}

// ---- Event lifecycle notifications ----

const evtDate = (e) => e.eventDate || e.event_date;
const evtStart = (e) => e.startTime || e.start_time;

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
  });
}

// ---- Background checks (run lazily while the app is in use) ----

function dateInTzOffset(days, base = new Date()) {
  return todayInTz(new Date(base.getTime() - days * 86400000));
}

// One aggregated alert per day when students fall below the attendance
// threshold. The body summarizes each non-compliant student's explainable risk
// score (logistic model with exact SHAP) and the group's top risk drivers.
export async function evaluateAtRisk() {
  const { threshold, students } = await buildAtRisk({});
  if (!students.length) return false;

  const scored = students.filter((s) => typeof s.risk === 'number');
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.risk, 0) / scored.length) : null;
  const worst = scored.reduce((m, s) => (s.risk > m ? s.risk : m), 0);

  // Group-level driver importance: mean |SHAP contribution| per feature.
  const importance = new Map();
  for (const s of scored) {
    for (const d of s.drivers || []) {
      importance.set(d.key, (importance.get(d.key) || 0) + Math.abs(d.contribution));
    }
  }
  const topDrivers = [...importance.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => featureLabel(key));

  const lines = [];
  if (avg != null) lines.push(`Explainable risk (logistic SHAP) · average ${avg}%`);
  if (topDrivers.length) lines.push(`Group drivers: ${topDrivers.join(', ')}`);
  for (const s of scored.slice(0, 5)) {
    const top = (s.drivers || [])[0];
    lines.push(`${s.lastName}, ${s.firstName} — ${s.risk}% risk${top ? ` · top factor: ${top.label.toLowerCase()}` : ''}`);
  }
  const unscored = students.length - scored.length;
  if (unscored > 0) lines.push(`+${unscored} more without a score`);

  return createNotification({
    type: 'at-risk',
    title: `Attendance risk: ${students.length} student(s) below ${threshold}%`,
    body: lines.join('\n'),
    severity: worst >= 75 ? 'critical' : 'warning',
    audience: 'all',
    link: '/reports',
    dedupeKey: `at-risk:${todayInTz()}`,
  });
}

// Alert once per active event when very few students have checked in after it starts.
export async function evaluateLowCheckins() {
  const date = todayInTz();
  const events = await all(
    `SELECT id, name, event_date AS eventDate, start_time AS startTime, end_time AS endTime, status
     FROM events WHERE event_date = ? AND status = 'active'`,
    [date]
  );
  if (!events.length) return false;
  const total = (await get('SELECT COUNT(*) AS c FROM students')).c;
  if (!total) return false;
  const now = new Date();
  let created = false;
  for (const e of events) {
    if (!e.startTime) continue;
    const start = eventStart(e);
    if (!start) continue;
    const sinceMin = (now.getTime() - start.getTime()) / 60000;
    if (sinceMin < LOW_CHECKIN_GRACE_MIN) continue;
    const end = eventEnd(e);
    if (end && now > end) continue;
    const attended = (
      await get(
        `SELECT COUNT(*) AS c FROM attendance WHERE event_id = ? AND status IN ('early','on-time','late','present')`,
        [e.id]
      )
    ).c;
    const rate = Math.round((attended / total) * 100);
    if (rate >= LOW_CHECKIN_RATE) continue;
    const ok = await createNotification({
      type: 'low-checkin',
      title: `Low check-in: ${e.name}`,
      body: `Only ${attended}/${total} (${rate}%) checked in, ${Math.round(sinceMin)} min after start.`,
      severity: 'warning',
      audience: 'all',
      link: `/events/${e.id}`,
      dedupeKey: `low-checkin:${e.id}`,
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
  const totalStudents = (await get('SELECT COUNT(*) AS c FROM students')).c;
  let attended = 0;
  const lines = [];
  for (const e of events) {
    let a;
    if (e.reportSummary) {
      try {
        a = JSON.parse(e.reportSummary).attended;
      } catch {
        a = undefined;
      }
    }
    if (a === undefined) {
      a = (
        await get(
          `SELECT COUNT(*) AS c FROM attendance WHERE event_id = ? AND status IN ('early','on-time','late','present')`,
          [e.id]
        )
      ).c;
    }
    attended += a;
    lines.push(`${e.name}: ${a}/${totalStudents}`);
  }
  const total = events.length * totalStudents;
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
    try {
      await evaluateAtRisk();
    } catch (err) {
      console.error('notification check failed:', err);
    }
  }
}
