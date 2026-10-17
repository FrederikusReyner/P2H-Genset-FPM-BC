import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  AlignmentType, BorderStyle, Document, HeightRule, ImageRun, Packer, PageOrientation, Paragraph, ShadingType, Table,
  TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { query } from '../../db.js';
import { scopeOf } from '../../middleware/auth.js';
import { buildListFilter, LIST_COLS } from '../../routes/p2h.js';
import { CONDITION_LABEL, FIX_LABEL, RESULT_LABEL, plain } from '../../text.js';
import {
  PERIODS, PERIOD_LABEL, addDays, currentShift, dayNameID, dayShort, daysBetween, longDate, monthShort, periodRange,
  periodTitle, rangeShort, shiftLabel, shortDate, stampWITA, weekdayIndex, wita,
} from '../../time.js';
import { getSettings } from '../settings.js';
import { asset, fmtNum } from './common.js';

const LIMITS = {
  xlsx: { forms: 20000, findings: 20000 },
  doc: { forms: 3000, findings: 600 }, // PDF / Word: dibatasi supaya tetap enak dibaca
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

/** Perkiraan jumlah P2H yang seharusnya masuk pada rentang itu (genset jalan / standby x shift yang sudah mulai). */
async function expectedForms(q, user, from, to) {
  const scope = scopeOf(user);
  const where = ["status IN ('running','standby')"];
  const p = [];
  if (q.unit_id && Number(q.unit_id)) {
    p.push(Number(q.unit_id));
    where.push(`id = $${p.length}`);
  }
  if (scope != null) {
    p.push(scope);
    where.push(`site_id = $${p.length}`);
  } else if (q.site_id && Number(q.site_id)) {
    p.push(Number(q.site_id));
    where.push(`site_id = $${p.length}`);
  }
  const units = (await query(`SELECT count(*)::int AS n FROM units WHERE ${where.join(' AND ')}`, p)).rows[0].n;
  const settings = await getSettings();
  const cur = currentShift(new Date(), settings.shift1_start, settings.shift2_start);
  const end = to && to < cur.shift_date ? to : cur.shift_date;
  if (!from || from > end) return 0;
  const only = [1, 2].includes(Number(q.shift)) ? Number(q.shift) : null;
  let n = 0;
  const days = daysBetween(from, end) + 1;
  for (let i = 0; i < days; i += 1) {
    const d = addDays(from, i);
    const due = d < cur.shift_date ? [1, 2] : cur.shift === 2 ? [1, 2] : [1];
    n += only ? (due.includes(only) ? 1 : 0) : due.length;
  }
  return units * n;
}

const zero = () => ({ total: 0, baik: 0, temuan: 0, stop: 0, verified: 0 });
function add(e, r) {
  e.total += r.total;
  e.baik += r.baik;
  e.temuan += r.temuan;
  e.stop += r.stop;
  e.verified += r.verified;
  return e;
}

/** Susun baris rincian per hari / minggu / bulan dari hitungan harian. */
function makeBuckets(period, from, to, byDay) {
  const map = new Map(byDay.map((r) => [r.d, r]));
  const rows = [];
  let unit = 'Hari';
  const days = from && to ? daysBetween(from, to) + 1 : 0;
  const mode = period === 'year' ? 'month' : period === 'month' ? 'week' : period === 'week' ? 'day' : days > 0 && days <= 31 ? 'day' : days > 0 && days <= 120 ? 'week' : 'month';
  if (mode === 'day') {
    for (let i = 0; i < days; i += 1) {
      const d = addDays(from, i);
      rows.push({ label: dayShort(d), ...add(zero(), map.get(d) || zero()) });
    }
  } else if (mode === 'week') {
    unit = 'Minggu';
    let start = from;
    let n = 0;
    while (start <= to) {
      const monday = addDays(start, -weekdayIndex(start));
      const end = addDays(monday, 6) < to ? addDays(monday, 6) : to;
      n += 1;
      const e = zero();
      for (let d = start; d <= end; d = addDays(d, 1)) add(e, map.get(d) || zero());
      rows.push({ label: `Minggu ke-${n} (${rangeShort(start, end)})`, ...e });
      start = addDays(end, 1);
    }
  } else {
    unit = 'Bulan';
    const byMonth = new Map();
    for (const r of byDay) byMonth.set(r.d.slice(0, 7), add(byMonth.get(r.d.slice(0, 7)) || zero(), r));
    if (period === 'year') {
      for (let m = 1; m <= 12; m += 1) {
        const key = `${from.slice(0, 4)}-${String(m).padStart(2, '0')}`;
        rows.push({ label: monthShort(key), ...(byMonth.get(key) || zero()) });
      }
    } else {
      for (const key of [...byMonth.keys()].sort()) rows.push({ label: monthShort(key), ...byMonth.get(key) });
    }
  }
  return { unit, rows };
}

/**
 * Ambil data rekap. Penyaring: periode (period = week | month | year + date), atau from / to,
 * site, unit, shift, hasil. Hitungan ringkasan memakai SQL (akurat walau datanya banyak);
 * daftar P2H dan temuan dibatasi jumlahnya.
 * detail = false -> hanya ringkasan (dipakai pratinjau di layar).
 */
export async function loadRekap(q, user, { kind = 'doc', detail = true } = {}) {
  const period = PERIODS.includes(q.period) ? q.period : null;
  let from = isDate(q.from) ? q.from : null;
  let to = isDate(q.to) ? q.to : null;
  if (period) {
    const anchor = isDate(q.date) ? q.date : wita().date;
    ({ from, to } = periodRange(period, anchor));
  }
  const qq = { ...q, from, to };
  const f = buildListFilter(qq, user);
  const lim = LIMITS[kind === 'xlsx' ? 'xlsx' : 'doc'];
  // rincian per P2H tidak dicetak di PDF / Word untuk rekap tahunan (terlalu panjang); Excel tetap lengkap
  const listForms = detail && !(period === 'year' && kind !== 'xlsx');

  const [sumQ, siteQ, dayQ, findQ] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE f.result = 'baik')::int AS baik,
              count(*) FILTER (WHERE f.result = 'temuan_a')::int AS temuan,
              count(*) FILTER (WHERE f.result = 'stop_aa')::int AS stop,
              count(*) FILTER (WHERE f.sup_signed_at IS NOT NULL)::int AS verified
         FROM p2h_forms f ${f.sql}`,
      f.params,
    ),
    query(
      `SELECT f.site_name AS site, s.sort_order,
              count(*)::int AS total,
              count(*) FILTER (WHERE f.result = 'baik')::int AS baik,
              count(*) FILTER (WHERE f.result = 'temuan_a')::int AS temuan,
              count(*) FILTER (WHERE f.result = 'stop_aa')::int AS stop,
              count(*) FILTER (WHERE f.sup_signed_at IS NOT NULL)::int AS verified
         FROM p2h_forms f JOIN sites s ON s.id = f.site_id ${f.sql}
        GROUP BY f.site_name, s.sort_order ORDER BY s.sort_order`,
      f.params,
    ),
    query(
      `SELECT f.shift_date::text AS d,
              count(*)::int AS total,
              count(*) FILTER (WHERE f.result = 'baik')::int AS baik,
              count(*) FILTER (WHERE f.result = 'temuan_a')::int AS temuan,
              count(*) FILTER (WHERE f.result = 'stop_aa')::int AS stop,
              count(*) FILTER (WHERE f.sup_signed_at IS NOT NULL)::int AS verified
         FROM p2h_forms f ${f.sql} GROUP BY f.shift_date ORDER BY f.shift_date`,
      f.params,
    ),
    query(
      `SELECT count(*) FILTER (WHERE a.danger_code = 'AA')::int AS aa,
              count(*) FILTER (WHERE a.danger_code = 'A')::int AS a,
              count(*) FILTER (WHERE a.fix_status = 'closed')::int AS closed,
              count(*)::int AS total
         FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
         ${f.sql ? `${f.sql} AND` : 'WHERE'} a.condition <> 'baik'`,
      f.params,
    ),
  ]);

  const forms = listForms
    ? (
        await query(
          `SELECT ${LIST_COLS} FROM p2h_forms f ${f.sql}
            ORDER BY f.shift_date DESC, f.shift DESC, f.unit_code LIMIT ${lim.forms}`,
          f.params,
        )
      ).rows
    : [];
  const findings = detail
    ? (
        await query(
          `SELECT a.id, a.form_id, a.section_title, a.item_text, a.danger_code, a.condition, a.note, a.fix_status, a.fix_note,
                  a.fix_by_name, a.fix_at, f.shift_date, f.shift, f.unit_code, f.site_name, f.inspector_name,
                  (SELECT count(*)::int FROM p2h_photos ph WHERE ph.answer_id = a.id) AS n_photos
             FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
             ${f.sql ? `${f.sql} AND` : 'WHERE'} a.condition <> 'baik'
            ORDER BY f.shift_date DESC, f.shift DESC, f.unit_code, a.section_order, a.item_no
            LIMIT ${lim.findings}`,
          f.params,
        )
      ).rows
    : [];

  const scope = scopeOf(user);
  let siteName = null;
  let unitCode = null;
  const siteId = scope != null ? scope : Number(q.site_id) || null;
  if (siteId) siteName = (await query('SELECT name FROM sites WHERE id = $1', [siteId])).rows[0]?.name ?? null;
  if (q.unit_id) unitCode = (await query('SELECT code FROM units WHERE id = $1', [Number(q.unit_id) || 0])).rows[0]?.code ?? null;

  const s = sumQ.rows[0];
  const expected = await expectedForms(qq, user, from, to);
  const sum = {
    total: s.total,
    baik: s.baik,
    temuan: s.temuan,
    stop: s.stop,
    verified: s.verified,
    unverified: s.total - s.verified,
    expected,
    compliance: expected ? Math.min(100, Math.round((s.total / expected) * 100)) : null,
  };
  const buckets = makeBuckets(period, from, to, dayQ.rows);

  const parts = [];
  parts.push(period ? `${PERIOD_LABEL[period]} · ${periodTitle(period, from, to)}` : from || to ? `Periode ${from ? longDate(from) : '…'} s.d. ${to ? longDate(to) : '…'}` : 'Semua tanggal');
  if (siteName) parts.push(`Site ${siteName}`);
  if (unitCode) parts.push(`Unit ${unitCode}`);
  if ([1, 2].includes(Number(q.shift))) parts.push(`Shift ${shiftLabel(Number(q.shift))}`);
  if (q.result && RESULT_LABEL[q.result]) parts.push(`Hasil: ${RESULT_LABEL[q.result]}`);

  const tag = period ? `${PERIOD_LABEL[period]}_${from}${period === 'week' ? `_sd_${to}` : ''}` : `${from || 'awal'}_sd_${to || 'akhir'}`;
  return {
    period,
    from,
    to,
    forms,
    findings,
    findingsSum: findQ.rows[0],
    sum,
    sites: siteQ.rows,
    buckets,
    formsOmitted: detail && !listForms,
    truncatedForms: listForms && forms.length >= lim.forms,
    truncatedFindings: detail && findings.length >= lim.findings,
    limits: lim,
    title: period ? `REKAP P2H GENSET · ${PERIOD_LABEL[period].toUpperCase()}` : 'REKAP P2H GENSET',
    subtitle: parts.join(' · '),
    filename: `Rekap_P2H_${tag}${siteName ? `_${siteName}` : ''}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
    generated: stampWITA(new Date()),
  };
}

