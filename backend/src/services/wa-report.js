import { ROLE_LABEL, plain } from '../text.js';
import { gatewayReady, gatewayStatus, sendText } from './wa-gateway.js';

/*
 * Kabar "temuan selesai diperbaiki" P2H Genset ke grup WhatsApp.
 * Yang dikirim ke grup hanya temuan (A dan AA, langsung saat P2H dikirim: services/whatsapp.js)
 * dan perbaikannya (di sini). Rekap per site per shift tidak dikirim lagi supaya grup tidak terlalu ramai.
 */

const defaultDeps = () => ({
  ready: gatewayReady,
  target: () => gatewayStatus().target,
  send: sendText,
  now: () => Date.now(),
});
let deps = defaultDeps();

function duration(ms) {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return 'kurang dari 1 jam';
  if (h < 24) return `${h} jam`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} hari ${h % 24} jam` : `${d} hari`;
}

/**
 * Teks kabar temuan selesai diperbaiki.
 *  f: { unit_code, site_name, item_text, danger_code, fix_note, by_name, by_role, first_seen_at, unit_free, still_stop }
 */
export function buildFixedMessage(f, now = Date.now()) {
  const lines = [];
  if (f.unit_free) lines.push(`✅ *Boleh jalan lagi · ${f.unit_code}*`, 'Tidak ada lagi temuan STOP di unit ini.');
  else lines.push(`✅ *Temuan selesai · ${f.unit_code}*`);
  if (f.still_stop) lines.push('🛑 Unit masih STOP: ada temuan AA lain yang belum selesai.');
  lines.push('', `Site: ${f.site_name}`, `Butir: ${plain(f.item_text)} (kode ${f.danger_code})`);
  if (f.fix_note) lines.push(`Perbaikan: ${f.fix_note}`);
  lines.push(`Ditutup oleh: ${f.by_name}${ROLE_LABEL[f.by_role] ? ` (${ROLE_LABEL[f.by_role]})` : ''}`);
  if (f.first_seen_at) lines.push(`Lama terbuka: ${duration(now - new Date(f.first_seen_at).getTime())}`);
  return lines.join('\n');
}

/** Kabarkan temuan yang ditutup. Tidak pernah melempar error: perbaikan tetap tersimpan walau WhatsApp gagal. */
export async function notifyFixedGroup(f) {
  if (!deps.ready()) return { ok: false, skipped: true };
  try {
    await deps.send(deps.target().id, buildFixedMessage(f, deps.now()));
    return { ok: true };
  } catch (err) {
    console.error(`[wa] gagal mengabari temuan selesai (${f.unit_code}): ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/* ---------- khusus uji ---------- */

export function __setDepsForTest(d) {
  deps = { ...defaultDeps(), ...d };
}
export function __resetForTest() {
  deps = defaultDeps();
}
