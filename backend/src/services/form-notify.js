import { config } from '../config.js';
import { query } from '../db.js';
import { plain } from '../text.js';
import { addDays, currentShift, dayNameID, longDate, shiftEnd, shiftLabel } from '../time.js';
import { notifyEvent } from './push.js';
import { getSettings } from './settings.js';
import { gatewayStatus, sendText } from './wa-gateway.js';
import { whatsappReady } from './whatsapp.js';

/*
 * Pemberitahuan form digital (selain P2H Genset).
 *  - Di aplikasi + notifikasi HP: tiap isian (temuan ditandai) dan saat temuan ditutup.
 *  - Grup WhatsApp (bisa dimatikan per form di Kelola):
 *      wa_findings: semua temuan (STOP & perbaiki) langsung, dan saat temuan selesai diperbaiki
 *  Tiap form bisa punya grup sendiri (wa_group_id); kosong = grup utama.
 *      wa_verify  : saat diverifikasi pengawas. Form per shift tidak per isian, tetapi
 *                   satu rekap per site per shift setelah semua isian shift itu terverifikasi.
 * Tidak pernah melempar error: form tetap tersimpan walau pemberitahuan gagal.
 */

const defaultDeps = () => ({
  query,
  // jid = grup khusus form ini; kosong = grup utama di Pengaturan
  ready: (jid) => (jid ? gatewayStatus().paired : whatsappReady()),
  send: (text, jid) => sendText(jid || gatewayStatus().target.id, text),
  settings: getSettings,
  now: () => Date.now(),
});
let deps = defaultDeps();
export function __setDepsForTest(d) {
  deps = { ...defaultDeps(), ...d };
}

const pathOf = (code, id) => `/f/${code}/r/${id}`;
const link = (code, id) => `${config.appUrl}${pathOf(code, id)}`;
const when = (r) => `${dayNameID(r.record_date)}, ${longDate(r.record_date)}${r.shift ? ` · Shift ${shiftLabel(r.shift)}` : ''}`;
const list = (xs, max = 2) => {
  const names = xs.map((x) => plain(x.item_text));
  return names.length > max ? `${names.slice(0, max).join('; ')}; +${names.length - max} lainnya` : names.join('; ');
};
/** Grup WhatsApp tujuan form ini (null = grup utama). */
const groupOf = (type) => type?.wa_group_id || null;
const waReady = (type) => deps.ready(groupOf(type));
const wa = (type, text, what) => {
  if (!waReady(type)) return Promise.resolve(false);
  return Promise.resolve(deps.send(text, groupOf(type)))
    .then(() => true)
    .catch((err) => {
      console.error(`[wa] gagal mengirim ${what}: ${err.message}`);
      return false;
    });
};

/* ---------- isian baru / temuan baru ---------- */

/**
 * r: { id, record_date, shift, site_id, site_name, subject_name, filler_name }
 * findings: [{ item_text, kind, severity, bad_label, note }]
 */
export function notifyRecord(type, r, findings, actorUserId) {
  const stop = findings.filter((f) => f.severity === 'stop');
  const fix = findings.filter((f) => f.severity !== 'stop');
  const where = `${type.short_name} · ${r.site_name}`;
  const n = stop.length
    ? { kind: 'form_stop', severity: 'danger', title: `STOP · ${r.subject_name}`, body: `${where} · ${list(stop)}. Jangan dioperasikan sebelum diperbaiki.` }
    : fix.length
      ? { kind: 'form_finding', severity: 'warn', title: `Ada temuan · ${r.subject_name}`, body: `${where} · ${fix.length} temuan: ${list(fix)}.` }
      : { kind: 'form_ok', severity: 'ok', title: `${type.short_name} selesai · ${r.subject_name}`, body: `${where} · oleh ${r.filler_name} · semua baik.` };
  notifyEvent({ ...n, isFinding: findings.length > 0, siteId: r.site_id, actorUserId, path: pathOf(type.code, r.id), formCode: type.code }).catch((err) =>
    console.error('[notif] gagal:', err.message),
  );
  if (findings.length && type.wa_findings !== false) void wa(type, buildFindingMessage(type, r, findings), `temuan ${type.code}`);
}

function findingLine(f, i) {
  const what = f.kind === 'measure' ? 'di luar batas' : f.bad_label || 'tidak baik';
  return `${i + 1}. ${plain(f.item_text)} (${what})${f.note ? `\n   Catatan: ${f.note}` : ''}`;
}

