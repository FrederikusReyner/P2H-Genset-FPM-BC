import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  AlignmentType, BorderStyle, Document, HeightRule, ImageRun, Packer, PageOrientation, Paragraph, ShadingType, Table,
  TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { asset } from './common.js';
import { COLOR, docxBars, docxLegend, pdfCard, pdfCompliance, pdfHBars, pdfKpis, pdfStackTrend, pdfText, xlsxBar } from './visual.js';

/*
 * Pembuat laporan rekap bergaya dashboard (dipakai P2H Genset dan form digital lain).
 *
 * model = {
 *   title, subtitle, generated, filename, footer,
 *   kpis:   [{ label, value, note, color, ring? }]               angka utama (ring = persen untuk cincin)
 *   facts:  [[keterangan, nilai]]                                 ringkasan dalam kalimat
 *   charts: [{ type: 'stack' | 'compliance' | 'hbars', title, hint, rows, wide?, labels?, empty? }]
 *   summary:[tabel]   hanya di Excel (lembar Ringkasan), boleh punya kolom grafik { bar: { segs(ri), max } }
 *   lists:  [tabel]   daftar lengkap: lembar sendiri di Excel, halaman sendiri di PDF / Word
 *   notes:  [teks]
 * }
 * tabel = { title, sheet?, cols: [{ h, w, align?, wrap?, xlsxOnly? }], rows, colorOf?(ri, ci, cols), empty?, omitted? }
 */

const omittedNote = (tb) => (tb.omitted > 0 ? `${tb.omitted} baris lagi tidak dimuat di sini; unduh Excel untuk daftar lengkap.` : '');

/** Kolom yang hanya untuk Excel dibuang supaya muat di kertas. */
function docTable(tb) {
  const keep = tb.cols.map((c, i) => (c.xlsxOnly ? -1 : i)).filter((i) => i >= 0);
  return {
    ...tb,
    cols: keep.map((i) => tb.cols[i]),
    rows: tb.rows.map((r) => keep.map((i) => r[i])),
    colorOf: tb.colorOf ? (ri, j) => tb.colorOf(ri, keep[j], tb.cols) : null,
  };
}

/** Baris grafik tren yang kosong dibuang bila banyak (PDF batang tetap utuh; ini untuk Word). */
const denseRows = (rows, has) => (rows.length > 14 ? rows.filter(has) : rows);

/* ========================================================== EXCEL */

