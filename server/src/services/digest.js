import { get, run } from '../db.js';
import { config } from '../config.js';
import { cachedSettings, getSettings } from './settings.js';
import { buildOverview } from './reports.js';
import { createNotification } from './notifications.js';
import { todayInTz } from '../classify.js';

const LAST_KEY = 'digest_last_sent';
const DAY_MS = 86400000;
let inFlight = null;

function localHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date)
  );
}

function shiftDate(date, days) {
  return new Date(date.getTime() - days * DAY_MS);
}

function dateDiffDays(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clientUrl() {
  const origin = (config.clientOrigin || '').split(',')[0].trim();
  return origin || 'http://localhost:5173';
}

// Aggregate the last `days` of attendance into a compact digest. This reuses
// the same roster/series-aware reports logic as the Reports page.
async function collectDigest(days) {
  const to = todayInTz();
  const from = todayInTz(shiftDate(new Date(), Math.max(1, days) - 1));
  const { totalEvents, students } = await buildOverview({ from, to });
  const { atRiskThreshold } = cachedSettings();

  const active = students.filter((s) => s.expected > 0);
  const expected = active.reduce((sum, s) => sum + s.expected, 0);
  const attended = active.reduce((sum, s) => sum + s.attended, 0);
  const rate = expected ? Math.round((attended / expected) * 100) : 0;

  const atRisk = active
    .filter((s) => s.rate < atRiskThreshold)
    .sort((a, b) => a.rate - b.rate || String(a.lastName).localeCompare(String(b.lastName)))
    .slice(0, 8)
    .map((s) => ({
      id: s.id,
      name: `${s.lastName}, ${s.firstName}`,
      studentNo: s.studentNo,
      course: s.course,
      rate: s.rate,
      attended: s.attended,
      expected: s.expected,
    }));

  const byCourse = new Map();
  for (const s of active) {
    if (!s.course) continue;
    const entry = byCourse.get(s.course) || { course: s.course, attended: 0, expected: 0 };
    entry.attended += s.attended;
    entry.expected += s.expected;
    byCourse.set(s.course, entry);
  }
  const courses = [...byCourse.values()]
    .filter((c) => c.expected > 0)
    .map((c) => ({ ...c, rate: Math.round((c.attended / c.expected) * 100) }))
    .sort((a, b) => b.rate - a.rate || a.course.localeCompare(b.course))
    .slice(0, 5);

  const pendingRow = await get("SELECT COUNT(*) AS c FROM attendance_corrections WHERE status = 'pending'");
  const openRow = await get("SELECT COUNT(*) AS c FROM events WHERE status = 'active' AND archived = 0");

  return {
    from,
    to,
    days,
    totalEvents,
    totalStudents: active.length,
    attended,
    expected,
    rate,
    threshold: atRiskThreshold,
    atRisk,
    courses,
    pendingCorrections: pendingRow?.c || 0,
    openEvents: openRow?.c || 0,
  };
}

function buildBody(d) {
  const parts = [
    `${d.totalEvents} event${d.totalEvents === 1 ? '' : 's'} · ${d.attended}/${d.expected} check-ins (${d.rate}%)`,
    `${d.atRisk.length} student${d.atRisk.length === 1 ? '' : 's'} below ${d.threshold}% attendance`,
  ];
  if (d.pendingCorrections) parts.push(`${d.pendingCorrections} correction request(s) pending`);
  if (d.openEvents) parts.push(`${d.openEvents} event(s) currently open`);
  return parts.join('\n');
}

function digestEmail(d) {
  const link = `${clientUrl()}/reports?from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}`;
  const rows = [
    ['Events in period', d.totalEvents],
    ['Check-ins', `${d.attended}/${d.expected}`],
    ['Attendance rate', `${d.rate}%`],
    ['Below threshold', `${d.atRisk.length} / ${d.totalStudents}`],
    ['Pending corrections', d.pendingCorrections],
    ['Open events', d.openEvents],
  ];
  const courseRows = d.courses
    .map((c) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(c.course)}</td><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${c.rate}%</td></tr>`)
    .join('');
  const riskRows = d.atRisk
    .map((s) => `<li style="margin:2px 0">${escapeHtml(s.name)} — ${s.rate}% (${s.attended}/${s.expected})</li>`)
    .join('');

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#0f172a;max-width:620px;margin:0 auto">
      <h2 style="margin:0 0 4px">AttendX attendance digest</h2>
      <p style="color:#64748b;margin:0 0 18px">${escapeHtml(d.from)} to ${escapeHtml(d.to)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(label)}</td><td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${escapeHtml(value)}</td></tr>`
          )
          .join('')}
      </table>
      ${courseRows ? `<h3 style="margin:20px 0 6px;font-size:15px">Attendance by course</h3><table style="border-collapse:collapse;width:100%;font-size:14px">${courseRows}</table>` : ''}
      ${riskRows ? `<h3 style="margin:20px 0 6px;font-size:15px">Students needing attention</h3><ul style="margin:0;padding-left:20px;font-size:14px;color:#334155">${riskRows}</ul>` : ''}
      <p style="margin-top:20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">Open the report</a></p>
      <p style="color:#94a3b8;font-size:12px;margin-top:20px">Sent automatically by AttendX. Change the schedule in Settings.</p>
    </div>`;
  const text = [
    `AttendX attendance digest (${d.from} to ${d.to})`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(d.courses.length ? ['', 'Attendance by course:', ...d.courses.map((c) => `${c.course}: ${c.rate}%`)] : []),
    ...(d.atRisk.length ? ['', 'Students needing attention:', ...d.atRisk.map((s) => `${s.name} — ${s.rate}% (${s.attended}/${s.expected})`)] : []),
    '',
    `Open the report: ${link}`,
  ].join('\n');
  return { html, text, link };
}

async function sendDigestEmail(digest, recipients) {
  const list = String(recipients || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return { status: 'no-recipients' };
  if (!config.resendApiKey) return { status: 'not-configured', recipients: list.length };

  const { html, text } = digestEmail(digest);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.digestFrom,
        to: list,
        subject: `AttendX digest — ${digest.from} to ${digest.to}`,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('digest email failed:', res.status, detail.slice(0, 300));
      return { status: 'failed', recipients: list.length, httpStatus: res.status };
    }
    return { status: 'sent', recipients: list.length };
  } catch (err) {
    console.error('digest email failed:', err.message);
    return { status: 'failed', recipients: list.length };
  }
}

// Move the last-sent marker forward, but only if nobody else already claimed
// this run. This keeps concurrent cron/lazy workers from double-sending.
async function claimDigest(today, previous) {
  if (previous === null) {
    const info = await run(
      `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      [LAST_KEY, today]
    );
    return info.changes > 0;
  }
  const info = await run(
    `UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ? AND value = ?`,
    [today, LAST_KEY, previous]
  );
  return info.changes > 0;
}

