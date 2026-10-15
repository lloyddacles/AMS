import { all, run } from '../db.js';

// Configurable settings with sensible defaults. Stored as key/value text.
export const SETTING_DEFAULTS = {
  atRiskThreshold: 80,
  atRiskMinEvents: 1,
};

const BOUNDS = {
  atRiskThreshold: { min: 0, max: 100 },
  atRiskMinEvents: { min: 0, max: 1000 },
};

export async function getSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const map = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, r.key)) {
      map[r.key] = Number(r.value);
    }
  }
  return map;
}

export async function updateSettings(patch) {
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)) continue;
    const num = Number(raw);
    const { min, max } = BOUNDS[key];
    if (!Number.isFinite(num) || num < min || num > max) {
      return { ok: false, status: 400, error: `Invalid value for ${key}` };
    }
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(Math.round(num))]
    );
  }
  return { ok: true, settings: await getSettings() };
}