/** Ringkasan untuk layar (tanpa daftar P2H). */
export async function rekapPreview(q, user) {
  const d = await loadRekap(q, user, { detail: false });
  return {
    period: d.period,
    from: d.from,
    to: d.to,
    title: d.title,
    subtitle: d.subtitle,
    sum: d.sum,
    sites: d.sites,
    bucket_unit: d.buckets.unit,
    buckets: d.buckets.rows,
    findings: d.findingsSum,
  };
}

const unitLabel = (x) => (x.unit_old_code ? `${x.unit_code} (${x.unit_old_code})` : x.unit_code);
const modelLabel = (x) => [x.unit_brand, x.unit_model].filter(Boolean).join(' ');
const dateLabel = (d) => `${dayNameID(d)} ${shortDate(d)}`;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const verLabel = (x) => (x.verified ? `Terverifikasi: ${x.sup_name}` : 'Menunggu verifikasi');

const tileList = (d) => [
  ['Total P2H', d.sum.total, '111111'],
  ['Semua baik', d.sum.baik, '2E7D14'],
  ['Ada temuan (A)', d.sum.temuan, '9A6700'],
  ['STOP (AA)', d.sum.stop, 'B3261E'],
  ['Terverifikasi', d.sum.verified, '2E7D14'],
  ['Menunggu verifikasi', d.sum.unverified, '555555'],
  ['Kepatuhan (perkiraan)', d.sum.compliance == null ? '-' : `${d.sum.compliance}%`, '111111'],
];
const siteCols = ['Site', 'Total P2H', 'Semua baik', 'Ada temuan (A)', 'STOP (AA)', 'Terverifikasi'];
const siteRows = (d) => d.sites.map((s) => [s.site, s.total, s.baik, s.temuan, s.stop, s.verified]);
const bucketCols = (d) => [d.buckets.unit, 'Total P2H', 'Semua baik', 'Ada temuan (A)', 'STOP (AA)', 'Terverifikasi', '% baik'];
const bucketRows = (d) => d.buckets.rows.map((b) => [b.label, b.total, b.baik, b.temuan, b.stop, b.verified, pct(b.baik, b.total)]);
const notes = (d) => {
  const n = [];
  if (d.formsOmitted) n.push('Rincian per P2H tidak dicetak untuk rekap tahunan di PDF / Word supaya tidak terlalu panjang. Unduh Excel untuk rincian lengkap, atau pilih rekap bulanan.');
  if (d.truncatedForms) n.push(`Daftar P2H dibatasi ${d.limits.forms} baris terbaru. Ringkasan di atas tetap menghitung semua data.`);
  if (d.truncatedFindings) n.push(`Daftar temuan dibatasi ${d.limits.findings} baris terbaru. Ringkasan di atas tetap menghitung semua data.`);
  if (d.sum.compliance != null) n.push('Kepatuhan (perkiraan) = jumlah P2H masuk dibanding jumlah genset jalan / standby saat ini x shift yang sudah mulai.');
  return n;
};