export async function renderXlsx(m) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'P2H Genset';
  wb.created = new Date();
  const font = (o = {}) => ({ name: 'Calibri', size: 10, ...o });
  const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR.ink}` } };
  const thin = { style: 'thin', color: { argb: `FF${COLOR.line}` } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

  const writeTable = (ws, r0, tb, { withTitle = true } = {}) => {
    let r = r0;
    if (withTitle) {
      ws.getCell(r, 1).value = tb.title;
      ws.getCell(r, 1).font = font({ bold: true, size: 11 });
      r += 1;
    }
    const heads = [...tb.cols.map((c) => c.h), ...(tb.bar ? ['Grafik'] : [])];
    const hr = ws.getRow(r);
    heads.forEach((h, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = h;
      cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
      cell.fill = HEAD;
      cell.border = BORDER;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    hr.height = 26;
    tb.rows.forEach((vals, ri) => {
      const row = ws.getRow(r + 1 + ri);
      vals.forEach((v, j) => {
        const cell = row.getCell(j + 1);
        cell.value = v;
        const color = tb.colorOf?.(ri, j, tb.cols);
        cell.font = font({ size: 9, bold: !!color, color: color ? { argb: `FF${color}` } : undefined });
        cell.border = BORDER;
        cell.alignment = { vertical: 'top', horizontal: tb.cols[j].align === 'center' ? 'center' : 'left', wrapText: !!tb.cols[j].wrap };
      });
      if (tb.bar) {
        const cell = row.getCell(vals.length + 1);
        cell.value = xlsxBar(tb.bar.segs(ri), tb.bar.max, tb.bar.width ?? 26);
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle' };
      }
    });
    if (!tb.rows.length && tb.empty) {
      ws.getCell(r + 1, 1).value = tb.empty;
      ws.getCell(r + 1, 1).font = font({ size: 9, italic: true, color: { argb: `FF${COLOR.muted}` } });
      return r + 3;
    }
    return r + 1 + tb.rows.length + 1;
  };

  // ---- Ringkasan: angka utama (dengan batang persen) + tabel ringkas bergrafik
  const ws = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }] });
  const widths = [];
  const fit = (i, w) => {
    widths[i] = Math.max(widths[i] ?? 0, w);
  };
  fit(0, 30);
  fit(1, 16);
  fit(2, 40);
  fit(3, 28);
  for (const tb of m.summary) {
    tb.cols.forEach((c, i) => fit(i, c.w + 2));
    if (tb.bar) fit(tb.cols.length, 28);
  }
  ws.columns = widths.map((w) => ({ width: w }));
  ws.getCell('A1').value = m.title;
  ws.getCell('A1').font = font({ size: 16, bold: true });
  ws.getCell('A2').value = m.subtitle;
  ws.getCell('A2').font = font({ color: { argb: 'FF555555' } });
  ws.getCell('A3').value = `Dibuat ${m.generated}`;
  ws.getCell('A3').font = font({ size: 9, color: { argb: 'FF777777' } });
  let r = writeTable(ws, 5, {
    title: 'Angka utama',
    cols: [{ h: 'Ukuran', w: 28 }, { h: 'Nilai', w: 14, align: 'center' }, { h: 'Keterangan', w: 38, wrap: true }],
    rows: m.kpis.map((k) => [k.label, k.value, k.note || '']),
    colorOf: (ri, j) => (j === 1 && m.kpis[ri].color !== COLOR.ink ? m.kpis[ri].color : null),
    bar: { segs: (ri) => (m.kpis[ri].ring != null ? [{ v: m.kpis[ri].ring, color: m.kpis[ri].color }, { v: 100 - m.kpis[ri].ring, color: COLOR.track }] : []), max: 100, width: 24 },
  });
  for (const [k, v] of m.facts) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = font({ size: 9, color: { argb: `FF${COLOR.muted}` } });
    ws.getCell(r, 2).value = v;
    ws.getCell(r, 2).font = font({ size: 9, bold: true });
    r += 1;
  }
  r += 1;
  for (const tb of m.summary) r = writeTable(ws, r, tb);
  for (const n of m.notes ?? []) {
    ws.getCell(r, 1).value = `Catatan: ${n}`;
    ws.getCell(r, 1).font = font({ size: 9, color: { argb: 'FF777777' } });
    r += 1;
  }

  // ---- daftar lengkap: satu lembar per tabel, ada penyaring kolom
  for (const tb of m.lists) {
    const sh = wb.addWorksheet(tb.sheet, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    sh.columns = tb.cols.map((c) => ({ width: c.w + 2 }));
    sh.mergeCells(1, 1, 1, tb.cols.length);
    sh.getCell(1, 1).value = `${m.title} — ${tb.title}`;
    sh.getCell(1, 1).font = font({ size: 14, bold: true });
    sh.mergeCells(2, 1, 2, tb.cols.length);
    sh.getCell(2, 1).value = `${m.subtitle}   ·   Dibuat ${m.generated}`;
    sh.getCell(2, 1).font = font({ size: 9, color: { argb: 'FF555555' } });
    writeTable(sh, 4, tb, { withTitle: false });
    if (tb.rows.length) sh.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: tb.cols.length } };
    sh.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    sh.pageSetup.printTitlesRow = '4:4';
    if (tb.omitted > 0) {
      const last = sh.lastRow.number + 2;
      sh.getCell(last, 1).value = `${tb.omitted} baris lagi tidak dimuat (batas unduhan). Persempit rentang tanggal.`;
      sh.getCell(last, 1).font = font({ size: 9, color: { argb: `FF${COLOR.stop}` } });
    }
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${m.filename}.xlsx` };
}

/* ========================================================== PDF */