/** Satu pesan untuk semua temuan satu isian: STOP dulu, lalu yang perlu diperbaiki. */
export function buildFindingMessage(type, r, findings) {
  const stop = findings.filter((f) => f.severity === 'stop');
  const fix = findings.filter((f) => f.severity !== 'stop');
  const lines = stop.length
    ? [`🛑 *STOP · ${type.short_name} · ${r.subject_name}*`, 'Jangan dioperasikan sebelum diperbaiki.']
    : [`⚠️ *Ada temuan · ${type.short_name} · ${r.subject_name}*`];
  lines.push('', `Site: ${r.site_name}`, `Tanggal: ${when(r)}`, `Diperiksa oleh: ${r.filler_name}`);
  if (stop.length) lines.push('', `*Temuan STOP (${stop.length}):*`, ...stop.map(findingLine));
  if (fix.length) lines.push('', `*Perlu diperbaiki dalam ${type.fix_hours} jam (${fix.length}):*`, ...fix.map(findingLine));
  lines.push('', `Rincian dan foto: ${link(type.code, r.id)}`);
  return lines.join('\n');
}
/** nama lama, tetap ada untuk pemanggil lama */
export const buildStopMessage = (type, r, stop) => buildFindingMessage(type, r, stop);

/* ---------- temuan selesai ---------- */

/** f: { record_id, subject_name, site_id, site_name, item_text, severity, fix_note, by_name, unit_free } */
export function notifyFixed(type, f, actorUserId) {
  notifyEvent({
    kind: 'form_closed',
    severity: 'ok',
    isFinding: true,
    title: f.unit_free ? `Boleh jalan lagi · ${f.subject_name}` : `Temuan selesai · ${f.subject_name}`,
    body: `${type.short_name} · ${f.site_name} · ${plain(f.item_text)} sudah diperbaiki oleh ${f.by_name}.`,
    siteId: f.site_id,
    actorUserId,
    path: pathOf(type.code, f.record_id),
    formCode: type.code,
  }).catch((err) => console.error('[notif] gagal:', err.message));
  if (type.wa_findings !== false) void wa(type, buildFixedMessage(type, f), `temuan selesai ${type.code}`);
}

export function buildFixedMessage(type, f) {
  const stop = f.severity === 'stop';
  return [
    stop && f.unit_free ? `✅ *Boleh jalan lagi · ${f.subject_name}*` : `✅ *Temuan selesai · ${f.subject_name}*`,
    ...(stop ? [f.unit_free ? 'Tidak ada lagi temuan STOP di objek ini.' : '🛑 Masih ada temuan STOP lain yang belum selesai.'] : []),
    '',
    `${type.short_name} · ${f.site_name}`,
    `Butir: ${plain(f.item_text)}`,
    ...(f.fix_note ? [`Perbaikan: ${f.fix_note}`] : []),
    `Ditutup oleh: ${f.by_name}`,
  ].join('\n');
}

/* ---------- verifikasi ---------- */

const RESULT_TEXT = { ok: 'Semua baik', finding: 'Ada temuan', stop: 'STOP' };

/** Pesan satu isian yang baru diverifikasi (form mingguan / bulanan / sesuai kebutuhan). */
export function buildVerifiedMessage(type, r) {
  const counts = [r.n_stop ? `${r.n_stop} STOP` : null, r.n_fix ? `${r.n_fix} perlu diperbaiki` : null].filter(Boolean).join(', ');
  return [
    `✅ *${type.short_name} terverifikasi · ${r.subject_name}*`,
    `${r.site_name} · ${when(r)}`,
    '',
    `Hasil: ${RESULT_TEXT[r.result]}${counts ? ` (${counts})` : ''}`,
    `Diperiksa oleh: ${r.filler_name}`,
    `Diverifikasi oleh: ${r.sup_name}`,
    ...(r.sup_note ? [`Catatan / rekomendasi: ${r.sup_note}`] : []),
    '',
    `Rincian: ${link(type.code, r.id)}`,
  ].join('\n');
}

/**
 * Dipanggil sesudah verifikasi. Form per shift: kirim rekap site itu untuk shift itu bila sudah waktunya.
 * Form lain: kirim pesan isian ini.
 */
