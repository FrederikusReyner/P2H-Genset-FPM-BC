// Rekap Excel ala "PMMR DATA GENSET ALL SITE": lembar STATUS GENSET, DATA, PH, dan HM.
// Dibuat dari data aplikasi (unit, P2H, HM bulanan, kWh bulanan). Susunan dan gaya mengikuti Excel contoh PMMR.
import ExcelJS from 'exceljs';
import { longDate, wita } from '../../time.js';
import { asset, imageSize } from '../export/common.js';
import { barChartXml, injectCharts } from './charts.js';
import { SITE_ORDER, loadPmmrData } from './data.js';

const BULAN = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
const TNR = 'Times New Roman';
const BLACK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF548235' } };
const LIGHT_GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const ORANGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const medium = { style: 'medium', color: { argb: 'FF000000' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const NUM2 = '#,##0.00';
const DATEFMT = 'd-mmm-yyyy';

const colL = (n) => {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};
const ref = (r, c) => `${colL(c)}${r}`;
const q = (name) => (/^[A-Za-z0-9_]+$/.test(name) ? name : `'${name}'`);

const STATUS_TEXT = { running: 'RUNNING', standby: 'STANDBY', breakdown: 'BREAKDOWN', inactive: 'TIDAK AKTIF' };
const statusOf = (u) => (u.pmmr_group === 'arsip' ? u.pmmr_status || 'BREAKDOWN' : STATUS_TEXT[u.status] || String(u.status).toUpperCase());
const isRed = (s) => /BREAKDOWN|W\/O|SCRAP|PROPOSE/i.test(s || '');

/** Teks tanggal ISO (YYYY-MM-DD) -> Date; selain itu apa adanya. */
function dateOrText(v) {
  if (v === null || v === undefined || v === '') return { value: null };
  if (v instanceof Date) return { value: v, fmt: DATEFMT };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (m) return { value: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), fmt: DATEFMT };
  return { value: String(v) };
}
const n = (v) => (v === null || v === undefined ? null : Number(v));

function headCell(c, text, o = {}) {
  if (text !== undefined) c.value = text; // sel yang ikut digabung: jangan ditulis ulang (nilai sel induk bisa hilang)
  c.font = { name: TNR, size: o.size || 11, bold: o.bold ?? false, color: { argb: 'FFFFFFFF' } };
  c.fill = o.fill || BLACK;
  c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  c.border = BORDER;
}
function merge(ws, r1, c1, r2, c2) {
  if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
}
function headRange(ws, r1, c1, r2, c2, text, o) {
  merge(ws, r1, c1, r2, c2);
  for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) headCell(ws.getCell(r, c), r === r1 && c === c1 ? text : undefined, o);
}
function body(c, o = {}) {
  c.font = { name: TNR, size: 10, bold: !!o.bold, color: o.red ? { argb: 'FFFF0000' } : undefined };
  c.border = o.border || BORDER;
  c.alignment = { horizontal: o.h, vertical: o.v || 'middle', wrapText: !!o.wrap };
  if (o.fmt) c.numFmt = o.fmt;
  if (o.fill) c.fill = o.fill;
}

/* ====================================================================================== */