export async function renderPdf(m) {
  const PW = 841.89;
  const PH = 595.28;
  const M = 26;
  const W = PW - 2 * M;
  const BOTTOM = PH - M - 12;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, bufferPages: true, info: { Title: m.title, Author: 'P2H Genset' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const T = pdfText(doc);
  const lockup = asset('berau-lockup.png');
  const mtl = asset('mtl-logo.png');
  let y = M;
  const header = () => {
    doc.save().rect(0, 0, PW, PH).fill('#F6F6F2').restore();
    if (mtl) doc.image(mtl, M, M, { fit: [52, 34] });
    if (lockup) doc.image(lockup, PW - M - 44, M - 2, { fit: [44, 38] });
    T(m.title, M + 62, M + 1, W - 124, { size: 14, bold: true, align: 'center' });
    T(m.subtitle, M + 62, M + 19, W - 124, { size: 8.4, align: 'center', color: '444444' });
    T(`Dibuat ${m.generated}`, M + 62, M + 30, W - 124, { size: 6.8, align: 'center', color: '777777' });
    y = M + 44;
  };
  const newPage = () => {
    doc.addPage();
    header();
  };

  // ---- halaman dashboard
  header();
  y += pdfKpis(doc, M, y, W, m.kpis) + 10;

  const heightOf = (c) => (c.type === 'hbars' ? 46 + Math.max(3, c.rows.length) * Math.min(22, 200 / Math.max(1, c.rows.length)) : 172);
  const draw = (c, x, yy, w, h) => {
    const box = pdfCard(doc, x, yy, w, h, c.title, c.hint);
    if (c.type === 'stack') pdfStackTrend(doc, box, c.rows, { labels: c.labels });
    else if (c.type === 'compliance') pdfCompliance(doc, box, c.rows);
    else pdfHBars(doc, box, c.rows, { empty: c.empty, stopLabel: c.labels?.[0], fixLabel: c.labels?.[1] });
  };
  const gap = 10;
  const half = (W - gap) / 2;
  const queue = [...m.charts];
  while (queue.length) {
    const c = queue.shift();
    if (c.wide || !queue.length || queue[0].wide) {
      const h = heightOf(c);
      if (y + h > BOTTOM) newPage();
      draw(c, M, y, W, h);
      y += h + gap;
    } else {
      const c2 = queue.shift();
      const h = Math.max(heightOf(c), heightOf(c2));
      if (y + h > BOTTOM) newPage();
      draw(c, M, y, half, h);
      draw(c2, M + half + gap, y, half, h);
      y += h + gap;
    }
  }
  if (m.facts.length) {
    const need = 20 + Math.ceil(m.facts.length / 2) * 11;
    if (y + need > BOTTOM) newPage();
    T('Ringkasan', M, y, 200, { size: 9.5, bold: true });
    y += 14;
    m.facts.forEach(([k, v], i) => {
      const x = M + (i % 2) * (W / 2);
      const yy = y + Math.floor(i / 2) * 11;
      T(k, x, yy, 150, { size: 7.4, color: COLOR.muted });
      T(String(v), x + 150, yy, W / 2 - 160, { size: 7.4, bold: true });
    });
    y += Math.ceil(m.facts.length / 2) * 11 + 6;
  }

  // ---- daftar lengkap
  const drawTable = (raw) => {
    const tb = docTable(raw);
    const total = tb.cols.reduce((a, c) => a + c.w, 0);
    const k = W / total;
    const cols = tb.cols.map((c) => ({ ...c, pw: c.w * k }));
    const head = () => {
      doc.save().rect(M, y, W, 16).fill(`#${COLOR.ink}`).restore();
      let x = M;
      for (const c of cols) {
        T(c.h, x + 3, y + 4.5, c.pw - 6, { size: 7.2, bold: true, color: 'FFFFFF', align: c.align });
        x += c.pw;
      }
      y += 16;
    };
    T(tb.title, M, y, W, { size: 10, bold: true });
    y += 14;
    head();
    if (!tb.rows.length) {
      doc.save().rect(M, y, W, 18).fill('#FFFFFF').restore();
      T(tb.empty || '-', M + 3, y + 5, W - 6, { size: 8, color: COLOR.muted });
      y += 18;
    }
    tb.rows.forEach((row, ri) => {
      if (y + 14 > BOTTOM) {
        newPage();
        head();
      }
      doc.save().rect(M, y, W, 14).fill(ri % 2 ? '#F1F2EC' : '#FFFFFF').restore();
      let x = M;
      cols.forEach((c, j) => {
        const color = tb.colorOf?.(ri, j);
        T(row[j], x + 3, y + 3.6, c.pw - 6, { size: 7.3, align: c.align, bold: !!color, color: color || undefined });
        x += c.pw;
      });
      doc.save().lineWidth(0.3).strokeColor(`#${COLOR.line}`).moveTo(M, y + 14).lineTo(M + W, y + 14).stroke().restore();
      y += 14;
    });
    const note = omittedNote(tb);
    if (note) {
      T(note, M, y + 3, W, { size: 7.4, color: COLOR.stop });
      y += 12;
    }
    y += 14;
  };
  m.lists.forEach((tb, i) => {
    // daftar pertama di halaman baru (kecuali halaman ini baru berisi ringkasan); berikutnya menyambung bila masih muat
    if (i === 0 ? y > M + 44 + 140 : y + 100 > BOTTOM) newPage();
    drawTable(tb);
  });
  for (const n of m.notes ?? []) {
    if (y + 12 > BOTTOM) newPage();
    T(`Catatan: ${n}`, M, y, W, { size: 7.2, color: '777777' });
    y += 10;
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    T(`Halaman ${i + 1} dari ${range.count}`, PW - M - 120, PH - M + 4, 120, { size: 7, color: '777777', align: 'right' });
    T(m.footer, M, PH - M + 4, 300, { size: 7, color: '777777' });
  }
  doc.end();
  return { buffer: await done, filename: `${m.filename}.pdf` };
}

/* ========================================================== WORD */

export async function renderDocx(m) {
  const FONT = 'Calibri';
  const FULL = 15500;
  const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font: FONT, size: o.size ?? 15, bold: o.bold, color: o.color });
  const para = (c, o = {}) =>
    new Paragraph({ children: Array.isArray(c) ? c : [c], alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0 }, pageBreakBefore: o.pageBreak, keepNext: o.keepNext });
  const thin = { style: BorderStyle.SINGLE, size: 4, color: COLOR.line };
  const B = { top: thin, bottom: thin, left: thin, right: thin };
  const C = AlignmentType.CENTER;
  const cell = (c, w, o = {}) =>
    new TableCell({
      children: Array.isArray(c) ? c : [para(c, { align: o.align })],
      width: { size: w, type: WidthType.DXA },
      borders: o.borders ?? B,
      verticalAlign: VerticalAlign.CENTER,
      shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: o.pad ?? 25, bottom: o.pad ?? 25, left: 70, right: 70 },
    });
  const mkTable = (raw) => {
    const tb = docTable(raw);
    const total = tb.cols.reduce((a, c) => a + c.w, 0);
    const widths = tb.cols.map((c) => Math.floor((c.w / total) * FULL));
    const rows = tb.rows.length ? tb.rows : [[tb.empty || '-', ...tb.cols.slice(1).map(() => '')]];
    return new Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ tableHeader: true, children: tb.cols.map((c, i) => cell(run(c.h, { bold: true, size: 14, color: 'FFFFFF' }), widths[i], { fill: COLOR.ink, align: C })) }),
        ...rows.map(
          (r, ri) =>
            new TableRow({
              cantSplit: true,
              height: { value: 250, rule: HeightRule.ATLEAST },
              children: r.map((v, j) => {
                const color = tb.rows.length ? tb.colorOf?.(ri, j) : COLOR.muted;
                return cell(run(v, { size: 14, bold: !!color && tb.rows.length > 0, color: color || undefined }), widths[j], {
                  align: tb.cols[j].align === 'center' ? C : undefined,
                  fill: ri % 2 ? 'F4F5F0' : undefined,
                });
              }),
            }),
        ),
      ],
    });
  };

  const mtl = asset('mtl-logo.png');
  const lockup = asset('berau-lockup.png');
  const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noB = { top: NB, bottom: NB, left: NB, right: NB };
  const head = new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: [1800, 11900, 1800],
    borders: { ...noB, insideHorizontal: NB, insideVertical: NB },
    rows: [
      new TableRow({
        children: [1800, 11900, 1800].map(
          (w, i) =>
            new TableCell({
              width: { size: w, type: WidthType.DXA },
              borders: noB,
              children:
                i === 0
                  ? [para(mtl ? new ImageRun({ type: 'png', data: mtl, transformation: { width: 68, height: 42 } }) : run(''))]
                  : i === 2
                    ? [para(lockup ? new ImageRun({ type: 'png', data: lockup, transformation: { width: 52, height: 44 } }) : run(''), { align: AlignmentType.RIGHT })]
                    : [para(run(m.title, { size: 28, bold: true }), { align: C }), para(run(m.subtitle, { size: 17, color: '444444' }), { align: C, before: 30 }), para(run(`Dibuat ${m.generated}`, { size: 13, color: '777777' }), { align: C })],
            }),
        ),
      }),
    ],
  });

  // angka utama: kartu berwarna dengan garis tepi kiri sesuai nadanya
  const kw = Math.floor(FULL / m.kpis.length);
  const kpis = new Table({
    width: { size: kw * m.kpis.length, type: WidthType.DXA },
    columnWidths: m.kpis.map(() => kw),
    layout: TableLayoutType.FIXED,
    borders: { ...noB, insideHorizontal: NB, insideVertical: NB },
    rows: [
      new TableRow({
        children: m.kpis.map((k) =>
          cell(
            [
              para(run(k.label.toUpperCase(), { size: 12, bold: true, color: COLOR.muted })),
              para(run(k.value, { size: 30, bold: true, color: k.color === COLOR.ok ? COLOR.ink : k.color }), { before: 20 }),
              para(run(k.note || ' ', { size: 12, color: COLOR.muted })),
            ],
            kw,
            { borders: { top: thin, bottom: thin, right: thin, left: { style: BorderStyle.SINGLE, size: 24, color: k.color } }, pad: 60 },
          ),
        ),
      }),
    ],
  });

  const kids = [head, para(run(''), { after: 80 }), kpis];
  const section = (title, hint, body, legend) => {
    kids.push(para(run(title, { bold: true, size: 20 }), { before: 220, after: hint ? 0 : 40, keepNext: true }));
    if (hint) kids.push(para(run(hint, { size: 13, color: COLOR.muted }), { after: 40, keepNext: true }));
    if (legend) kids.push(docxLegend(legend));
    kids.push(body);
  };
  for (const c of m.charts) {
    if (c.type === 'stack') {
      const rows = denseRows(c.rows, (r) => r.ok + r.warn + r.stop > 0);
      const lab = c.labels ?? ['Baik', 'Ada temuan', 'STOP'];
      section(
        c.title,
        `${c.hint ?? ''}${rows.length < c.rows.length ? ' Periode tanpa isian tidak ditampilkan.' : ''}`.trim(),
        docxBars(
          rows.map((r) => ({ label: r.label, segs: [{ v: r.ok, color: COLOR.ok }, { v: r.warn, color: COLOR.warn }, { v: r.stop, color: COLOR.stop }], text: String(r.ok + r.warn + r.stop) })),
          { empty: c.empty ?? 'Belum ada isian.' },
        ),
        [
          [lab[0], COLOR.ok],
          [lab[1], COLOR.warn],
          [lab[2], COLOR.stop],
        ],
      );
    } else if (c.type === 'compliance') {
      const rows = c.rows.length > 16 ? c.rows.slice(-16) : c.rows;
      section(
        c.title,
        `${c.hint ?? ''}${rows.length < c.rows.length ? ` ${rows.length} periode terakhir.` : ''}`.trim(),
        docxBars(
          rows.map((r) => ({ label: r.label, sub: r.expected ? `${r.done} dari ${r.expected}` : '', segs: [{ v: r.pct ?? 0, color: r.pct >= 100 ? COLOR.ok : r.pct >= 50 ? COLOR.warn : COLOR.stop }], text: r.pct == null ? '-' : `${r.pct}%`, textColor: r.pct >= 100 ? COLOR.ok : r.pct >= 50 ? COLOR.warn : COLOR.stop })),
          { max: 100 },
        ),
      );
    } else {
      const lab = c.labels ?? ['STOP', 'Perbaiki'];
      section(
        c.title,
        c.hint,
        docxBars(
          c.rows.map((r) => ({ label: r.label, sub: r.sub, segs: [{ v: r.stop, color: COLOR.stop }, { v: r.fix, color: COLOR.warn }], text: String(r.stop + r.fix) })),
          { empty: c.empty },
        ),
        c.rows.length
          ? [
              [lab[0], COLOR.stop],
              [lab[1], COLOR.warn],
            ]
          : null,
      );
    }
  }
  if (m.facts.length) {
    const fw = [5200, 10300];
    section(
      'Ringkasan',
      null,
      new Table({
        width: { size: FULL, type: WidthType.DXA },
        columnWidths: fw,
        layout: TableLayoutType.FIXED,
        rows: m.facts.map(([k, v], i) => new TableRow({ children: [cell(run(k, { size: 14, color: COLOR.muted }), fw[0], { fill: i % 2 ? 'F4F5F0' : undefined }), cell(run(v, { size: 14, bold: true }), fw[1], { fill: i % 2 ? 'F4F5F0' : undefined })] })),
      }),
    );
  }
  for (const tb of m.lists) {
    kids.push(para(run(tb.title, { bold: true, size: 20 }), { pageBreak: true, after: 60, keepNext: true }), mkTable(tb));
    const note = omittedNote(tb);
    if (note) kids.push(para(run(note, { size: 14, color: COLOR.stop }), { before: 60 }));
  }
  for (const n of m.notes ?? []) kids.push(para(run(`Catatan: ${n}`, { size: 13, color: '777777' }), { before: 60 }));

  const doc = new Document({
    creator: 'P2H Genset',
    title: m.title,
    styles: { default: { document: { run: { font: FONT, size: 15 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 560, bottom: 560, left: 640, right: 640 } } }, children: kids }],
  });
  return { buffer: await Packer.toBuffer(doc), filename: `${m.filename}.docx` };
}

export const RENDER = { xlsx: renderXlsx, pdf: renderPdf, docx: renderDocx };