export async function notifyVerified(type, recordId) {
  try {
    if (type.wa_verify === false || !waReady(type)) return { ok: false, skipped: true };
    const r = (await deps.query('SELECT * FROM form_records WHERE id = $1', [recordId])).rows[0];
    if (!r) return { ok: false, skipped: true };
    if (type.period === 'shift') return await sendShiftRekap(type, r.site_id, r.record_date, r.shift);
    return { ok: await wa(type, buildVerifiedMessage(type, r), `verifikasi ${type.code}`) };
  } catch (err) {
    console.error('[wa] kabar verifikasi gagal:', err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Isian baru di form per shift: rekap shift sebelumnya di site itu yang sudah lengkap terverifikasi tapi belum terkirim
 * (mis. semua unit sudah diverifikasi sebelum shift berakhir) dikirim sekarang.
 */
export async function notifyShiftActivity(type, siteId) {
  try {
    if (type.period !== 'shift' || type.wa_verify === false || !waReady(type)) return [];
    const s = await deps.settings();
    const cur = currentShift(new Date(deps.now()), s.shift1_start, s.shift2_start);
    const prev = cur.shift === 1 ? { date: addDays(cur.shift_date, -1), shift: 2 } : { date: cur.shift_date, shift: 1 };
    return [await sendShiftRekap(type, siteId, prev.date, prev.shift)];
  } catch (err) {
    console.error('[wa] rekap shift gagal:', err.message);
    return [];
  }
}

/** Data satu site satu shift untuk rekap: semua objek aktif di site itu beserta isiannya. */
async function collectShift(type, siteId, date, shift) {
  const site = (await deps.query('SELECT name FROM sites WHERE id = $1', [siteId])).rows[0]?.name ?? '';
  const rows = (
    await deps.query(
      `SELECT s.id, s.name, r.id AS record_id, r.result, r.n_stop, r.n_fix, r.sup_name, r.sup_note, (r.sup_signed_at IS NOT NULL) AS verified
         FROM form_subjects s
         LEFT JOIN form_records r ON r.subject_id = s.id AND r.record_date = $3 AND r.shift = $4
        WHERE s.form_type_id = $1 AND s.site_id = $2 AND (s.is_active OR r.id IS NOT NULL)
        ORDER BY s.sort_order, s.name`,
      [type.id, siteId, date, shift],
    )
  ).rows;
  return { site, date, shift, rows, filled: rows.filter((x) => x.record_id), missing: rows.filter((x) => !x.record_id) };
}

export function buildShiftRekap(type, d, { ended }) {
  const lines = [`📋 *Rekap ${type.short_name} ${d.site} · Shift ${shiftLabel(d.shift)}*`, `${dayNameID(d.date)}, ${longDate(d.date)}`];
  const total = d.rows.length;
  lines.push(`✅ ${d.filled.length} dari ${total} ${type.subject_label.charAt(0).toLowerCase() + type.subject_label.slice(1)} diperiksa dan diverifikasi`);
  const stop = d.filled.filter((x) => x.n_stop);
  const fix = d.filled.filter((x) => !x.n_stop && x.n_fix);
  const good = d.filled.filter((x) => !x.n_stop && !x.n_fix);
  if (stop.length || fix.length) {
    lines.push('', '*Temuan:*');
    for (const x of stop) lines.push(`🛑 ${x.name} · STOP (${x.n_stop}${x.n_fix ? ` + ${x.n_fix} perbaiki` : ''}) · ${link(type.code, x.record_id)}`);
    for (const x of fix) lines.push(`⚠️ ${x.name} · ${x.n_fix} perlu diperbaiki · ${link(type.code, x.record_id)}`);
  } else lines.push('', 'Semua baik, tidak ada temuan.');
  if (good.length && (stop.length || fix.length)) lines.push('', `Baik: ${good.map((x) => x.name).join(', ')}`);
  if (ended && d.missing.length) lines.push(`Tidak diperiksa: ${d.missing.map((x) => x.name).join(', ')}`);
  const sups = [...new Set(d.filled.map((x) => x.sup_name).filter(Boolean))];
  if (sups.length) lines.push(`Diverifikasi oleh: ${sups.join(', ')}`);
  const notes = d.filled.filter((x) => x.sup_note).map((x) => `${x.name}: ${x.sup_note}`);
  if (notes.length) lines.push('', '*Rekomendasi:*', ...notes);
  return lines.join('\n');
}

/**
 * Kirim rekap site + shift sekali saja, bila semua isian shift itu sudah terverifikasi dan
 * (semua objek sudah diisi, atau shift sudah berakhir). Unit yang tidak dipakai shift itu tidak ditunggu selamanya.
 */
export async function sendShiftRekap(type, siteId, date, shift) {
  const done = await deps.query('SELECT 1 FROM form_wa_reports WHERE form_type_id = $1 AND site_id = $2 AND record_date = $3 AND shift = $4', [
    type.id, siteId, date, shift,
  ]);
  if (done.rowCount) return { ok: false, skipped: 'sudah dikirim' };
  const d = await collectShift(type, siteId, date, shift);
  if (!d.filled.length) return { ok: false, skipped: 'belum ada isian' };
  if (d.filled.some((x) => !x.verified)) return { ok: false, skipped: 'belum semua diverifikasi' };
  const s = await deps.settings();
  const ended = shiftEnd(date, shift, s.shift1_start, s.shift2_start).getTime() <= deps.now();
  if (d.missing.length && !ended) return { ok: false, skipped: 'shift belum berakhir' };
  const claim = await deps.query(
    'INSERT INTO form_wa_reports (form_type_id, site_id, record_date, shift) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING form_type_id',
    [type.id, siteId, date, shift],
  );
  if (!claim.rowCount) return { ok: false, skipped: 'sudah dikirim' };
  const ok = await wa(type, buildShiftRekap(type, d, { ended }), `rekap ${type.code}`);
  if (!ok) await deps.query('DELETE FROM form_wa_reports WHERE form_type_id = $1 AND site_id = $2 AND record_date = $3 AND shift = $4', [type.id, siteId, date, shift]);
  return { ok };
}
