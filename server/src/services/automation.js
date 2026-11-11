import { all, run } from '../db.js';
import { eventEnd } from '../classify.js';
import { cachedSettings } from './settings.js';
import { consolidateEvent, nowUtc } from './eventSummary.js';
import { logAudit } from './audit.js';
import { notifyEventClosed, runBackgroundChecks } from './notifications.js';
import { maybeRunDigest } from './digest.js';

// Lazy maintenance runs at most once every five minutes per instance. The
// daily Vercel cron is the safety net when nobody opens the app.
const MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastRun = 0;
let inFlight = null;

// Close active events whose scheduled end (plus the configured grace period)
// has passed. Events without an end time are left for a manual close.
async function closeExpiredEvents() {
  const { autoCloseGraceMin } = cachedSettings();
  const graceMs = Math.max(0, Number(autoCloseGraceMin) || 0) * 60000;
  const rows = await all(
    `SELECT id, name, event_date AS eventDate, start_time AS startTime,
            end_time AS endTime, status
     FROM events
     WHERE status = 'active' AND archived = 0
       AND end_time IS NOT NULL AND end_time <> ''`
  );
  const now = Date.now();
  const closed = [];
  for (const event of rows) {
    const end = eventEnd(event);
    if (!end || now < end.getTime() + graceMs) continue;
    const summary = await consolidateEvent(event.id);
    if (!summary) continue;
    await logAudit({
      user: { name: 'Automation' },
      action: 'event.auto-close',
      entity: 'event',
      entityId: event.id,
      detail: `${event.name} · attended ${summary.attended}/${summary.totalStudents} (${summary.rate}%)`,
    });
    await notifyEventClosed(event, summary).catch(() => {});
    closed.push({ id: event.id, name: event.name, rate: summary.rate });
  }
  return closed;
}

// File closed events into the archive after the configured number of days.
// Zero disables automatic archiving.
async function archiveOldEvents() {
  const days = Math.max(0, Number(cachedSettings().autoArchiveAfterDays) || 0);
  if (!days) return [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = await all(
    `SELECT id, name FROM events
     WHERE status = 'closed' AND archived = 0
       AND closed_at IS NOT NULL AND closed_at <= ?`,
    [cutoff]
  );
  const archived = [];
  const at = nowUtc();
  for (const event of rows) {
    await run('UPDATE events SET archived = 1, archived_at = ? WHERE id = ?', [at, event.id]);
    await logAudit({
      user: { name: 'Automation' },
      action: 'event.auto-archive',
      entity: 'event',
      entityId: event.id,
      detail: event.name,
    });
    archived.push({ id: event.id, name: event.name });
  }
  return archived;
}

async function doRun() {
  const startedAt = new Date().toISOString();
  const closed = await closeExpiredEvents();
  const archived = await archiveOldEvents();

  // Proactive notifications (low check-in, daily summary, at-risk/compliance).
  // Failures here must never stop the lifecycle cleanup above.
  try {
    await runBackgroundChecks();
  } catch (err) {
    console.error('automation notification checks failed:', err);
  }

  // Scheduled attendance digest (in-app for admins, plus email when configured).
  let digest = null;
  try {
    digest = await maybeRunDigest();
  } catch (err) {
    console.error('automation digest failed:', err);
  }

  if (closed.length || archived.length) {
    await logAudit({
      user: { name: 'Automation' },
      action: 'automation.run',
      entity: 'system',
      detail: `Auto-closed ${closed.length} event(s), auto-archived ${archived.length} event(s)`,
    });
  }

  return { ok: true, startedAt, closed, archived, digest };
}

// Run now, collapsing concurrent callers (cron + a page request) into one job.
export async function runAutomation() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      return await doRun();
    } finally {
      lastRun = Date.now();
      inFlight = null;
    }
  })();
  return inFlight;
}

// Throttled variant for request paths so normal browsing stays snappy.
export async function maybeRunAutomation() {
  if (inFlight) return inFlight;
  if (Date.now() - lastRun < MIN_INTERVAL_MS) return { ok: true, skipped: true };
  return runAutomation();
}