export async function buildPmmrXlsx(filters, user) {
  const t = wita();
  const year = Number(filters?.year) || Number(t.date.slice(0, 4));
  const month = Math.min(12, Math.max(1, Number(filters?.month) || Number(t.date.slice(5, 7))));
  const d = await loadPmmrData(user, year, month);
  const monthName = BULAN[month - 1];
  const prod = d.units.filter((u) => u.pmmr_group === 'produksi');
  const arsip = d.units.filter((u) => u.pmmr_group === 'arsip');
  const siteOf = (u) => u.site_code;
  const sitesPresent = SITE_ORDER.filter((c) => prod.some((u) => siteOf(u) === c));
  const siteName = (code) => (d.sites.find((s) => s.code === code)?.name || code).toUpperCase();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'P2H Genset';
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const wsStatus = wb.addWorksheet('STATUS GENSET', { views: [{ showGridLines: false, zoomScale: 85 }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const wsData = wb.addWorksheet('DATA', { views: [{ showGridLines: false, zoomScale: 90, state: 'frozen', xSplit: 5, ySplit: 7 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const wsPh = wb.addWorksheet('PH', { views: [{ showGridLines: false, zoomScale: 80 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const wsHm = wb.addWorksheet('HM', { views: [{ showGridLines: false, zoomScale: 80, state: 'frozen', xSplit: 1, ySplit: 5 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });

  /* ------------------------------------------------------------------ HM (dibuat dulu: PH memakai alamat selnya) */
  const hmUnits = [...prod, ...arsip.filter((u) => u.hm.some((x) => x.start !== null || x.end !== null))];
  const hmGroups = [...sitesPresent.map((c) => ({ label: `GENSET ${siteName(c)}`, units: prod.filter((u) => siteOf(u) === c) })), ...(arsip.length && hmUnits.some((u) => u.pmmr_group === 'arsip') ? [{ label: 'ARSIP (NON-PRODUKSI)', units: hmUnits.filter((u) => u.pmmr_group === 'arsip') }] : [])];
  const hmCol = new Map();
  {
    wsHm.getColumn(1).width = 12.2;
    wsHm.getCell('A1').value = `TAHUN ${year}`;
    wsHm.getCell('A1').font = { name: 'Arial Narrow', size: 11, bold: true };
    let c = 2;
    for (const g of hmGroups) {
      const c0 = c;
      for (const u of g.units) {
        hmCol.set(u.id, c);
        c += 2;
      }
      if (c > c0) {
        wsHm.mergeCells(3, c0, 3, c - 1);
        const gc = wsHm.getCell(3, c0);
        gc.value = g.label;
        gc.font = { name: 'Arial Narrow', size: 10, bold: true };
        gc.alignment = { horizontal: 'center' };
      }
    }
    const lastCol = Math.max(c - 1, 3);
    wsHm.mergeCells(2, 1, 2, lastCol);
    const tc = wsHm.getCell('A2');
    tc.value = 'HOURMETER UNIT FIXED PLANT';
    tc.font = { name: 'Arial Narrow', size: 16, bold: true };
    tc.alignment = { horizontal: 'center', vertical: 'middle' };
    const hh = (cell, text) => {
      if (text !== undefined) cell.value = text;
      cell.font = { name: 'Arial Narrow', size: 11, bold: true };
      cell.fill = ORANGE;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER;
    };
    wsHm.mergeCells(4, 1, 5, 1);
    hh(wsHm.getCell(4, 1), 'Month');
    hh(wsHm.getCell(5, 1));
    for (const u of hmUnits) {
      const c1 = hmCol.get(u.id);
      if (!c1) continue;
      wsHm.mergeCells(4, c1, 4, c1 + 1);
      hh(wsHm.getCell(4, c1), u.code);
      hh(wsHm.getCell(4, c1 + 1));
      hh(wsHm.getCell(5, c1), 'HM Awal');
      hh(wsHm.getCell(5, c1 + 1), 'HM Akhir');
      wsHm.getColumn(c1).width = 13;
      wsHm.getColumn(c1 + 1).width = 13;
      for (let m = 1; m <= 12; m += 1) {
        const hm = u.hm[m - 1];
        const a = wsHm.getCell(5 + m, c1);
        const b = wsHm.getCell(5 + m, c1 + 1);
        a.value = hm.start;
        b.value = hm.end;
        for (const x of [a, b]) {
          x.font = { name: 'Arial Narrow', size: 11, bold: m === month };
          x.numFmt = NUM2;
          x.alignment = { vertical: 'middle' };
          x.border = { left: { style: 'hair' }, right: { style: 'hair' }, top: { style: 'hair' }, bottom: { style: 'hair' } };
          if (m === month) x.fill = GREY;
        }
      }
    }
    for (let m = 1; m <= 12; m += 1) {
      const cm = wsHm.getCell(5 + m, 1);
      cm.value = m;
      cm.font = { name: 'Arial Narrow', size: 11, bold: m === month };
      cm.alignment = { horizontal: 'center', vertical: 'middle' };
      cm.border = { left: thin, right: thin, bottom: { style: 'hair' } };
      if (m === month) cm.fill = GREY;
    }
    wsHm.getCell(19, 1).value = 'Sumber: P2H di aplikasi (HM awal / akhir); bulan sebelum aplikasi dipakai dari data impor PMMR. HM awal = HM akhir bulan sebelumnya.';
    wsHm.getCell(19, 1).font = { name: 'Arial Narrow', size: 9, italic: true };
  }

  /* ------------------------------------------------------------------ PH */
  const phRow = new Map(); // unit.id -> nomor baris
  const phBlocks = []; // untuk grafik
  const phCols = [
    ['NO', 5.7], ['SITE', 8.7], ['LOCATION', 20.7], ['OLD REG. CODE', 13.5], ['NEW \nREG. CODE', 14], ['BRAND', 13], ['STATUS', 15.2], ['MODEL', 13], ['CAPACITY \nkVA (PRIME)', 13],
    ['%', 9], ['BASE RATE kW', 10.5], ['AC. LIMIT (KW)', 11], ['AMPERE BASE RATE', 12.5], ['CAP%', 9], ['PREV', 12], ['PRESENT', 12], ['HM', 10], ['kWH', 14], ['Σ Av kWH', 12], ['ACTUAL ABSORB (%)', 14],
  ];
  phCols.forEach(([, w], i) => {
    wsPh.getColumn(i + 1).width = w;
  });
  const lab = (r, text, valueCell) => {
    const a = wsPh.getCell(r, 1);
    a.value = text;
    a.font = { name: 'Arial', size: 10, bold: true };
    a.alignment = { horizontal: 'left' };
    if (valueCell) Object.assign(wsPh.getCell(r, 3), valueCell);
  };
  lab(1, 'DATE :');
  wsPh.getCell('C1').value = new Date(Date.UTC(year, month - 1, d.last_day));
  wsPh.getCell('C1').numFmt = 'mmmm d, yyyy';
  wsPh.getCell('C1').alignment = { horizontal: 'left' };
  lab(2, 'NUMBER DAY :');
  wsPh.getCell('C2').value = { formula: 'DAY(C1)', result: d.last_day };
  lab(3, 'MONTH :');
  wsPh.getCell('C3').value = { formula: 'MONTH(C1)', result: month };
  lab(4, 'TOTAL HOURS :');
  wsPh.getCell('C4').value = { formula: '24*C2', result: 24 * d.last_day };
  for (const r of [2, 3, 4]) wsPh.getCell(r, 3).alignment = { horizontal: 'left' };

  let r = 6;
  const summary = []; // total tiap site untuk grafik ringkasan
  for (const code of sitesPresent) {
    const list = prod.filter((u) => siteOf(u) === code);
    const rh = r;
    phCols.forEach(([label], i) => headCell(wsPh.getCell(rh, i + 1), label, { size: 11 }));
    wsPh.getRow(rh).height = 31;
    const r1 = rh + 1;
    const rN = rh + list.length;
    const rT = rN + 1;
    const sumI = list.reduce((a, u) => a + (n(u.capacity_kva ?? u.alt_base_kva) || 0), 0);
    const sumM = list.reduce((a, u) => a + (n(u.alt_ampere) || 0), 0);
    const rows = [];
    list.forEach((u, i) => {
      const row = r1 + i;
      phRow.set(u.id, row);
      const I = n(u.capacity_kva ?? u.alt_base_kva);
      const K = n(u.alt_base_kw ?? u.rated_kw);
      const M = n(u.alt_ampere);
      const hmc = hmCol.get(u.id);
      const O = u.hm_month.start;
      const P = u.hm_month.end;
      const Q = P != null && O != null ? P - O : 0; // HM bulan ini: kosong bila salah satu pembacaan belum ada
      const R = n(u.kwh);
      const S = Q && R ? R / Q : 0;
      const T = K ? S / K : 0;
      const vals = {
        L: K ? K * 0.8 : null,
        J: sumI ? (I || 0) / sumI : 0,
        N: sumM ? (M || 0) / sumM : 0,
        Q, S, T, I, K, M, O, P, R,
      };
      rows.push({ u, row, ...vals });
      const set = (c, v, o = {}) => {
        const cell = wsPh.getCell(row, c);
        cell.value = v;
        body(cell, { h: o.h, bold: o.bold, fmt: o.fmt, v: 'middle' });
        return cell;
      };
      set(1, i + 1, { h: 'center' });
      if (i === 0 && list.length > 1) wsPh.mergeCells(r1, 2, rN, 2);
      const bc = wsPh.getCell(row, 2);
      body(bc, { h: 'center', bold: true });
      if (i === 0) bc.value = code;
      set(3, u.location || '');
      set(4, u.old_code || 'None');
      set(5, u.code);
      set(6, String(u.brand || '').toUpperCase());
      set(7, statusOf(u), { h: 'center', bold: true }).font = { name: TNR, size: 10, bold: true, color: isRed(statusOf(u)) ? { argb: 'FFFF0000' } : undefined };
      set(8, u.model || '');
      set(9, I, { h: 'left' });
      set(10, { formula: `IFERROR(I${row}/I${rT},0)`, result: vals.J }, { fmt: '0.00%', h: 'left' });
      set(11, K, { h: 'left' });
      set(12, { formula: `K${row}*0.8`, result: vals.L ?? 0 }, { fmt: NUM2, h: 'left' });
      set(13, M, { h: 'left' });
      set(14, { formula: `IFERROR(M${row}/M$${rT},0)`, result: vals.N }, { fmt: '0.00%', h: 'left' });
      if (hmc) {
        set(15, { formula: `IF(HM!${ref(5 + month, hmc)}="","",HM!${ref(5 + month, hmc)})`, result: O ?? '' }, { fmt: NUM2, h: 'center', bold: true });
        set(16, { formula: `IF(HM!${ref(5 + month, hmc + 1)}="","",HM!${ref(5 + month, hmc + 1)})`, result: P ?? '' }, { fmt: NUM2, h: 'center', bold: true });
      } else {
        set(15, O, { fmt: NUM2, h: 'center', bold: true });
        set(16, P, { fmt: NUM2, h: 'center', bold: true });
      }
      set(17, { formula: `IF(OR(O${row}="",P${row}=""),0,P${row}-O${row})`, result: Q }, { fmt: NUM2, h: 'center', bold: true });
      set(18, R, { fmt: NUM2, h: 'right', bold: true });
      set(19, { formula: `IFERROR(R${row}/Q${row},0)`, result: S }, { fmt: NUM2, h: 'right', bold: true });
      set(20, { formula: `IFERROR(S${row}/K${row},0)`, result: T }, { fmt: '0.00%', h: 'right', bold: true });
      wsPh.getRow(row).height = 15;
    });
    // baris total
    const tot = (c, f, res, fmt) => {
      const cell = wsPh.getCell(rT, c);
      cell.value = f ? { formula: f, result: res } : null;
      cell.font = { name: TNR, size: 11, bold: true };
      cell.border = { top: medium, bottom: medium, left: thin, right: thin };
      if (fmt) cell.numFmt = fmt;
      cell.fill = GREY;
      cell.alignment = { horizontal: 'left' };
    };
    for (let c = 1; c <= 20; c += 1) tot(c, null);
    const sumK = rows.reduce((a, x) => a + (x.K || 0), 0);
    const sumL = rows.reduce((a, x) => a + (x.L || 0), 0);
    tot(9, `SUM(I${r1}:I${rN})`, sumI);
    tot(10, `SUM(J${r1}:J${rN})`, sumI ? 1 : 0, '0.00%');
    tot(11, `SUM(K${r1}:K${rN})`, sumK);
    tot(12, `SUM(L${r1}:L${rN})`, sumL, NUM2);
    tot(13, `SUM(M${r1}:M${rN})`, sumM);
    tot(14, `SUM(N${r1}:N${rN})`, sumM ? 1 : 0, '0.00%');
    const active = rows.filter((x) => x.Q > 0);
    const avgT = active.length ? active.reduce((a, x) => a + x.T, 0) / active.length : 0;
    tot(20, `IFERROR(AVERAGEIF(Q${r1}:Q${rN},">0",T${r1}:T${rN}),0)`, avgT, '0.00%');
    phBlocks.push({ code, r1, rN, rT, rh, rows, avgT });
    summary.push({ code, rT, avgT });
    r = rT + 2;
  }

  /* ------------------------------------------------------------------ DATA */
  {
    const COLS = [
      ['no', 5.7], ['site', 8.7], ['location', 15.8], ['old_code', 13.5], ['code', 14], ['status', 22], ['remark', 40], ['hm', 15.7],
      ['brand', 16], ['made_in', 10.7], ['model', 14], ['serial_no', 22], ['capacity_kva', 12], ['weight_kg', 10],
      ['engine_model', 18], ['engine_serial_no', 16], ['engine_hp', 9], ['engine_rpm', 9],
      ['alt_brand', 14], ['alt_made_in', 11], ['alt_type', 18], ['alt_serial_no', 16], ['alt_phase', 7], ['alt_freq', 7], ['alt_base_kva', 10],
      ['alt_base_kw', 10], ['alt_voltage', 10], ['alt_ampere', 10], ['alt_cos_phi', 7], ['alt_rpm', 9], ['alt_avr', 11],
      ['_gap', 2], ['purchase_year', 16], ['po_number', 18], ['recommendation', 34], ['goh_total', 9], ['goh_po_pi', 16],
      ['g1y', 12], ['g1l', 22], ['g1h', 10], ['g2y', 12], ['g2l', 22], ['g2h', 10], ['g3y', 12], ['g3l', 22], ['g3h', 10],
    ];
    COLS.forEach(([, w], i) => {
      wsData.getColumn(i + 1).width = w;
    });
    // logo + judul
    const logo = asset('berau-lockup.png');
    if (logo) {
      const sz = imageSize(logo) || { w: 3, h: 1 };
      const h = 44;
      const id = wb.addImage({ buffer: logo, extension: 'png' });
      wsData.addImage(id, { tl: { col: 0.15, row: 0.2 }, ext: { width: Math.round((sz.w / sz.h) * h), height: h } });
    }
    wsData.mergeCells(2, 1, 2, 18);
    const ttl = wsData.getCell('A2');
    ttl.value = 'PREVIEW GENSET PRODUKSI PT. BERAU COAL';
    ttl.font = { name: 'Calibri', size: 18, bold: true };
    ttl.alignment = { horizontal: 'center' };
    wsData.mergeCells(3, 1, 3, 18);
    const sub = wsData.getCell('A3');
    sub.value = `Last Update : ${longDate(t.date)}  ·  Rekap bulan ${monthName.charAt(0) + monthName.slice(1).toLowerCase()} ${year}${d.scope != null ? `  ·  Site ${siteName(prod[0]?.site_code || '')}` : ''}`;
    sub.font = { name: 'Calibri', size: 10, bold: true };
    sub.alignment = { horizontal: 'center' };

    headRange(wsData, 5, 1, 5, 5, 'GENSET TAG');
    headRange(wsData, 5, 6, 7, 6, 'STATUS', { bold: true });
    headRange(wsData, 5, 7, 7, 7, 'REMARK');
    headRange(wsData, 5, 8, 7, 8, 'HOURS METER');
    headRange(wsData, 5, 9, 5, 14, 'GENSET SPECIFICATION');
    headRange(wsData, 5, 15, 5, 18, 'ENGINE SPESIFICATION');
    headRange(wsData, 5, 19, 5, 31, 'ALTERNATOR / GENERATOR SPESIFICATION');
    headRange(wsData, 5, 33, 7, 33, 'TAHUN PEMBELIAN');
    headRange(wsData, 5, 34, 7, 34, 'PO NUMBER');
    headRange(wsData, 5, 35, 7, 35, 'RECOMMENDATION');
    headRange(wsData, 5, 36, 5, 46, 'HISTORICAL OVERHAUL');
    const two = [
      [1, 'NO'], [2, 'SITE'], [3, 'LOCATION'], [4, 'OLD REG. CODE'], [5, 'NEW \nREG. CODE'],
      [9, 'BRAND'], [10, 'MADE IN'], [11, 'MODEL'], [12, 'SERIAL \nNUMBER'], [13, 'CAPACITY kVA (PRIME)'], [14, 'WEIGHT (KG)'],
      [15, 'ENGINE MODEL'], [16, 'SERIAL NUMBER'], [17, 'DAYA (HP)'], [18, 'SPEED (RPM)'],
      [19, 'BRAND'], [20, 'MADE IN'], [21, 'TYPE (FRAME CORE)'], [22, 'SERIAL NUMBER'], [23, 'PHASE'], [24, 'FREQ'], [25, 'BASE RATE Kva'], [26, 'BASE RATE kW'],
      [27, 'VOLTAGE (VAC)'], [28, 'AMPERE BASE RATE'], [29, 'COS θ'], [30, 'SPEED ( RPM )'], [31, 'TYPE AVR'], [36, 'GOH TOTAL'], [37, 'PO/PI'],
    ];
    for (const [c, text] of two) headRange(wsData, 6, c, 7, c, text);
    for (const [c, text] of [[38, '1'], [41, '2'], [44, '3']]) headRange(wsData, 6, c, 6, c + 2, text);
    for (const c of [38, 41, 44]) {
      headCell(wsData.getCell(7, c), 'THN');
      headCell(wsData.getCell(7, c + 1), 'LOCATION');
      headCell(wsData.getCell(7, c + 2), 'HM');
    }

    let row = 8;
    const writeUnit = (u, o) => {
      const g = u.goh_history || [];
      const cells = {
        1: o.no, 3: o.location ?? u.location, 4: u.old_code, 5: u.code, 6: statusOf(u), 7: o.remark ?? u.remark, 9: u.brand, 10: u.made_in, 11: u.model, 12: u.serial_no,
        13: n(u.capacity_kva), 14: n(u.weight_kg), 15: u.engine_model, 16: u.engine_serial_no, 17: n(u.engine_hp), 18: n(u.engine_rpm),
        19: u.alt_brand, 20: u.alt_made_in, 21: u.alt_type, 22: u.alt_serial_no, 23: n(u.alt_phase), 24: n(u.alt_freq), 25: n(u.alt_base_kva), 26: n(u.alt_base_kw),
        27: n(u.alt_voltage), 28: n(u.alt_ampere), 29: n(u.alt_cos_phi), 30: n(u.alt_rpm), 31: u.alt_avr,
        34: u.po_number, 35: u.recommendation, 36: u.goh_total, 37: u.goh_po_pi,
      };
      for (let c = 1; c <= 46; c += 1) {
        const cell = wsData.getCell(row, c);
        if (c === 8) {
          const pr = phRow.get(u.id);
          if (pr && u.pmmr_group === 'produksi') cell.value = { formula: `IF(PH!P${pr}="","",PH!P${pr})`, result: u.hm_month.end ?? '' };
          else cell.value = u.pmmr_group === 'arsip' ? n(u.hm_master) : u.hm_month.end;
          body(cell, { h: 'center', bold: true, fmt: NUM2 });
        } else if (c === 6) {
          cell.value = cells[6];
          body(cell, { h: 'center', bold: true, red: isRed(cells[6]), wrap: true });
        } else if (c === 33) {
          const dt = dateOrText(u.purchase_year);
          cell.value = dt.value;
          body(cell, { fmt: dt.fmt, h: 'left' });
        } else if (c >= 38 && c <= 46) {
          const gi = Math.floor((c - 38) / 3);
          const part = (c - 38) % 3;
          const gg = g[gi] || {};
          if (part === 0) {
            const dt = dateOrText(gg.year);
            cell.value = dt.value;
            body(cell, { fmt: dt.fmt, h: 'left' });
          } else if (part === 1) {
            cell.value = gg.location || null;
            body(cell, {});
          } else {
            cell.value = n(gg.hm);
            body(cell, { fmt: NUM2, h: 'right' });
          }
        } else if (c === 2) {
          body(cell, { h: 'center', bold: true });
        } else if (c === 32) {
          body(cell, { border: {} });
        } else {
          cell.value = cells[c] ?? null;
          body(cell, { h: c === 1 ? 'center' : typeof cells[c] === 'number' ? 'left' : undefined, wrap: c === 7 || c === 35 });
        }
      }
    };
    // 1. unit produksi, dikelompokkan per site (kolom SITE digabung)
    let no = 0;
    for (const code of sitesPresent) {
      const list = prod.filter((u) => siteOf(u) === code);
      const r0 = row;
      for (const u of list) {
        no += 1;
        writeUnit(u, { no });
        row += 1;
      }
      if (list.length) {
        if (list.length > 1) wsData.mergeCells(r0, 2, row - 1, 2);
        wsData.getCell(r0, 2).value = code;
      }
    }
    // 2. daftar BIB
    const bib = d.units.filter((u) => /^BIB-/i.test(u.code));
    if (bib.length) {
      row += 2;
      wsData.getCell(row, 1).value = 'BIB';
      wsData.getCell(row, 1).font = { name: 'Calibri', size: 11, bold: true };
      row += 1;
      bib.forEach((u, i) => {
        writeUnit(u, { no: i + 1, location: u.bib_location || u.location, remark: 'FORM BIB' });
        row += 1;
      });
    }
    // 3. unit arsip (hanya admin)
    if (arsip.length) {
      row += 2;
      wsData.getCell(row, 1).value = 'BREAKDOWN & GOH';
      wsData.getCell(row, 1).font = { name: 'Calibri', size: 11, bold: true };
      row += 1;
      arsip.forEach((u, i) => {
        writeUnit(u, { no: i + 1 });
        row += 1;
      });
    }
  }

  /* ------------------------------------------------------------------ STATUS GENSET */
  const charts = [];
  const todayMs = Date.UTC(Number(t.date.slice(0, 4)), Number(t.date.slice(5, 7)) - 1, Number(t.date.slice(8, 10)));
  {
    const widths = { 1: 2, 2: 14, 3: 15, 4: 16, 5: 30, 6: 2, 7: 32, 8: 14, 9: 3, 10: 3, 11: 14, 12: 15, 13: 16, 14: 30, 15: 2, 16: 32, 17: 14 };
    Object.entries(widths).forEach(([c, w]) => {
      wsStatus.getColumn(Number(c)).width = w;
    });
    wsStatus.mergeCells(1, 2, 1, 8);
    const h1 = wsStatus.getCell('B1');
    h1.value = `STATUS GENSET · ${monthName} ${year}`;
    h1.font = { name: TNR, size: 16, bold: true };
    // dua kolom blok: kiri (B..H) dan kanan (K..Q)
    const grid = [];
    for (let i = 0; i < sitesPresent.length; i += 2) grid.push([sitesPresent[i], sitesPresent[i + 1] || null]);
    let rowStart = 3;
    const CH = 18; // tinggi grafik (baris)
    const ph = new Map(phBlocks.map((b) => [b.code, b]));
    for (const pair of grid) {
      let used = 0;
      pair.forEach((code, side) => {
        if (!code) return;
        const c0 = side === 0 ? 2 : 11;
        const list = prod.filter((u) => siteOf(u) === code);
        const hr = rowStart + CH + 1;
        // judul tabel
        const heads = ['NEW \nREG. CODE', 'BRAND', 'STATUS', 'ISSUE'];
        heads.forEach((h, i) => {
          wsStatus.mergeCells(hr, c0 + i, hr + 1, c0 + i);
          for (const rr of [hr, hr + 1]) headCell(wsStatus.getCell(rr, c0 + i), rr === hr ? h : undefined, { fill: GREEN });
        });
        wsStatus.mergeCells(hr, c0 + 5, hr, c0 + 6);
        headCell(wsStatus.getCell(hr, c0 + 5), 'SKO', { fill: GREEN, bold: true });
        headCell(wsStatus.getCell(hr, c0 + 6), undefined, { fill: GREEN });
        headCell(wsStatus.getCell(hr + 1, c0 + 5), 'Date Expired', { fill: GREEN, bold: true });
        headCell(wsStatus.getCell(hr + 1, c0 + 6), 'Days remaining', { fill: GREEN, bold: true });
        headCell(wsStatus.getCell(hr, c0 + 4), undefined, { fill: GREEN });
        list.forEach((u, i) => {
          const rr = hr + 2 + i;
          const put = (off, v, o = {}) => {
            const cell = wsStatus.getCell(rr, c0 + off);
            cell.value = v;
            cell.font = { name: TNR, size: 10, bold: !!o.bold, color: o.red ? { argb: 'FFFF0000' } : undefined };
            cell.fill = LIGHT_GREEN;
            cell.alignment = { horizontal: o.h, vertical: 'middle' };
            if (o.fmt) cell.numFmt = o.fmt;
            return cell;
          };
          const st = statusOf(u);
          put(0, u.code);
          put(1, String(u.brand || '').toUpperCase());
          put(2, st, { bold: true, h: 'center', red: isRed(st) });
          put(3, u.issue || null, { h: 'center' });
          put(4, null);
          if (u.sko_expiry) {
            const ds = String(u.sko_expiry).slice(0, 10);
            const dt = new Date(`${ds}T00:00:00Z`);
            put(5, dt, { h: 'center', fmt: 'dddd, mmmm dd, yyyy' });
            const dateRef = ref(rr, c0 + 5);
            put(6, { formula: `-(TODAY()-${dateRef})`, result: Math.round((dt.getTime() - todayMs) / 86400000) }, { h: 'center', bold: true, fmt: '0' });
          } else {
            put(5, u.sko_note || null, { h: 'center' });
            put(6, null);
          }
        });
        used = Math.max(used, CH + 1 + 2 + list.length + 2);
        // grafik
        const b = ph.get(code);
        if (b) {
          const cats = b.rows.map((x) => x.u.code);
          charts.push({
            c1: c0 - 1, r1: rowStart - 1, c2: c0 + 6, r2: rowStart - 1 + CH,
            xml: barChartXml({
              title: `GENSET ${siteName(code)}`,
              subtitle: monthName,
              cats: { ref: `PH!$E$${b.r1}:$E$${b.rN}`, values: cats },
              series: [
                { nameRef: `PH!$L$${b.rh}`, name: 'AC. LIMIT (KW)', ref: `PH!$L$${b.r1}:$L$${b.rN}`, values: b.rows.map((x) => x.L ?? 0), color: '4472C4' },
                { nameRef: `PH!$R$${b.rh}`, name: 'kWH', ref: `PH!$R$${b.r1}:$R$${b.rN}`, values: b.rows.map((x) => x.R ?? 0), color: 'ED7D31' },
                { nameRef: `PH!$S$${b.rh}`, name: 'Σ Av kWH', ref: `PH!$S$${b.r1}:$S$${b.rN}`, values: b.rows.map((x) => x.S ?? 0), color: 'A5A5A5' },
              ],
            }),
          });
        }
      });
      rowStart += used;
    }
  }

  // grafik ringkasan di lembar PH: serapan sebenarnya dibanding kapasitas (name plate) per site
  const phCharts = [];
  if (phBlocks.length) {
    phCharts.push({
      c1: 21, r1: 5, c2: 29, r2: 24,
      xml: barChartXml({
        title: 'ACTUAL ABSORB VS TOTAL CAPACITY (NAME PLATE)',
        subtitle: monthName,
        percent: true,
        cats: { ref: `PH!$B$${phBlocks[0].r1}:$B$${phBlocks[0].r1}`, values: phBlocks.map((b) => b.code) },
        series: [
          { nameRef: 'PH!$T$6', name: 'ACTUAL ABSORB (%)', ref: `PH!$T$${phBlocks[0].rT}:$T$${phBlocks[0].rT}`, values: phBlocks.map((b) => b.avgT), color: 'ED7D31', fmt: '0%' },
        ],
      }),
    });
  }
  // rujukan grafik ringkasan memakai gabungan sel total tiap site
  if (phCharts.length) {
    const cats = phBlocks.map((b) => `PH!$B$${b.r1}`).join(',');
    const vals = phBlocks.map((b) => `PH!$T$${b.rT}`).join(',');
    phCharts[0].xml = phCharts[0].xml.replace(/PH!\$B\$\d+:\$B\$\d+/, `(${cats})`).replace(/PH!\$T\$\d+:\$T\$\d+/, `(${vals})`);
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const finalBuf = await injectCharts(buf, [
    { sheetName: 'STATUS GENSET', charts },
    { sheetName: 'PH', charts: phCharts },
  ]);
  const only = d.scope != null ? `_${(d.sites.find((s) => s.id === d.scope)?.name || 'Site').replace(/[^A-Za-z0-9]+/g, '')}` : '_ALL_SITE';
  return { buffer: finalBuf, filename: `PMMR_${year}.${String(month).padStart(2, '0')}_DATA_GENSET${only}.xlsx`, summary: { year, month, units: d.units.length, produksi: prod.length, arsip: arsip.length } };
}
