import { get, run } from '../db.js';
import { config } from '../config.js';

// Simple username-based throttling for failed sign-ins. Stored in the database
// so the limit holds across serverless instances (an in-memory counter would
// reset on every cold start).
//
// Failed attempts are counted within a rolling window; once the count reaches
// the limit the account is locked for `loginLockMinutes`. A successful sign-in
// clears the counter.

function key(username) {
  return String(username || '').trim().toLowerCase();
}

function parseTime(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function checkLogin(username) {
  const row = await get('SELECT * FROM login_attempts WHERE username = ?', [key(username)]);
  if (!row || !row.locked_until) return { locked: false };
  const until = parseTime(row.locked_until);
  const now = Date.now();
  if (!until || until <= now) return { locked: false };
  return { locked: true, retryAfter: Math.ceil((until - now) / 1000) };
}

export async function recordFailure(username) {
  const name = key(username);
  const now = Date.now();
  const windowMs = config.loginLockMinutes * 60 * 1000;
  const max = config.loginMaxAttempts;

  const row = await get('SELECT * FROM login_attempts WHERE username = ?', [name]);
  const firstAt = row ? parseTime(row.first_failed_at) : 0;
  const withinWindow = firstAt && now - firstAt < windowMs;
  const count = withinWindow ? Number(row.failed_count) + 1 : 1;
  const firstFailedAt = count === 1 ? new Date(now).toISOString() : row.first_failed_at;
  const lockedUntil = count >= max ? new Date(now + windowMs).toISOString() : null;

  await run(
    `INSERT INTO login_attempts (username, failed_count, first_failed_at, locked_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       failed_count = excluded.failed_count,
       first_failed_at = excluded.first_failed_at,
       locked_until = excluded.locked_until,
       updated_at = excluded.updated_at`,
    [name, count, firstFailedAt, lockedUntil, new Date(now).toISOString()]
  );

  return { count, locked: !!lockedUntil, retryAfter: lockedUntil ? windowMs / 1000 : 0 };
}

export async function recordSuccess(username) {
  await run('DELETE FROM login_attempts WHERE username = ?', [key(username)]);
}
