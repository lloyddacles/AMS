import { all, run } from '../db.js';

// Configurable settings with sensible defaults. Stored as key/value text.
// The attendance policy keys are read synchronously from the in-process cache
// by classify.js, so classification stays cheap on every scan.
export const SETTING_DEFAULTS = {
  atRiskThreshold: 80,
  atRiskMinEvents: 1,
  onTimeMaxMin: 10,
  lateMaxMin: 60,
  timeoutOpenBeforeEndMin: 30,
  autoCloseGraceMin: 0,
  autoArchiveAfterDays: 0,
  lowCheckinRate: 50,
  lowCheckinGraceMin: 15,
};

const BOUNDS = {
  atRiskThreshold: { min: 0, max: 100 },
  atRiskMinEvents: { min: 0, max: 1000 },
  onTimeMaxMin: { min: 0, max: 120 },
  lateMaxMin: { min: 1, max: 480 },
  timeoutOpenBeforeEndMin: { min: 0, max: 240 },
  autoCloseGraceMin: { min: 0, max: 1440 },
  autoArchiveAfterDays: { min: 0, max: 365 },
  lowCheckinRate: { min: 0, max: 100 },
  lowCheckinGraceMin: { min: 0, max: 240 },
};

// Serverless deployments run several warm instances, so a policy saved through
// one instance must not stay stale in the others. Requests refresh the cache
// when it is older than this TTL; between refreshes, classification reads the
// cache synchronously with no extra query.
const CACHE_TTL_MS = 30 * 1000;
let cached = { ...SETTING_DEFAULTS };
let cachedAt = 0;

// Synchronous access for hot paths (classification, notifications). The cache
// is refreshed by getSettings()/updateSettings() and at bootstrap.
export function cachedSettings() {
  return cached;
}

export async function getSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const map = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, r.key)) {
      map[r.key] = Number(r.value);
    }
  }
  cached = map;
  cachedAt = Date.now();
  return map;
}

// Reload settings only when the cache has aged out. Safe to call on every
// request: normally this is a single timestamp comparison.
export async function refreshSettingsIfStale() {
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  return getSettings();
}

export async function updateSettings(patch) {
  // Validate the whole patch against the current cache first, so a bad
  // combination (e.g. late cutoff before on-time) never gets written.
  const next = { ...cached };
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)) continue;
    const num = Number(raw);
    const { min, max } = BOUNDS[key];
    if (!Number.isFinite(num) || num < min || num > max) {
      return { ok: false, status: 400, error: `Invalid value for ${key}` };
    }
    next[key] = Math.round(num);
  }
  if (next.lateMaxMin <= next.onTimeMaxMin) {
    return {
      ok: false,
      status: 400,
      error: 'Late cutoff must be greater than the on-time window',
    };
  }
  for (const [key, value] of Object.entries(next)) {
    if (!Object.prototype.hasOwnProperty.call(patch || {}, key)) continue;
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(value)]
    );
  }
  return { ok: true, settings: await getSettings() };
}
