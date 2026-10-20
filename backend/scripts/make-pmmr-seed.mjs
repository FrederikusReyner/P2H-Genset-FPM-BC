// Membuat backend/seed/pmmr.json dari berkas Excel PMMR (lembar DATA, STATUS GENSET, HM).
// Dipakai sekali untuk data awal; bisa dijalankan lagi dengan berkas PMMR yang lebih baru:
//   node scripts/make-pmmr-seed.mjs "D:\...\PMMR_2026.09_13 DATA GENSET ALL SITE.XLSX" [seed/pmmr.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const file = process.argv[2];
const out = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'seed', 'pmmr.json');
if (!file) {
  console.error('Pemakaian: node scripts/make-pmmr-seed.mjs <berkas PMMR .xlsx> [keluaran .json]');
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

/* ---------- pembaca nilai sel ---------- */
const raw = (cell) => {
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map((t) => t.text).join('');
    else if ('error' in v) v = null;
    else if ('text' in v) v = v.text;
  }
  if (v && typeof v === 'object' && !(v instanceof Date)) v = null;
  return v ?? null;
};
const iso = (d) => d.toISOString().slice(0, 10);
const serial = (n) => new Date(Math.round((n - 25569) * 86400 * 1000));
const text = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return iso(v);
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' || s === '`' || s === '-' || s.startsWith('#') ? null : s;
};
const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) && /^[-\d.,\s]+$/.test(v) ? n : null;
  }
  return null;
};
/** tanggal atau tahun: Date -> YYYY-MM-DD, angka tanggal Excel -> YYYY-MM-DD, tahun -> "2017", teks apa adanya */
const when = (v) => {
  if (v instanceof Date) return iso(v);
  if (typeof v === 'number') return v > 3000 ? iso(serial(v)) : String(Math.trunc(v));
  return text(v);
};
const normCode = (v) => {
  let s = text(v);
  if (!s) return null;
  const m = /^(BC-GE-P|BIB-GE-P)\s*-?\s*(\w+)\s*$/i.exec(s);
  if (m) s = `${m[1].toUpperCase()}-${/^\d+$/.test(m[2]) ? m[2].padStart(2, '0') : m[2]}`;
  return s;
};
const isCode = (s) => !!s && /^(BC|BIB)-GE-P-/i.test(s);

const SITE_BY_WORD = [
  [/LMO|LATI/i, 'LMO'],
  [/BINUNGAN|BIB TO BIN/i, 'BMO'],
  [/SUARAN/i, 'SRN'],
  [/SAMBARATA/i, 'SMO'],
  [/GURIMBANG/i, 'GMO'],
];
const siteOf = (loc) => (SITE_BY_WORD.find(([re]) => re.test(loc || '')) || [null, 'LMO'])[1];

/* ---------- lembar DATA ---------- */
const data = wb.getWorksheet('DATA');
if (!data) throw new Error('Lembar DATA tidak ditemukan');
const cell = (ws, r, c) => raw(ws.getCell(r, c));
const units = [];
const bibLoc = new Map();
let section = 'produksi';
let sort = 0;
for (let r = 8; r <= Math.min(data.rowCount, 120); r += 1) {
  const a = text(cell(data, r, 1));
  if (a && /^BIB$/i.test(a)) {
    section = 'bib';
    continue;
  }
  if (a && /^BREAKDOWN/i.test(a)) {
    section = 'arsip';
    continue;
  }
  const code = normCode(cell(data, r, 5));
  if (!isCode(code)) continue;
  if (section === 'bib') {
    bibLoc.set(code, text(cell(data, r, 3))); // lokasi di daftar BIB (mis. "BIB TO BIN"), dipasang ke unitnya di bawah
    continue;
  }
  sort += 1;
  const goh = [];
  for (const [cy, cl, ch] of [[38, 39, 40], [41, 42, 43], [44, 45, 46]]) {
    const y = when(cell(data, r, cy));
    const l = text(cell(data, r, cl));
    const h = num(cell(data, r, ch));
    if (y || l || h !== null) goh.push({ year: y, location: l, hm: h });
  }
  const location = text(cell(data, r, 3));
  units.push({
    code,
    group: section === 'arsip' ? 'arsip' : 'produksi',
    sort,
    site_code: text(cell(data, r, 2)) || null,
    old_code: text(cell(data, r, 4)),
    location,
    pmmr_status: text(cell(data, r, 6)),
    remark: text(cell(data, r, 7)),
    hm: num(cell(data, r, 8)),
    brand: text(cell(data, r, 9)),
    made_in: text(cell(data, r, 10)),
    model: text(cell(data, r, 11)),
    serial_no: text(cell(data, r, 12)),
    capacity_kva: num(cell(data, r, 13)),
    weight_kg: num(cell(data, r, 14)),
    engine_model: text(cell(data, r, 15)),
    engine_serial_no: text(cell(data, r, 16)),
    engine_hp: num(cell(data, r, 17)),
    engine_rpm: num(cell(data, r, 18)),
    alt_brand: text(cell(data, r, 19)),
    alt_made_in: text(cell(data, r, 20)),
    alt_type: text(cell(data, r, 21)),
    alt_serial_no: text(cell(data, r, 22)),
    alt_phase: num(cell(data, r, 23)),
    alt_freq: num(cell(data, r, 24)),
    alt_base_kva: num(cell(data, r, 25)),
    alt_base_kw: num(cell(data, r, 26)),
    alt_voltage: num(cell(data, r, 27)),
    alt_ampere: num(cell(data, r, 28)),
    alt_cos_phi: num(cell(data, r, 29)),
    alt_rpm: num(cell(data, r, 30)),
    alt_avr: text(cell(data, r, 31)),
    purchase_year: when(cell(data, r, 33)),
    po_number: text(cell(data, r, 34)),
    recommendation: text(cell(data, r, 35)),
    goh_total: text(cell(data, r, 36)),
    goh_po_pi: text(cell(data, r, 37)),
    goh_history: goh,
  });
}
for (const [code, loc] of bibLoc) {
  const u = units.find((x) => x.code === code);
  if (u) u.bib_location = loc;
}
const pmmrUnits = units;

/* ---------- lembar STATUS GENSET: issue + SKO ---------- */
const st = wb.getWorksheet('STATUS GENSET');
const sko = new Map();
if (st) {
  for (let r = 1; r <= st.rowCount; r += 1) {
    for (const [cc, cb, cs, ci, ce] of [[2, 3, 4, 5, 7], [11, 12, 13, 14, 16]]) {
      const code = normCode(cell(st, r, cc));
      if (!isCode(code)) continue;
      const exp = cell(st, r, ce);
      const entry = { issue: text(cell(st, r, ci)) };
      if (exp instanceof Date) entry.sko_expiry = iso(exp);
      else if (typeof exp === 'number' && exp > 30000) entry.sko_expiry = iso(serial(exp));
      else if (text(exp)) entry.sko_note = text(exp);
      sko.set(code, { ...(sko.get(code) || {}), ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v)) });
    }
  }
}
for (const u of pmmrUnits) Object.assign(u, sko.get(u.code) || {});

/* ---------- lembar HM: blok tahun terakhir (HM awal / HM akhir per bulan) ---------- */
const hm = wb.getWorksheet('HM');
const hmRows = [];
let header = null;
if (hm) {
  // baris judul terakhir: kolom A berisi "Month" dan kolom B berisi kode unit (baris di bawahnya berisi "HM Awal" / "HM Akhir")
  for (let r = 1; r <= hm.rowCount; r += 1) if (text(cell(hm, r, 1)) === 'Month' && isCode(normCode(cell(hm, r, 2)))) header = r;
}
const year = Number((/(\d{4})\.\d{2}/.exec(path.basename(file)) || [])[1]) || new Date().getFullYear();
const month = Number((/\d{4}\.(\d{2})/.exec(path.basename(file)) || [])[1]) || 12;
if (header) {
  for (let c = 2; c <= hm.columnCount; c += 1) {
    const code = normCode(cell(hm, header, c));
    if (!isCode(code) || text(cell(hm, header + 1, c)) !== 'HM Awal') continue;
    for (let m = 1; m <= month; m += 1) {
      let rowOfMonth = null;
      for (let r = header + 2; r <= header + 16; r += 1) if (num(cell(hm, r, 1)) === m) { rowOfMonth = r; break; }
      if (!rowOfMonth) continue;
      const hs = num(cell(hm, rowOfMonth, c));
      const he = num(cell(hm, rowOfMonth, c + 1));
      if (hs === null && he === null) continue;
      hmRows.push({ code, year, month: m, hm_start: hs, hm_end: he });
    }
  }
}

const result = {
  sumber: path.basename(file),
  dibuat: new Date().toISOString().slice(0, 10),
  last_update: text(cell(data, 3, 1)),
  year,
  month,
  units: pmmrUnits,
  hm_monthly: hmRows,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`, 'utf8');
console.log(`unit: ${result.units.length} (produksi ${result.units.filter((u) => u.group === 'produksi').length}, arsip ${result.units.filter((u) => u.group === 'arsip').length}), HM bulanan: ${hmRows.length}, SKO: ${sko.size}`);
console.log(`ditulis ke ${out}`);
