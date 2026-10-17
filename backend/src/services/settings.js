import { query } from '../db.js';

export const DEFAULT_SETTINGS = {
  shift1_start: '06:00',
  shift2_start: '18:00',
  require_signature: true,
  a_deadline_hours: 12,
};

let cache = null;
let cacheAt = 0;

export async function getSettings(force = false) {
  if (!force && cache && Date.now() - cacheAt < 15_000) return cache;
  const { rows } = await query('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  cache = out;
  cacheAt = Date.now();
  return out;
}

export async function saveSettings(patch, client) {
  const run = client ? client.query.bind(client) : query;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await run(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
  cache = null;
}
