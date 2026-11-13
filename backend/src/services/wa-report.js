import { config } from '../config.js';
import { query } from '../db.js';
import { CONDITION_LABEL, ROLE_LABEL, plain } from '../text.js';
import { addDays, dayNameID, longDate, shiftEnd, shiftLabel, wita } from '../time.js';
import { getSettings } from './settings.js';
import { gatewayReady, gatewayStatus, sendText } from './wa-gateway.js';

/*
 * Rekap P2H ke grup WhatsApp: satu pesan per site per shift.
 *  - Dikirim begitu semua genset wajib di site itu sudah di-P2H DAN semua P2H-nya diverifikasi pengawas.
 *  - Kalau shift sudah lewat LATE_GRACE_HOURS jam tetapi belum lengkap, rekap dikirim dengan tanda
 *    "belum lengkap" pada kegiatan berikutnya di site itu (P2H baru / verifikasi). Tidak butuh jadwal,
 *    jadi tetap jalan walau server Render sedang tidur.
 *  - Tiap rekap hanya dikirim sekali (tabel wa_site_reports).
 * Temuan STOP AA tetap dikabarkan langsung (services/whatsapp.js), begitu juga temuan yang ditutup.
 */

export const LATE_GRACE_HOURS = 3;
/** Rekap "belum lengkap" hanya untuk shift beberapa hari terakhir. */
const LOOKBACK_DAYS = 2;

const defaultDeps = () => ({
  query,
  settings: getSettings,
  ready: gatewayReady,
  target: () => gatewayStatus().target,
  send: sendText,
  now: () => Date.now(),
});
let deps = defaultDeps();

/* ---------- data satu site satu shift ---------- */

export async function collectShift(siteId, date, shift) {
  const [siteQ, unitsQ, findQ] = await Promise.all([
    deps.query('SELECT name FROM sites WHERE id = $1', [siteId]),
    deps.query(
      `SELECT u.code, u.status, f.id AS form_id, f.result, f.sup_name, (f.sup_signed_at IS NOT NULL) AS verified
         FROM units u
         LEFT JOIN p2h_forms f ON f.unit_id = u.id AND f.shift_date = $2 AND f.shift = $3
        WHERE u.site_id = $1 AND (u.status <> 'inactive' OR f.id IS NOT NULL)
        ORDER BY u.code`,
      [siteId, date, shift],
    ),
    deps.query(
      `SELECT f.id AS form_id, f.unit_code, a.danger_code, a.item_text, a.condition, a.note, a.fix_status
         FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
        WHERE f.site_id = $1 AND f.shift_date = $2 AND f.shift = $3 AND a.condition <> 'baik'
        ORDER BY f.unit_code, (a.danger_code = 'AA') DESC, a.section_order, a.item_no`,
      [siteId, date, shift],
    ),
  ]);
  const units = unitsQ.rows.map((u) => ({ ...u, required: u.status === 'running' || u.status === 'standby' }));
  const required = units.filter((u) => u.required);
  const forms = units.filter((u) => u.form_id != null);
  return {
    site: siteQ.rows[0]?.name ?? `Site ${siteId}`,
    date,
    shift: Number(shift),
    units,
    findings: findQ.rows,
    required: required.length,
    done: required.filter((u) => u.form_id != null).length,
    forms: forms.length,
    verified: forms.filter((u) => u.verified).length,
    complete: forms.length > 0 && required.every((u) => u.form_id != null) && forms.every((u) => u.verified),
  };
}

/* ---------- isi pesan ---------- */

const join = (xs) => xs.join(', ');

/** Teks rekap satu site satu shift. d = hasil collectShift. */
export function buildSiteReport(d, { deadlineHours = 12 } = {}) {
  const lines = [];
  const when = `${dayNameID(d.date)}, ${longDate(d.date)}`;
  if (d.complete) {
    lines.push(`📋 *Rekap P2H ${d.site} · Shift ${shiftLabel(d.shift)}*`, when);
    lines.push(`✅ ${d.forms} dari ${Math.max(d.required, d.forms)} genset sudah P2H dan diverifikasi`);
  } else {
    lines.push(`⏰ *Rekap P2H ${d.site} · Shift ${shiftLabel(d.shift)} (belum lengkap)*`, when);
    lines.push(`Sudah P2H: ${d.done} dari ${d.required} genset · diverifikasi: ${d.verified} dari ${d.forms}`);
    const missing = d.units.filter((u) => u.required && u.form_id == null).map((u) => u.code);
    const unverified = d.units.filter((u) => u.form_id != null && !u.verified).map((u) => u.code);
    if (missing.length) lines.push(`Belum P2H: ${join(missing)}`);
    if (unverified.length) lines.push(`Belum diverifikasi: ${join(unverified)}`);
  }

  // temuan, dikelompokkan per genset
  const byUnit = new Map();
  for (const f of d.findings) {
    if (!byUnit.has(f.form_id)) byUnit.set(f.form_id, { code: f.unit_code, items: [] });
    byUnit.get(f.form_id).items.push(f);
  }
  if (byUnit.size) {
    lines.push('', `*Temuan (${d.findings.length}):*`);
    for (const [formId, u] of byUnit) {
      const stop = u.items.some((x) => x.danger_code === 'AA' && x.fix_status !== 'closed');
      const head = stop ? `🛑 ${u.code} · STOP OPERASI` : `⚠️ ${u.code}`;
      lines.push(head);
      for (const x of u.items) {
        const cond = CONDITION_LABEL[x.condition];
        const due = x.danger_code === 'A' && x.fix_status !== 'closed' ? `, perbaiki dalam ${deadlineHours} jam` : '';
        const fixed = x.fix_status === 'closed' ? ' · sudah diperbaiki' : '';
        lines.push(`   ${x.danger_code}${due} · ${plain(x.item_text)}${cond ? ` (${cond})` : ''}${x.note ? `: ${x.note}` : ''}${fixed}`);
      }
      lines.push(`   Rincian: ${config.appUrl}/p2h/${formId}`);
    }
  } else if (d.forms) {
    lines.push('', 'Semua genset baik, tidak ada temuan.');
  }

  const good = d.units.filter((u) => u.form_id != null && u.result === 'baik').map((u) => u.code);
  if (good.length && byUnit.size) lines.push('', `Baik: ${join(good)}`);
  const off = d.units.filter((u) => !u.required && u.form_id == null).map((u) => u.code);
  if (off.length) lines.push(`Breakdown (tidak wajib P2H): ${join(off)}`);
  const sups = [...new Set(d.units.filter((u) => u.verified && u.sup_name).map((u) => u.sup_name))];
  if (sups.length) lines.push(`Diverifikasi oleh: ${join(sups)}`);
  return lines.join('\n');
}

