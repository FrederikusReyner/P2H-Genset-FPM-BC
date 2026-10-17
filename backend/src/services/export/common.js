import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { loadForm } from '../../routes/p2h.js';
import { dayNameID, longDate, shiftLabel, shortDate, stampWITA } from '../../time.js';
import { CONDITION_LABEL, FIX_LABEL, RESULT_LABEL, plain } from '../../text.js';

const cache = new Map();
/** Baca logo dari folder assets (null bila tidak ada, supaya unduhan tetap jalan). */
export function asset(name) {
  if (!cache.has(name)) {
    try {
      cache.set(name, fs.readFileSync(path.join(config.root, 'assets', name)));
    } catch {
      cache.set(name, null);
    }
  }
  return cache.get(name);
}

/** Angka gaya Indonesia tanpa pemisah ribuan: 26630 / 26630,5 */
export const fmtNum = (v) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('id-ID', { useGrouping: false, maximumFractionDigits: 2 });

export function pngBuffer(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  return m ? Buffer.from(m[1], 'base64') : null;
}

export const TITLE = 'FORM INSPEKSI HARIAN GENSET';
export const FORM_REV = 'Update Form: Agustus 2026';

export const PENTING = [
  { n: '1', lines: ['Kode Bahaya AA = Unit harus diperbaiki sebelum dioperasikan (STOP OPERASI)', 'Kode Bahaya A = Kerusakan yang harus diperbaiki dalam waktu 1 x 12-jam'] },
  { n: '2', lines: ['Form inspeksi harus diserahkan ke pengawas di awal shift dan dilengkapi dengan tanda tangan'] },
  { n: '3', lines: ['Mengoperasikan alat dengan kerusakan AA, akan dikenai sanksi sesuai peraturan perusahaan'] },
];

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** Semua yang dibutuhkan pembuat PDF / Word / Excel untuk SATU form P2H. */
export async function formExportData(id) {
  const d = await loadForm(id);
  if (!d) return null;
  const f = d.form;

  const findings = [];
  for (const s of d.sections) {
    for (const it of s.items) {
      if (it.condition === 'baik') continue;
      findings.push({
        code: it.danger_code,
        text: plain(it.item_text),
        condition: CONDITION_LABEL[it.condition],
        note: it.note || '',
        status: FIX_LABEL[it.fix_status] || '',
        fix_status: it.fix_status,
        fix_note: it.fix_note || '',
        fix_by: it.fix_by_name || '',
        fix_at: it.fix_at ? stampWITA(it.fix_at) : '',
        section: s.title,
      });
    }
  }

  const noUnit = f.unit_old_code ? `${f.unit_code} (${f.unit_old_code})` : f.unit_code;
  const filename = `P2H_${fileSafe(f.unit_code)}_${f.shift_date}_Shift${shiftLabel(f.shift)}`;

  return {
    filename,
    form: f,
    header: {
      nama: f.inspector_name,
      hari_tgl: `${dayNameID(f.shift_date)} ${shortDate(f.shift_date)}`,
      shift: shiftLabel(f.shift),
      lokasi: f.location || '',
      job_site: f.job_site || '',
      model_unit: [f.unit_brand, f.unit_model].filter(Boolean).join(' ').toUpperCase(),
      no_unit: noUnit,
      hm_awal: fmtNum(f.hm_start),
      hm_akhir: fmtNum(f.hm_end),
      site: f.site_name,
    },
    sections: d.sections.map((s) => ({
      code: s.code,
      title: s.title,
      items: s.items.map((it) => ({
        no: it.item_no,
        text: it.item_text, // masih berisi tanda ** (tebal)
        danger: it.danger_code,
        condition: it.condition,
        note: it.note || '',
        hint: it.hint || '',
      })),
    })),
    params: d.params.map((p) => ({
      label: p.label,
      unit: p.unit,
      idle: fmtNum(p.idle),
      load: fmtNum(p.load),
      idle_n: p.idle,
      load_n: p.load,
    })),
    notes: f.notes || '',
    findings,
    result: f.result,
    result_label: RESULT_LABEL[f.result],
    sign_mek: {
      name: f.inspector_name,
      nrp: f.inspector_nrp || '',
      img: pngBuffer(f.signature_png),
      at: stampWITA(f.filled_at || f.submitted_at),
    },
    sign_sup: f.sup_signed_at
      ? { name: f.sup_name, nrp: f.sup_nrp || '', img: pngBuffer(f.sup_signature_png), at: stampWITA(f.sup_signed_at) }
      : null,
    stamp: stampWITA(f.filled_at || f.submitted_at),
    long_date: longDate(f.shift_date),
    logos: { berau: asset('berau-lockup.png'), mtl: asset('mtl-logo.png') },
  };
}

/** Deskripsi filter untuk judul rekap. */
export function describeFilter(q, lookups = {}) {
  const parts = [];
  if (q.from || q.to) parts.push(`Periode ${q.from ? longDate(q.from) : '…'} s.d. ${q.to ? longDate(q.to) : '…'}`);
  if (q.site_id && lookups.siteName) parts.push(`Site ${lookups.siteName}`);
  if (q.unit_id && lookups.unitCode) parts.push(`Unit ${lookups.unitCode}`);
  if (q.shift) parts.push(`Shift ${shiftLabel(q.shift)}`);
  if (q.result) parts.push(`Hasil: ${RESULT_LABEL[q.result] || q.result}`);
  return parts.length ? parts.join(' · ') : 'Semua data';
}
