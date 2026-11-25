import { query } from '../db.js';
import { ROLE_LABEL, plain } from '../text.js';
import { addDays, currentShift, dayNameID, longDate, shiftEnd, shiftLabel } from '../time.js';
import { getSettings } from './settings.js';
import { gatewayReady, gatewayStatus, sendText } from './wa-gateway.js';

/*
 * P2H Genset ke grup WhatsApp, selain temuan A / AA (langsung saat P2H dikirim: services/whatsapp.js):
 *  - temuan selesai diperbaiki;
 *  - satu rekap ringkas SEMUA site tiap akhir shift (jumlah P2H, temuan, genset yang belum P2H).
 *    Dikirim sekali per shift (tabel wa_shift_summaries), dicek berkala dan setiap ada P2H masuk,
 *    jadi tetap terkirim walau server sempat tidur saat shift berakhir.
 */

const defaultDeps = () => ({
  query,
  settings: getSettings,
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

/* ---------- rekap ringkas semua site tiap akhir shift ---------- */

/** Shift yang direkap hanya yang baru saja berakhir (tidak menyusulkan rekap lama). */
const MAX_LATE_HOURS = 12;
const LIST_MAX = 8;
const short = (xs) => (xs.length > LIST_MAX ? `${xs.slice(0, LIST_MAX).join(', ')}, +${xs.length - LIST_MAX} lainnya` : xs.join(', '));

/** Data rekap satu shift untuk semua site. */
export async function collectShiftSummary(date, shift) {
  const { rows } = await deps.query(
    `SELECT s.id AS site_id, s.name AS site, s.sort_order, u.code, u.status, f.id AS form_id, f.result, (f.sup_signed_at IS NOT NULL) AS verified
       FROM units u
       JOIN sites s ON s.id = u.site_id
       LEFT JOIN p2h_forms f ON f.unit_id = u.id AND f.shift_date = $1 AND f.shift = $2
      WHERE u.pmmr_group = 'produksi' AND (u.status IN ('running', 'standby') OR f.id IS NOT NULL)
      ORDER BY s.sort_order, s.name, u.code`,
    [date, shift],
  );
  const sites = new Map();
  for (const r of rows) {
    if (!sites.has(r.site_id)) sites.set(r.site_id, { name: r.site, units: [] });
    sites.get(r.site_id).units.push(r);
  }
  return { date, shift: Number(shift), sites: [...sites.values()], units: rows };
}

/** Teks rekap ringkas. d = hasil collectShiftSummary. */
export function buildShiftSummary(d) {
  const done = d.units.filter((u) => u.form_id != null);
  const stop = done.filter((u) => u.result === 'stop_aa').map((u) => u.code);
  const temuan = done.filter((u) => u.result === 'temuan_a').map((u) => u.code);
  const missing = d.units.filter((u) => u.form_id == null).map((u) => u.code);
  const verified = done.filter((u) => u.verified).length;
  const lines = [
    `📋 *Rekap P2H Genset · Shift ${shiftLabel(d.shift)}*`,
    `${dayNameID(d.date)}, ${longDate(d.date)}`,
    `P2H: ${done.length}/${d.units.length} genset · terverifikasi ${verified}`,
    '',
    ...d.sites.map((s) => {
      const n = s.units.filter((u) => u.form_id != null);
      const st = n.filter((u) => u.result === 'stop_aa').length;
      const a = n.filter((u) => u.result === 'temuan_a').length;
      const tag = [st ? `${st} STOP` : '', a ? `${a} temuan` : ''].filter(Boolean).join(', ');
      return `${n.length === s.units.length ? '✅' : '⏳'} ${s.name} ${n.length}/${s.units.length}${tag ? ` · ${tag}` : ''}`;
    }),
  ];
  const notes = [];
  if (stop.length) notes.push(`🛑 STOP AA: ${short(stop)}`);
  if (temuan.length) notes.push(`⚠️ Temuan A: ${short(temuan)}`);
  if (missing.length) notes.push(`❌ Belum P2H: ${short(missing)}`);
  lines.push('', ...(notes.length ? notes : ['Semua genset sudah P2H dan baik.']));
  return lines.join('\n');
}

/** Shift yang terakhir berakhir (sebelum shift yang sedang berjalan). */
function lastEndedShift(s, now) {
  const cur = currentShift(new Date(now), s.shift1_start, s.shift2_start);
  return cur.shift === 1 ? { date: addDays(cur.shift_date, -1), shift: 2 } : { date: cur.shift_date, shift: 1 };
}

/**
 * Kirim rekap shift yang baru berakhir bila belum terkirim. Aman dipanggil berkali-kali dan dari beberapa server:
 * penanda di database memastikan rekap hanya keluar sekali. Tidak pernah melempar error.
 */
export async function sendShiftSummaryIfDue() {
  try {
    if (!deps.ready()) return { ok: false, skipped: 'tidak aktif' };
    const s = await deps.settings();
    const now = deps.now();
    const { date, shift } = lastEndedShift(s, now);
    const end = shiftEnd(date, shift, s.shift1_start, s.shift2_start).getTime();
    if (now - end > MAX_LATE_HOURS * 3600_000) return { ok: false, skipped: 'terlambat' };
    // shift yang berakhir sebelum grup dipilih tidak direkap
    const since = deps.target()?.since;
    if (since && end < new Date(since).getTime()) return { ok: false, skipped: 'sebelum grup dipilih' };
    const claim = await deps.query('INSERT INTO wa_shift_summaries (shift_date, shift) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING shift', [date, shift]);
    if (!claim.rowCount) return { ok: false, skipped: 'sudah dikirim' };
    try {
      await deps.send(deps.target().id, buildShiftSummary(await collectShiftSummary(date, shift)));
      return { ok: true, date, shift };
    } catch (err) {
      // belum terkirim: lepas penandanya supaya dicoba lagi
      await deps.query('DELETE FROM wa_shift_summaries WHERE shift_date = $1 AND shift = $2', [date, shift]).catch(() => {});
      console.error(`[wa] gagal mengirim rekap shift ${date} ${shift}: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  } catch (err) {
    console.error('[wa] rekap shift gagal:', err.message);
    return { ok: false, reason: err.message };
  }
}

let timer = null;
/** Cek berkala (tiap 5 menit) apakah ada shift yang baru berakhir dan belum direkap. */
export function startShiftSummary(everyMs = 5 * 60_000) {
  if (timer) return;
  timer = setInterval(() => void sendShiftSummaryIfDue(), everyMs);
  timer.unref?.();
  setTimeout(() => void sendShiftSummaryIfDue(), 20_000).unref?.();
}
export function stopShiftSummary() {
  if (timer) clearInterval(timer);
  timer = null;
}

/* ---------- khusus uji ---------- */

export function __setDepsForTest(d) {
  deps = { ...defaultDeps(), ...d };
}
export function __resetForTest() {
  deps = defaultDeps();
}