/* ========================================================== EXCEL */

export async function buildRekapXlsx(q, user) {
  const d = await loadRekap(q, user, { kind: 'xlsx' });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'P2H Genset';
  wb.created = new Date();
  const font = (o = {}) => ({ name: 'Calibri', size: 10, ...o });
  const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14170F' } };
  const thin = { style: 'thin', color: { argb: 'FFC9CDBF' } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
  const fillFor = (res) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: res === 'stop_aa' ? 'FFFBD9D4' : res === 'temuan_a' ? 'FFFCEFC7' : 'FFE4F3DB' } });

  const sheet = (name, cols, rows, opts = {}) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    ws.columns = cols.map((c) => ({ width: c.w }));
    ws.mergeCells(1, 1, 1, cols.length);
    ws.getCell(1, 1).value = `${d.title} — ${name}`;
    ws.getCell(1, 1).font = font({ size: 14, bold: true });
    ws.mergeCells(2, 1, 2, cols.length);
    ws.getCell(2, 1).value = `${d.subtitle}   ·   Dibuat ${d.generated}`;
    ws.getCell(2, 1).font = font({ size: 9, color: { argb: 'FF555555' } });
    const hr = ws.getRow(4);
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.h;
      cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
      cell.fill = HEAD;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = BORDER;
    });
    hr.height = 28;
    rows.forEach((vals, ri) => {
      const row = ws.getRow(5 + ri);
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.font = font({ size: 9 });
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', horizontal: cols[i].center ? 'center' : 'left', wrapText: !!cols[i].wrap };
      });
      if (opts.resultCol != null) {
        const res = opts.results[ri];
        row.getCell(opts.resultCol + 1).fill = fillFor(res);
        row.getCell(opts.resultCol + 1).font = font({ size: 9, bold: true });
      }
    });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    ws.pageSetup.printTitlesRow = '4:4';
    return ws;
  };

  // ---- Ringkasan
  {
    const ws = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 12 }];
    ws.getCell('A1').value = d.title;
    ws.getCell('A1').font = font({ size: 16, bold: true });
    ws.getCell('A2').value = d.subtitle;
    ws.getCell('A3').value = `Dibuat ${d.generated}`;
    ws.getCell('A2').font = font({ color: { argb: 'FF555555' } });
    ws.getCell('A3').font = font({ size: 9, color: { argb: 'FF777777' } });
    tileList(d).forEach(([k, v], i) => {
      ws.getCell(5 + i, 1).value = k;
      ws.getCell(5 + i, 2).value = v;
      ws.getCell(5 + i, 1).font = font({ bold: true });
      ws.getCell(5 + i, 2).font = font({ bold: true, size: 12 });
      ws.getCell(5 + i, 2).alignment = { horizontal: 'center' };
      ws.getCell(5 + i, 1).border = BORDER;
      ws.getCell(5 + i, 2).border = BORDER;
    });
    const table = (r0, title, cols, rows) => {
      ws.getCell(r0, 1).value = title;
      ws.getCell(r0, 1).font = font({ bold: true, size: 11 });
      cols.forEach((t, i) => {
        const c = ws.getCell(r0 + 1, i + 1);
        c.value = t;
        c.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
        c.fill = HEAD;
        c.border = BORDER;
        c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      rows.forEach((row, i) => {
        row.forEach((v, j) => {
          const c = ws.getCell(r0 + 2 + i, j + 1);
          c.value = v;
          c.font = font();
          c.border = BORDER;
          c.alignment = { horizontal: j ? 'center' : 'left' };
        });
      });
      return r0 + 2 + rows.length + 1;
    };
    let r = 14;
    r = table(r, 'Per site', siteCols, siteRows(d));
    r = table(r, `Per ${d.buckets.unit.toLowerCase()}`, bucketCols(d), bucketRows(d));
    ws.getCell(r, 1).value = `Temuan pada periode ini: ${d.findingsSum.total} (AA ${d.findingsSum.aa}, A ${d.findingsSum.a}), sudah selesai diperbaiki ${d.findingsSum.closed}.`;
    ws.getCell(r, 1).font = font({ size: 10 });
    r += 2;
    for (const n of notes(d)) {
      ws.getCell(r, 1).value = `Catatan: ${n}`;
      ws.getCell(r, 1).font = font({ size: 9, color: { argb: 'FF777777' } });
      r += 1;
    }
  }

  if (d.forms.length || !d.formsOmitted) {
    sheet(
      'Rekap P2H',
      [
        { h: 'No', w: 6, center: true }, { h: 'Tanggal', w: 18 }, { h: 'Shift', w: 7, center: true }, { h: 'Site', w: 13 },
        { h: 'Lokasi', w: 16 }, { h: 'No. Unit', w: 22 }, { h: 'Merk / Model', w: 20 }, { h: 'Teknisi', w: 24 },
        { h: 'Perusahaan', w: 20 }, { h: 'No SID', w: 13 }, { h: 'HM Awal', w: 11, num: true, center: true }, { h: 'HM Akhir', w: 11, num: true, center: true },
        { h: 'Hasil', w: 20, center: true }, { h: 'Temuan AA', w: 10, center: true }, { h: 'Temuan A', w: 10, center: true }, { h: 'Foto', w: 7, center: true },
        { h: 'Status verifikasi', w: 30 }, { h: 'Waktu isi (WITA)', w: 20 }, { h: 'ID P2H', w: 9, center: true },
      ],
      d.forms.map((x, i) => [
        i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, x.location || '', unitLabel(x), modelLabel(x),
        x.inspector_name, x.inspector_company || '', x.inspector_nrp || '', x.hm_start, x.hm_end, RESULT_LABEL[x.result], x.n_aa, x.n_a, x.n_photos,
        verLabel(x), stampWITA(x.filled_at), x.id,
      ]),
      { resultCol: 12, results: d.forms.map((x) => x.result) },
    );
  }

  // ---- Temuan
  sheet(
    'Temuan',
    [
      { h: 'No', w: 6, center: true }, { h: 'Tanggal', w: 18 }, { h: 'Shift', w: 7, center: true }, { h: 'Site', w: 13 },
      { h: 'No. Unit', w: 16 }, { h: 'Bagian', w: 24 }, { h: 'Butir cek', w: 52, wrap: true }, { h: 'Kode', w: 7, center: true },
      { h: 'Kondisi', w: 11, center: true }, { h: 'Catatan teknisi', w: 40, wrap: true }, { h: 'Foto', w: 7, center: true }, { h: 'Status tindak lanjut', w: 20 },
      { h: 'Catatan perbaikan', w: 36, wrap: true }, { h: 'Diperbaiki oleh', w: 20 }, { h: 'Waktu selesai (WITA)', w: 20 },
    ],
    d.findings.map((x, i) => [
      i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, x.unit_code, x.section_title, plain(x.item_text), x.danger_code,
      CONDITION_LABEL[x.condition], x.note || '', x.n_photos, FIX_LABEL[x.fix_status] || '', x.fix_note || '', x.fix_by_name || '', x.fix_at ? stampWITA(x.fix_at) : '',
    ]),
  );

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${d.filename}.xlsx` };
}

/* ========================================================== PDF */

export async function buildRekapPdf(q, user) {
  const d = await loadRekap(q, user);
  const PW = 841.89;
  const PH = 595.28;
  const M = 28;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, bufferPages: true, info: { Title: d.title, Author: 'P2H Genset' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const F = 'Helvetica';
  const FB = 'Helvetica-Bold';
  const T = (s, x, y, w, o = {}) =>
    doc.font(o.bold ? FB : F).fontSize(o.size ?? 8).fillColor(o.color ?? '#111111').text(String(s ?? ''), x, y, { width: w, align: o.align ?? 'left', lineBreak: false, ellipsis: true });

  const lockup = asset('berau-lockup.png');
  const mtl = asset('mtl-logo.png');
  let y = M;

  const header = () => {
    if (mtl) doc.image(mtl, M, M, { fit: [56, 36] });
    if (lockup) doc.image(lockup, PW - M - 46, M - 2, { fit: [46, 40] });
    T(d.title, M + 64, M + 2, PW - 2 * M - 128, { size: 15, bold: true, align: 'center' });
    T(d.subtitle, M + 64, M + 21, PW - 2 * M - 128, { size: 8.5, align: 'center', color: '#444444' });
    T(`Dibuat ${d.generated}`, M + 64, M + 32, PW - 2 * M - 128, { size: 7, align: 'center', color: '#777777' });
    y = M + 46;
  };

  const tableHead = (cols, w) => {
    doc.save().rect(M, y, w, 16).fill('#14170F').restore();
    let x = M;
    for (const c of cols) {
      T(c.h, x + 2, y + 4.5, c.w - (c.align === 'right' ? 10 : 4), { size: 7.2, bold: true, color: '#FFFFFF', align: c.align });
      x += c.w;
    }
    y += 16;
  };

  const drawTable = (cols, rows, rowStyle) => {
    const w = cols.reduce((a, c) => a + c.w, 0);
    tableHead(cols, w);
    rows.forEach((r, idx) => {
      if (y + 14 > PH - M - 10) {
        doc.addPage();
        header();
        tableHead(cols, w);
      }
      const st = rowStyle ? rowStyle(r, idx) : {};
      if (st.fill) doc.save().rect(M, y, w, 14).fill(st.fill).restore();
      else if (idx % 2) doc.save().rect(M, y, w, 14).fill('#F7F7F3').restore();
      let x = M;
      cols.forEach((c, i) => {
        const bold = st.boldCol === i;
        T(r[i], x + 2, y + 3.6, c.w - (c.align === 'right' ? 10 : 4), { size: 7.4, align: c.align, bold, color: st.colors?.[i] });
        x += c.w;
      });
      doc.save().lineWidth(0.3).strokeColor('#D5D8CB').moveTo(M, y + 14).lineTo(M + w, y + 14).stroke().restore();
      y += 14;
    });
  };
  const need = (h) => {
    if (y + h > PH - M - 10) {
      doc.addPage();
      header();
    }
  };

  header();

  // ringkasan angka
  const tiles = tileList(d);
  const gap = 6;
  const tw = (PW - 2 * M - (tiles.length - 1) * gap) / tiles.length;
  tiles.forEach(([k, v, c], i) => {
    const x = M + i * (tw + gap);
    doc.save().rect(x, y, tw, 34).fillAndStroke('#FFFFFF', '#C9CDBF').restore();
    doc.save().rect(x, y, 3, 34).fill(`#${c}`).restore();
    T(k, x + 8, y + 5, tw - 10, { size: 6.8, color: '#555555' });
    T(v, x + 8, y + 15, tw - 10, { size: 14, bold: true, color: `#${c}` });
  });
  y += 44;

  // ringkasan per site + per hari/minggu/bulan
  T('Per site', M, y, 200, { size: 10, bold: true });
  y += 13;
  drawTable(
    siteCols.map((h, i) => ({ h, w: i === 0 ? 110 : 82, align: i ? 'center' : undefined })),
    siteRows(d),
  );
  if (!d.sites.length) T('Tidak ada P2H pada penyaring ini.', M, y + 4, 300, { size: 8.5, color: '#777777' });
  y += 12;
  need(60);
  T(`Per ${d.buckets.unit.toLowerCase()}`, M, y, 200, { size: 10, bold: true });
  y += 13;
  drawTable(
    bucketCols(d).map((h, i) => ({ h, w: i === 0 ? 170 : 82, align: i ? 'center' : undefined })),
    bucketRows(d),
  );
  y += 8;
  need(20);
  T(`Temuan pada periode ini: ${d.findingsSum.total} (AA ${d.findingsSum.aa}, A ${d.findingsSum.a}), sudah selesai diperbaiki ${d.findingsSum.closed}.`, M, y, PW - 2 * M, { size: 8.5 });
  y += 14;

  if (d.forms.length) {
    doc.addPage();
    header();
    const cols = [
      { h: 'No', w: 26, align: 'center' }, { h: 'Tanggal', w: 74 }, { h: 'Shift', w: 30, align: 'center' }, { h: 'Site', w: 62 },
      { h: 'No. Unit', w: 98 }, { h: 'Merk / Model', w: 92 }, { h: 'Teknisi', w: 108 }, { h: 'HM Awal', w: 50, align: 'right' },
      { h: 'HM Akhir', w: 50, align: 'right' }, { h: 'Hasil', w: 92 }, { h: 'Verifikasi pengawas', w: 0 },
    ];
    cols[cols.length - 1].w = PW - 2 * M - cols.slice(0, -1).reduce((a, c) => a + c.w, 0);
    T('Daftar P2H', M, y, 200, { size: 10, bold: true });
    y += 14;
    drawTable(
      cols,
      d.forms.map((x, i) => [
        i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, unitLabel(x), modelLabel(x), x.inspector_name,
        fmtNum(x.hm_start), fmtNum(x.hm_end), RESULT_LABEL[x.result], x.verified ? `Terverifikasi: ${x.sup_name}` : 'Menunggu',
      ]),
      (r, i) => {
        const x = d.forms[i];
        return { colors: { 9: x.result === 'stop_aa' ? '#B3261E' : x.result === 'temuan_a' ? '#9A6700' : '#2E7D14' }, boldCol: 9 };
      },
    );
  }

  if (d.findings.length) {
    y += 14;
    need(60);
    T('Daftar temuan (rusak / perlu diperbaiki)', M, y, 400, { size: 10, bold: true });
    y += 14;
    const fc = [
      { h: 'Tanggal', w: 74 }, { h: 'Shift', w: 30, align: 'center' }, { h: 'No. Unit', w: 80 }, { h: 'Butir cek', w: 240 },
      { h: 'Kode', w: 32, align: 'center' }, { h: 'Kondisi', w: 48 }, { h: 'Catatan', w: 120 }, { h: 'Foto', w: 28, align: 'center' }, { h: 'Status', w: 0 },
    ];
    fc[fc.length - 1].w = PW - 2 * M - fc.slice(0, -1).reduce((a, c) => a + c.w, 0);
    drawTable(
      fc,
      d.findings.map((x) => [
        dateLabel(x.shift_date), shiftLabel(x.shift), x.unit_code, plain(x.item_text), x.danger_code, CONDITION_LABEL[x.condition],
        x.note || '', x.n_photos, FIX_LABEL[x.fix_status] || '',
      ]),
      (r, i) => ({ colors: { 4: d.findings[i].danger_code === 'AA' ? '#B3261E' : '#111111' }, boldCol: 4 }),
    );
  }
  y += 8;
  for (const n of notes(d)) {
    need(14);
    T(`Catatan: ${n}`, M, y, PW - 2 * M, { size: 7.2, color: '#777777' });
    y += 10;
  }

  // nomor halaman
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    T(`Halaman ${i + 1} dari ${range.count}`, PW - M - 120, PH - M + 2, 120, { size: 7, color: '#777777', align: 'right' });
    T('P2H Genset · Berau Coal · MTL', M, PH - M + 2, 240, { size: 7, color: '#777777' });
  }
  doc.end();
  return { buffer: await done, filename: `${d.filename}.pdf` };
}