/* ---------- kirim (sekali per site per shift) ---------- */

async function claim(siteId, date, shift, complete) {
  const r = await deps.query(
    `INSERT INTO wa_site_reports (site_id, shift_date, shift, complete) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING site_id`,
    [siteId, date, shift, complete],
  );
  return r.rowCount > 0;
}

/** Apakah rekap site itu untuk shift itu sudah dikirim. */
export async function reportSent(siteId, date, shift) {
  const r = await deps.query('SELECT 1 FROM wa_site_reports WHERE site_id = $1 AND shift_date = $2 AND shift = $3', [siteId, date, shift]);
  return r.rowCount > 0;
}

async function send(d, siteId, settings) {
  if (!(await claim(siteId, d.date, d.shift, d.complete))) return { ok: false, skipped: 'sudah dikirim' };
  try {
    await deps.send(deps.target().id, buildSiteReport(d, { deadlineHours: settings.a_deadline_hours }));
    return { ok: true, complete: d.complete };
  } catch (err) {
    // belum terkirim: lepaskan tandanya supaya dicoba lagi pada kegiatan berikutnya
    await deps.query('DELETE FROM wa_site_reports WHERE site_id = $1 AND shift_date = $2 AND shift = $3', [siteId, d.date, d.shift]).catch(() => {});
    console.error(`[wa] gagal mengirim rekap ${d.site} ${d.date} shift ${d.shift}: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/** Shift yang berakhir sebelum grup tujuan dipilih tidak direkap. */
function beforeTarget(date, shift, s) {
  const since = deps.target()?.since;
  return !!since && shiftEnd(date, shift, s.shift1_start, s.shift2_start).getTime() < new Date(since).getTime();
}

/** Kirim rekap bila site itu untuk shift itu sudah lengkap (semua P2H masuk dan terverifikasi). */
export async function sendIfComplete(siteId, date, shift) {
  if (!deps.ready()) return { ok: false, skipped: 'tidak aktif' };
  const s = await deps.settings();
  if (beforeTarget(date, shift, s)) return { ok: false, skipped: 'sebelum grup dipilih' };
  if (await reportSent(siteId, date, shift)) return { ok: false, skipped: 'sudah dikirim' };
  const d = await collectShift(siteId, date, shift);
  if (!d.complete) return { ok: false, skipped: 'belum lengkap' };
  return send(d, siteId, s);
}

/** Rekap "belum lengkap" untuk shift di site itu yang sudah lewat lebih dari LATE_GRACE_HOURS jam. */
export async function sendOverdue(siteId) {
  if (!deps.ready()) return [];
  const s = await deps.settings();
  const now = deps.now();
  const today = wita(new Date(now)).date;
  const { rows } = await deps.query(
    `SELECT DISTINCT f.shift_date, f.shift FROM p2h_forms f
      WHERE f.site_id = $1 AND f.shift_date >= $2
        AND NOT EXISTS (SELECT 1 FROM wa_site_reports r WHERE r.site_id = f.site_id AND r.shift_date = f.shift_date AND r.shift = f.shift)
      ORDER BY f.shift_date, f.shift`,
    [siteId, addDays(today, -LOOKBACK_DAYS)],
  );
  const out = [];
  for (const r of rows) {
    const end = shiftEnd(r.shift_date, r.shift, s.shift1_start, s.shift2_start).getTime();
    if (end + LATE_GRACE_HOURS * 3600_000 > now || beforeTarget(r.shift_date, r.shift, s)) continue;
    out.push(await send(await collectShift(siteId, r.shift_date, r.shift), siteId, s));
  }
  return out;
}

/**
 * Dipanggil sesudah P2H dikirim atau diverifikasi. Tidak pernah melempar error dan tidak ditunggu:
 * P2H tetap tersimpan walau WhatsApp gagal.
 */
export function onSiteActivity(siteId, date, shift) {
  if (!deps.ready()) return Promise.resolve();
  return (async () => {
    await sendOverdue(siteId);
    if (date) await sendIfComplete(siteId, date, shift);
  })().catch((err) => console.error('[wa] rekap gagal:', err.message));
}

/* ---------- temuan ditutup ---------- */

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