async function runDigest({ force = false } = {}) {
  // The cron endpoint and request middleware normally keep this warm; refresh
  // explicitly so a manual run always uses the saved schedule.
  await getSettings();
  const settings = cachedSettings();
  const every = Math.max(0, Number(settings.digestEveryDays) || 0);
  const hour = Math.max(0, Math.min(23, Number(settings.digestHour) || 0));
  if (!every && !force) return { ok: true, skipped: 'off' };

  const now = new Date();
  if (!force && localHour(now) < hour) return { ok: true, skipped: 'before-hour', hour };

  const today = todayInTz(now);
  const lastRow = await get('SELECT value FROM settings WHERE key = ?', [LAST_KEY]);
  const last = lastRow?.value || null;
  if (!force && last) {
    const since = dateDiffDays(String(last).slice(0, 10), today);
    if (since >= 0 && since < every) {
      return { ok: true, skipped: 'not-due', last, nextInDays: every - since };
    }
  }

  const digest = await collectDigest(every || 30);
  if (!force && digest.totalEvents === 0) {
    await claimDigest(today, last);
    return { ok: true, skipped: 'no-data' };
  }

  if (!force && !(await claimDigest(today, last))) {
    return { ok: true, skipped: 'claimed' };
  }
  if (force) {
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [LAST_KEY, today]
    );
  }

  const emailed = await sendDigestEmail(digest, settings.digestRecipients);
  await createNotification({
    type: 'digest',
    title: `Attendance digest — ${digest.from} to ${digest.to}`,
    body: buildBody(digest),
    severity: digest.atRisk.length ? 'warning' : 'info',
    audience: 'admin',
    link: `/reports?from=${encodeURIComponent(digest.from)}&to=${encodeURIComponent(digest.to)}`,
    dedupeKey: force ? `digest:manual:${Date.now()}` : `digest:${today}`,
    data: { kind: 'digest', ...digest, email: emailed },
  });

  return { ok: true, digest, emailed };
}

// Collapse concurrent callers into one run (cron + a page request).
export async function maybeRunDigest(options = {}) {
  if (inFlight) return inFlight;
  inFlight = runDigest(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function runDigestNow() {
  return maybeRunDigest({ force: true });
}
