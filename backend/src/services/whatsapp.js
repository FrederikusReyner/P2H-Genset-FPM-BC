import qrcode from 'qrcode-generator';
import { config } from '../config.js';
import { CONDITION_LABEL, plain } from '../text.js';
import { dayNameID, longDate, shiftLabel } from '../time.js';
import { gatewayReady, gatewayStatus, initGateway, sendText, stopGateway } from './wa-gateway.js';

/*
 * Kabar temuan P2H ke grup WhatsApp.
 * Pesan dikirim langsung dari server ini ke WhatsApp lewat gateway sendiri (services/wa-gateway.js),
 * tanpa layanan pihak ketiga. Cara memasang: docs/Notifikasi-WhatsApp.md
 */

export const whatsappReady = gatewayReady;

/** Dipanggil sesudah database siap. Tidak pernah menggagalkan server. */
export async function initWhatsapp() {
  try {
    const on = await initGateway();
    const st = gatewayStatus();
    if (!on) console.log('[wa] WhatsApp belum ditautkan: kabar temuan ke grup dimatikan.');
    else if (!st.target) console.log('[wa] WhatsApp sudah ditautkan, tetapi grup tujuan belum dipilih.');
    else console.log(`[wa] kabar temuan ke grup WhatsApp aktif (grup: ${st.target.name || st.target.id})`);
  } catch (err) {
    console.error('[wa] gagal menyiapkan WhatsApp:', err.message);
  }
}

export const stopWhatsapp = stopGateway;

let qrCache = { text: null, url: null };
/** Kode QR tautan perangkat sebagai gambar (data URL), supaya bisa langsung ditampilkan dan di-scan. */
function qrImage(text) {
  if (!text) return null;
  if (qrCache.text !== text) {
    const q = qrcode(0, 'L');
    q.addData(text);
    q.make();
    qrCache = { text, url: q.createDataURL(6, 18) };
  }
  return qrCache.url;
}

/** Keadaan fitur untuk admin. Kunci sesi tidak pernah ikut dikirim ke tampilan. */
export function whatsappStatus() {
  const st = gatewayStatus();
  return {
    enabled: st.paired && !!st.target,
    phase: st.phase,
    paired: st.paired,
    number: st.number,
    name: st.name,
    qr: qrImage(st.qr),
    error: st.error,
    group: st.target,
    last: st.last,
  };
}

/* ---------- isi pesan ---------- */

function listFindings(items) {
  const out = [];
  items.forEach((f, i) => {
    const cond = CONDITION_LABEL[f.condition];
    out.push(`${i + 1}. ${plain(f.item_text)}${cond ? ` (${cond})` : ''}`);
    if (f.note) out.push(`   Catatan: ${f.note}`);
  });
  return out;
}

/**
 * Teks pesan untuk satu P2H yang ada temuannya.
 *  - form: { id, unit_code, site_name, shift, shift_date, inspector_name }
 *  - findings: [{ danger_code, item_text, condition, note }]
 */
export function buildFindingMessage(form, findings, { deadlineHours = 12 } = {}) {
  const aa = findings.filter((f) => f.danger_code === 'AA');
  const a = findings.filter((f) => f.danger_code !== 'AA');
  const lines = [];
  if (aa.length) {
    lines.push(`🛑 *STOP OPERASI · ${form.unit_code}*`, 'Jangan jalankan unit sebelum diperbaiki.');
  } else {
    lines.push(`⚠️ *Ada temuan P2H · ${form.unit_code}*`);
  }
  lines.push('', `Site: ${form.site_name}`);
  const day = form.shift_date ? ` · ${dayNameID(form.shift_date)}, ${longDate(form.shift_date)}` : '';
  lines.push(`Shift: ${shiftLabel(form.shift)}${day}`);
  if (form.inspector_name) lines.push(`Diperiksa oleh: ${form.inspector_name}`);
  if (aa.length) lines.push('', `*Kode AA (${aa.length}) · unit harus berhenti:*`, ...listFindings(aa));
  if (a.length) lines.push('', `*Kode A (${a.length}) · perbaiki dalam ${deadlineHours} jam:*`, ...listFindings(a));
  lines.push('', `Rincian dan foto: ${config.appUrl}/p2h/${form.id}`);
  return lines.join('\n');
}

/**
 * Kabarkan temuan sebuah P2H ke grup. Tidak pernah melempar error:
 * P2H tetap tersimpan walau WhatsApp gagal (pemberitahuan di aplikasi dan di HP tetap jalan).
 */
export async function notifyFindingGroup(form, findings, opts) {
  if (!whatsappReady() || !findings?.length) return { ok: false, skipped: true };
  try {
    await sendText(gatewayStatus().target.id, buildFindingMessage(form, findings, opts));
    return { ok: true };
  } catch (err) {
    console.error(`[wa] gagal mengabari grup (P2H ${form.id}, ${form.unit_code}): ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/** Pesan percobaan dari halaman Pengaturan. */
export async function sendTestToGroup(byName) {
  const st = gatewayStatus();
  if (!st.paired) return { ok: false, reason: 'WhatsApp belum ditautkan.' };
  if (!st.target) return { ok: false, reason: 'Grup tujuan belum dipilih.' };
  try {
    await sendText(
      st.target.id,
      `✅ *Tes P2H Genset*\nKalau pesan ini muncul, kabar temuan P2H ke grup ini sudah berfungsi.${byName ? `\nDikirim oleh: ${byName}` : ''}`,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