/* ========================================================== WORD */

export async function buildRekapDocx(q, user) {
  const d = await loadRekap(q, user);
  const FONT = 'Calibri';
  const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font: FONT, size: o.size ?? 15, bold: o.bold, color: o.color });
  const para = (c, o = {}) => new Paragraph({ children: Array.isArray(c) ? c : [c], alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0 } });
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'C9CDBF' };
  const B = { top: thin, bottom: thin, left: thin, right: thin };
  const cell = (c, w, o = {}) =>
    new TableCell({
      children: [para(c, { align: o.align })],
      width: { size: w, type: WidthType.DXA },
      borders: B,
      verticalAlign: VerticalAlign.CENTER,
      shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: 25, bottom: 25, left: 60, right: 60 },
    });
  const mkTable = (cols, rows, styleFor) => {
    const total = cols.reduce((a, c) => a + c.w, 0);
    return new Table({
      width: { size: total, type: WidthType.DXA },
      columnWidths: cols.map((c) => c.w),
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          tableHeader: true,
          children: cols.map((c) => cell(run(c.h, { bold: true, size: 14, color: 'FFFFFF' }), c.w, { fill: '14170F', align: AlignmentType.CENTER })),
        }),
        ...rows.map(
          (r, i) =>
            new TableRow({
              cantSplit: true,
              height: { value: 250, rule: HeightRule.ATLEAST },
              children: r.map((v, j) => {
                const st = styleFor?.(i, j) || {};
                return cell(run(v, { size: 14, bold: st.bold, color: st.color }), cols[j].w, { align: cols[j].align, fill: i % 2 ? 'F7F7F3' : undefined });
              }),
            }),
        ),
      ],
    });
  };
  const resColor = (res) => (res === 'stop_aa' ? 'B3261E' : res === 'temuan_a' ? '9A6700' : '2E7D14');
  const C = AlignmentType.CENTER;

  const mtl = asset('mtl-logo.png');
  const lockup = asset('berau-lockup.png');
  const noB = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };
  const head = new Table({
    width: { size: 15500, type: WidthType.DXA },
    columnWidths: [1800, 11900, 1800],
    borders: { ...noB, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [
      new TableRow({
        children: [1800, 11900, 1800].map((w, i) =>
          new TableCell({
            width: { size: w, type: WidthType.DXA },
            borders: noB,
            children:
              i === 0
                ? [para(mtl ? new ImageRun({ type: 'png', data: mtl, transformation: { width: 68, height: 42 } }) : run(''))]
                : i === 2
                  ? [para(lockup ? new ImageRun({ type: 'png', data: lockup, transformation: { width: 52, height: 44 } }) : run(''), { align: AlignmentType.RIGHT })]
                  : [para(run(d.title, { size: 30, bold: true }), { align: C }), para(run(d.subtitle, { size: 17, color: '444444' }), { align: C, before: 30 }), para(run(`Dibuat ${d.generated}`, { size: 13, color: '777777' }), { align: C })],
          }),
        ),
      }),
    ],
  });

  const tiles = tileList(d);
  const tw = Math.floor(15000 / tiles.length);
  const sumTable = mkTable(
    tiles.map(([h]) => ({ h, w: tw, align: C })),
    [tiles.map(([, v]) => v)],
    (i, j) => ({ bold: true, color: tiles[j][2] }),
  );

  const kids = [head, para(run(''), { after: 80 }), sumTable];
  kids.push(
    para(run('Per site', { bold: true, size: 20 }), { before: 160, after: 60 }),
    mkTable(siteCols.map((h, i) => ({ h, w: i === 0 ? 2600 : 1700, align: i ? C : undefined })), siteRows(d)),
    para(run(`Per ${d.buckets.unit.toLowerCase()}`, { bold: true, size: 20 }), { before: 160, after: 60 }),
    mkTable(bucketCols(d).map((h, i) => ({ h, w: i === 0 ? 3600 : 1700, align: i ? C : undefined })), bucketRows(d)),
    para(run(`Temuan pada periode ini: ${d.findingsSum.total} (AA ${d.findingsSum.aa}, A ${d.findingsSum.a}), sudah selesai diperbaiki ${d.findingsSum.closed}.`, { size: 16 }), { before: 100 }),
  );

  if (d.forms.length) {
    const cols = [
      { h: 'No', w: 560, align: C }, { h: 'Tanggal', w: 1500 }, { h: 'Shift', w: 600, align: C }, { h: 'Site', w: 1200 },
      { h: 'No. Unit', w: 2000 }, { h: 'Merk / Model', w: 1900 }, { h: 'Teknisi', w: 2300 }, { h: 'HM Awal', w: 1000, align: AlignmentType.RIGHT },
      { h: 'HM Akhir', w: 1000, align: AlignmentType.RIGHT }, { h: 'Hasil', w: 1700 }, { h: 'Verifikasi pengawas', w: 1740 },
    ];
    kids.push(
      new Paragraph({ children: [new TextRun({ text: 'Daftar P2H', font: FONT, size: 20, bold: true })], pageBreakBefore: true, spacing: { after: 60 } }),
      mkTable(
        cols,
        d.forms.map((x, i) => [i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, unitLabel(x), modelLabel(x), x.inspector_name, fmtNum(x.hm_start), fmtNum(x.hm_end), RESULT_LABEL[x.result], x.verified ? `Terverifikasi: ${x.sup_name}` : 'Menunggu']),
        (i, j) => (j === 9 ? { bold: true, color: resColor(d.forms[i].result) } : {}),
      ),
    );
  }

  if (d.findings.length) {
    const fc = [
      { h: 'Tanggal', w: 1500 }, { h: 'Shift', w: 600, align: C }, { h: 'No. Unit', w: 1700 }, { h: 'Butir cek', w: 4300 },
      { h: 'Kode', w: 640, align: C }, { h: 'Kondisi', w: 1000 }, { h: 'Catatan', w: 3000 }, { h: 'Foto', w: 560, align: C }, { h: 'Status', w: 2200 },
    ];
    kids.push(
      para(run('Daftar temuan (rusak / perlu diperbaiki)', { bold: true, size: 20 }), { before: 200, after: 60 }),
      mkTable(
        fc,
        d.findings.map((x) => [dateLabel(x.shift_date), shiftLabel(x.shift), x.unit_code, plain(x.item_text), x.danger_code, CONDITION_LABEL[x.condition], x.note || '', x.n_photos, FIX_LABEL[x.fix_status] || '']),
        (i, j) => (j === 4 ? { bold: true, color: d.findings[i].danger_code === 'AA' ? 'B3261E' : undefined } : {}),
      ),
    );
  }
  for (const n of notes(d)) kids.push(para(run(`Catatan: ${n}`, { size: 13, color: '777777' }), { before: 60 }));

  const doc = new Document({
    creator: 'P2H Genset',
    title: d.title,
    styles: { default: { document: { run: { font: FONT, size: 15 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 560, bottom: 560, left: 640, right: 640 } } }, children: kids }],
  });
  return { buffer: await Packer.toBuffer(doc), filename: `${d.filename}.docx` };
}
