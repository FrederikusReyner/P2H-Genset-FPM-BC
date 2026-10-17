import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  AlignmentType, BorderStyle, Document, HeightRule, ImageRun, Packer, PageOrientation, Paragraph, ShadingType, Table,
  TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { query } from '../../db.js';
import { buildListFilter, LIST_COLS } from '../../routes/p2h.js';
import { CONDITION_LABEL, FIX_LABEL, RESULT_LABEL, plain } from '../../text.js';
import { dayNameID, longDate, shiftLabel, shortDate, stampWITA } from '../../time.js';
import { asset, describeFilter, fmtNum } from './common.js';

const MAX_FORMS = 5000;

/** Ambil data rekap sesuai penyaring (site, unit, tanggal, shift, hasil). */
export async function loadRekap(q, user) {
  const f = buildListFilter(q, user);
  const forms = (
    await query(
      `SELECT ${LIST_COLS} FROM p2h_forms f ${f.sql}
        ORDER BY f.shift_date DESC, f.shift DESC, f.unit_code LIMIT ${MAX_FORMS}`,
      f.params,
    )
  ).rows;
  const ids = forms.map((x) => x.id);
  const findings = ids.length
    ? (
        await query(
          `SELECT a.id, a.form_id, a.section_title, a.item_text, a.danger_code, a.condition, a.note, a.fix_status, a.fix_note,
                  a.fix_by_name, a.fix_at, f.shift_date, f.shift, f.unit_code, f.site_name, f.inspector_name
             FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
            WHERE a.form_id = ANY ($1) AND a.condition <> 'baik'
            ORDER BY f.shift_date DESC, f.shift DESC, f.unit_code, a.section_order, a.item_no`,
          [ids],
        )
      ).rows
    : [];

  let siteName = null;
  let unitCode = null;
  if (q.site_id) siteName = (await query('SELECT name FROM sites WHERE id = $1', [Number(q.site_id) || 0])).rows[0]?.name;
  if (q.unit_id) unitCode = (await query('SELECT code FROM units WHERE id = $1', [Number(q.unit_id) || 0])).rows[0]?.code;

  const sum = {
    total: forms.length,
    baik: forms.filter((x) => x.result === 'baik').length,
    temuan: forms.filter((x) => x.result === 'temuan_a').length,
    stop: forms.filter((x) => x.result === 'stop_aa').length,
    unsigned: forms.filter((x) => !x.signed).length,
  };
  const bySite = new Map();
  for (const x of forms) {
    const e = bySite.get(x.site_name) || { site: x.site_name, total: 0, baik: 0, temuan: 0, stop: 0 };
    e.total += 1;
    if (x.result === 'baik') e.baik += 1;
    else if (x.result === 'temuan_a') e.temuan += 1;
    else e.stop += 1;
    bySite.set(x.site_name, e);
  }
  return {
    forms,
    findings,
    sum,
    sites: [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site)),
    truncated: forms.length >= MAX_FORMS,
    title: 'REKAP P2H GENSET',
    subtitle: describeFilter(q, { siteName, unitCode }),
    filename: `Rekap_P2H_${q.from || 'awal'}_sd_${q.to || 'akhir'}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
    generated: stampWITA(new Date()),
  };
}

const unitLabel = (x) => (x.unit_old_code ? `${x.unit_code} (${x.unit_old_code})` : x.unit_code);
const modelLabel = (x) => [x.unit_brand, x.unit_model].filter(Boolean).join(' ');
const dateLabel = (d) => `${dayNameID(d)} ${shortDate(d)}`;

/* ========================================================== EXCEL */

export async function buildRekapXlsx(q, user) {
  const d = await loadRekap(q, user);
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
    ws.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
    ws.getCell('A1').value = d.title;
    ws.getCell('A1').font = font({ size: 16, bold: true });
    ws.getCell('A2').value = d.subtitle;
    ws.getCell('A3').value = `Dibuat ${d.generated}`;
    ws.getCell('A2').font = font({ color: { argb: 'FF555555' } });
    ws.getCell('A3').font = font({ size: 9, color: { argb: 'FF777777' } });
    const rowsS = [
      ['Total P2H', d.sum.total],
      ['Semua baik', d.sum.baik],
      ['Ada temuan (A)', d.sum.temuan],
      ['STOP OPERASI (AA)', d.sum.stop],
      ['Belum ditandatangani pengawas', d.sum.unsigned],
    ];
    rowsS.forEach(([k, v], i) => {
      ws.getCell(5 + i, 1).value = k;
      ws.getCell(5 + i, 2).value = v;
      ws.getCell(5 + i, 1).font = font({ bold: true });
      ws.getCell(5 + i, 2).font = font({ bold: true, size: 12 });
      ws.getCell(5 + i, 1).border = BORDER;
      ws.getCell(5 + i, 2).border = BORDER;
    });
    const h = 12;
    ['Site', 'Total P2H', 'Semua baik', 'Ada temuan (A)', 'STOP (AA)'].forEach((t, i) => {
      const c = ws.getCell(h, i + 1);
      c.value = t; c.font = font({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = HEAD; c.border = BORDER;
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    d.sites.forEach((s, i) => {
      [s.site, s.total, s.baik, s.temuan, s.stop].forEach((v, j) => {
        const c = ws.getCell(h + 1 + i, j + 1);
        c.value = v; c.font = font(); c.border = BORDER;
        c.alignment = { horizontal: j ? 'center' : 'left' };
      });
    });
    if (d.truncated) ws.getCell(h + d.sites.length + 3, 1).value = `Catatan: data dibatasi ${MAX_FORMS} P2H terbaru.`;
  }

  // ---- Rekap P2H
  sheet(
    'Rekap P2H',
    [
      { h: 'No', w: 6, center: true }, { h: 'Tanggal', w: 18 }, { h: 'Shift', w: 7, center: true }, { h: 'Site', w: 13 },
      { h: 'Lokasi', w: 16 }, { h: 'No. Unit', w: 22 }, { h: 'Merk / Model', w: 20 }, { h: 'Mekanik / Electrician', w: 24 },
      { h: 'ID Karyawan', w: 13 }, { h: 'HM Awal', w: 11, num: true, center: true }, { h: 'HM Akhir', w: 11, num: true, center: true },
      { h: 'Hasil', w: 20, center: true }, { h: 'Temuan AA', w: 10, center: true }, { h: 'Temuan A', w: 10, center: true },
      { h: 'Pengawas (TTD)', w: 22 }, { h: 'Waktu isi (WITA)', w: 20 }, { h: 'ID P2H', w: 9, center: true },
    ],
    d.forms.map((x, i) => [
      i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, x.location || '', unitLabel(x), modelLabel(x),
      x.inspector_name, x.inspector_nrp || '', x.hm_start, x.hm_end, RESULT_LABEL[x.result], x.n_aa, x.n_a,
      x.signed ? x.sup_name : 'Belum', stampWITA(x.filled_at), x.id,
    ]),
    { resultCol: 11, results: d.forms.map((x) => x.result) },
  );

  // ---- Temuan
  sheet(
    'Temuan',
    [
      { h: 'No', w: 6, center: true }, { h: 'Tanggal', w: 18 }, { h: 'Shift', w: 7, center: true }, { h: 'Site', w: 13 },
      { h: 'No. Unit', w: 16 }, { h: 'Bagian', w: 24 }, { h: 'Butir cek', w: 52, wrap: true }, { h: 'Kode', w: 7, center: true },
      { h: 'Kondisi', w: 11, center: true }, { h: 'Catatan mekanik', w: 40, wrap: true }, { h: 'Status tindak lanjut', w: 20 },
      { h: 'Catatan perbaikan', w: 36, wrap: true }, { h: 'Diperbaiki oleh', w: 20 }, { h: 'Waktu selesai (WITA)', w: 20 },
    ],
    d.findings.map((x, i) => [
      i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, x.unit_code, x.section_title, plain(x.item_text), x.danger_code,
      CONDITION_LABEL[x.condition], x.note || '', FIX_LABEL[x.fix_status] || '', x.fix_note || '', x.fix_by_name || '', x.fix_at ? stampWITA(x.fix_at) : '',
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
    if (mtl) doc.image(mtl, M, M, { fit: [56, 30] });
    if (lockup) doc.image(lockup, PW - M - 46, M - 2, { fit: [46, 40] });
    T(d.title, M + 64, M + 2, PW - 2 * M - 128, { size: 15, bold: true, align: 'center' });
    T(d.subtitle, M + 64, M + 21, PW - 2 * M - 128, { size: 8.5, align: 'center', color: '#444444' });
    T(`Dibuat ${d.generated}`, M + 64, M + 32, PW - 2 * M - 128, { size: 7, align: 'center', color: '#777777' });
    y = M + 46;
  };

  const tableHead = (cols) => {
    doc.save().rect(M, y, PW - 2 * M, 16).fill('#14170F').restore();
    let x = M;
    for (const c of cols) {
      T(c.h, x + 2, y + 4.5, c.w - (c.align === 'right' ? 10 : 4), { size: 7.2, bold: true, color: '#FFFFFF', align: c.align });
      x += c.w;
    }
    y += 16;
  };

  const drawTable = (cols, rows, rowStyle) => {
    tableHead(cols);
    rows.forEach((r, idx) => {
      if (y + 14 > PH - M - 10) {
        doc.addPage();
        header();
        tableHead(cols);
      }
      const st = rowStyle ? rowStyle(r, idx) : {};
      if (st.fill) doc.save().rect(M, y, PW - 2 * M, 14).fill(st.fill).restore();
      else if (idx % 2) doc.save().rect(M, y, PW - 2 * M, 14).fill('#F7F7F3').restore();
      let x = M;
      cols.forEach((c, i) => {
        const bold = st.boldCol === i;
        T(r[i], x + 2, y + 3.6, c.w - (c.align === 'right' ? 10 : 4), { size: 7.4, align: c.align, bold, color: st.colors?.[i] });
        x += c.w;
      });
      doc.save().lineWidth(0.3).strokeColor('#D5D8CB').moveTo(M, y + 14).lineTo(PW - M, y + 14).stroke().restore();
      y += 14;
    });
  };

  header();

  // ringkasan angka
  const tiles = [
    ['Total P2H', d.sum.total, '#111111'], ['Semua baik', d.sum.baik, '#2E7D14'], ['Ada temuan (A)', d.sum.temuan, '#9A6700'],
    ['STOP (AA)', d.sum.stop, '#B3261E'], ['Belum TTD pengawas', d.sum.unsigned, '#555555'],
  ];
  const tw = (PW - 2 * M - 4 * 8) / 5;
  tiles.forEach(([k, v, c], i) => {
    const x = M + i * (tw + 8);
    doc.save().rect(x, y, tw, 34).fillAndStroke('#FFFFFF', '#C9CDBF').restore();
    doc.save().rect(x, y, 3, 34).fill(c).restore();
    T(k, x + 9, y + 5, tw - 12, { size: 7.4, color: '#555555' });
    T(v, x + 9, y + 15, tw - 12, { size: 15, bold: true, color: c });
  });
  y += 46;

  const cols = [
    { h: 'No', w: 26, align: 'center' }, { h: 'Tanggal', w: 74 }, { h: 'Shift', w: 30, align: 'center' }, { h: 'Site', w: 62 },
    { h: 'No. Unit', w: 98 }, { h: 'Merk / Model', w: 92 }, { h: 'Mekanik / Electrician', w: 108 }, { h: 'HM Awal', w: 50, align: 'right' },
    { h: 'HM Akhir', w: 50, align: 'right' }, { h: 'Hasil', w: 92 }, { h: 'Pengawas', w: 0 },
  ];
  cols[cols.length - 1].w = PW - 2 * M - cols.slice(0, -1).reduce((a, c) => a + c.w, 0);
  T('Daftar P2H', M, y, 200, { size: 10, bold: true });
  y += 14;
  drawTable(
    cols,
    d.forms.map((x, i) => [
      i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, unitLabel(x), modelLabel(x), x.inspector_name,
      fmtNum(x.hm_start), fmtNum(x.hm_end), RESULT_LABEL[x.result], x.signed ? x.sup_name : 'belum',
    ]),
    (r, i) => {
      const x = d.forms[i];
      return { colors: { 9: x.result === 'stop_aa' ? '#B3261E' : x.result === 'temuan_a' ? '#9A6700' : '#2E7D14' }, boldCol: 9 };
    },
  );
  if (!d.forms.length) T('Tidak ada P2H pada penyaring ini.', M, y + 6, 300, { size: 9, color: '#777777' });

  if (d.findings.length) {
    y += 14;
    if (y + 60 > PH - M) {
      doc.addPage();
      header();
    }
    T('Daftar temuan (rusak / perlu diperbaiki)', M, y, 400, { size: 10, bold: true });
    y += 14;
    const fc = [
      { h: 'Tanggal', w: 74 }, { h: 'Shift', w: 30, align: 'center' }, { h: 'No. Unit', w: 80 }, { h: 'Butir cek', w: 250 },
      { h: 'Kode', w: 32, align: 'center' }, { h: 'Kondisi', w: 48 }, { h: 'Catatan', w: 130 }, { h: 'Status', w: 0 },
    ];
    fc[fc.length - 1].w = PW - 2 * M - fc.slice(0, -1).reduce((a, c) => a + c.w, 0);
    drawTable(
      fc,
      d.findings.map((x) => [
        dateLabel(x.shift_date), shiftLabel(x.shift), x.unit_code, plain(x.item_text), x.danger_code, CONDITION_LABEL[x.condition],
        x.note || '', FIX_LABEL[x.fix_status] || '',
      ]),
      (r, i) => ({ colors: { 4: d.findings[i].danger_code === 'AA' ? '#B3261E' : '#111111' }, boldCol: 4 }),
    );
  }
  if (d.truncated) T(`Catatan: data dibatasi ${MAX_FORMS} P2H terbaru.`, M, y + 6, 400, { size: 7.5, color: '#777777' });

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

  const mtl = asset('mtl-logo.png');
  const lockup = asset('berau-lockup.png');
  const head = new Table({
    width: { size: 15500, type: WidthType.DXA },
    columnWidths: [1800, 11900, 1800],
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [
      new TableRow({
        children: [1800, 11900, 1800].map((w, i) =>
          new TableCell({
            width: { size: w, type: WidthType.DXA },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children:
              i === 0
                ? [para(mtl ? new ImageRun({ type: 'png', data: mtl, transformation: { width: 78, height: 42 } }) : run(''))]
                : i === 2
                  ? [para(lockup ? new ImageRun({ type: 'png', data: lockup, transformation: { width: 52, height: 44 } }) : run(''), { align: AlignmentType.RIGHT })]
                  : [para(run(d.title, { size: 30, bold: true }), { align: AlignmentType.CENTER }), para(run(d.subtitle, { size: 17, color: '444444' }), { align: AlignmentType.CENTER, before: 30 }), para(run(`Dibuat ${d.generated}`, { size: 13, color: '777777' }), { align: AlignmentType.CENTER })],
          }),
        ),
      }),
    ],
  });

  const sumTable = mkTable(
    [{ h: 'Total P2H', w: 3100, align: AlignmentType.CENTER }, { h: 'Semua baik', w: 3100, align: AlignmentType.CENTER }, { h: 'Ada temuan (A)', w: 3100, align: AlignmentType.CENTER }, { h: 'STOP (AA)', w: 3100, align: AlignmentType.CENTER }, { h: 'Belum TTD pengawas', w: 3100, align: AlignmentType.CENTER }],
    [[d.sum.total, d.sum.baik, d.sum.temuan, d.sum.stop, d.sum.unsigned]],
    (i, j) => ({ bold: true, color: ['111111', '2E7D14', '9A6700', 'B3261E', '555555'][j] }),
  );

  const cols = [
    { h: 'No', w: 560, align: AlignmentType.CENTER }, { h: 'Tanggal', w: 1500 }, { h: 'Shift', w: 600, align: AlignmentType.CENTER }, { h: 'Site', w: 1200 },
    { h: 'No. Unit', w: 2000 }, { h: 'Merk / Model', w: 1900 }, { h: 'Mekanik / Electrician', w: 2300 }, { h: 'HM Awal', w: 1000, align: AlignmentType.RIGHT },
    { h: 'HM Akhir', w: 1000, align: AlignmentType.RIGHT }, { h: 'Hasil', w: 1900 }, { h: 'Pengawas', w: 1540 },
  ];
  const formsTable = mkTable(
    cols,
    d.forms.map((x, i) => [i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, unitLabel(x), modelLabel(x), x.inspector_name, fmtNum(x.hm_start), fmtNum(x.hm_end), RESULT_LABEL[x.result], x.signed ? x.sup_name : 'belum']),
    (i, j) => (j === 9 ? { bold: true, color: resColor(d.forms[i].result) } : {}),
  );

  const kids = [head, para(run(''), { after: 80 }), sumTable, para(run('Daftar P2H', { bold: true, size: 20 }), { before: 160, after: 60 }), formsTable];

  if (d.findings.length) {
    const fc = [
      { h: 'Tanggal', w: 1500 }, { h: 'Shift', w: 600, align: AlignmentType.CENTER }, { h: 'No. Unit', w: 1700 }, { h: 'Butir cek', w: 4600 },
      { h: 'Kode', w: 640, align: AlignmentType.CENTER }, { h: 'Kondisi', w: 1000 }, { h: 'Catatan', w: 3200 }, { h: 'Status', w: 2260 },
    ];
    kids.push(
      para(run('Daftar temuan (rusak / perlu diperbaiki)', { bold: true, size: 20 }), { before: 200, after: 60 }),
      mkTable(
        fc,
        d.findings.map((x) => [dateLabel(x.shift_date), shiftLabel(x.shift), x.unit_code, plain(x.item_text), x.danger_code, CONDITION_LABEL[x.condition], x.note || '', FIX_LABEL[x.fix_status] || '']),
        (i, j) => (j === 4 ? { bold: true, color: d.findings[i].danger_code === 'AA' ? 'B3261E' : undefined } : {}),
      ),
    );
  }
  if (d.truncated) kids.push(para(run(`Catatan: data dibatasi ${MAX_FORMS} P2H terbaru.`, { size: 13, color: '777777' }), { before: 80 }));

  const doc = new Document({
    creator: 'P2H Genset',
    title: d.title,
    styles: { default: { document: { run: { font: FONT, size: 15 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 560, bottom: 560, left: 640, right: 640 } } }, children: kids }],
  });
  return { buffer: await Packer.toBuffer(doc), filename: `${d.filename}.docx` };
}
