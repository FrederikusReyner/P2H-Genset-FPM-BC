import { BorderStyle, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';

/*
 * Grafik untuk unduhan rekap (gaya dashboard):
 *  - PDF  : grafik vektor (batang bertumpuk, kepatuhan, batang mendatar, cincin persen) dengan pdfkit
 *  - Word : batang mendatar dari sel tabel berwarna (tampil sama di Word, LibreOffice, Google Docs)
 *  - Excel: batang dari karakter blok berwarna di dalam sel (rich text), jalan di semua versi Excel
 */

export const COLOR = { ok: '4C8C2B', warn: 'D89B00', stop: 'C62828', ink: '14170F', muted: '6B6F63', grid: 'E3E5DC', line: 'C9CDBF', track: 'E9EBE3' };
export const toneColor = (pct) => (pct == null ? COLOR.muted : pct >= 100 ? COLOR.ok : pct >= 50 ? COLOR.warn : COLOR.stop);

/** Angka sumbu yang "bulat" (4, 5, 10, 20, 50, ...). */
export function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/* ============================================================== PDF */

const hex = (c) => `#${c}`;

/** Penulis teks satu baris (dipotong "…" bila kepanjangan). */
export function pdfText(doc) {
  return (s, x, y, w, o = {}) =>
    doc
      .font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(o.size ?? 8)
      .fillColor(o.color ? hex(o.color) : '#111111')
      // tinggi dibatasi satu baris supaya teks panjang dipotong "…", bukan turun ke baris berikutnya
      .text(String(s ?? ''), x, y, { width: Math.max(1, w), height: (o.size ?? 8) * 1.3, align: o.align ?? 'left', lineBreak: false, ellipsis: true });
}

/** Kartu berbingkai dengan judul; mengembalikan kotak isi. */
export function pdfCard(doc, x, y, w, h, title, hint) {
  const T = pdfText(doc);
  doc.save().roundedRect(x, y, w, h, 5).lineWidth(0.6).fillAndStroke('#FFFFFF', hex(COLOR.line)).restore();
  T(title, x + 10, y + 8, w - 20, { size: 9.5, bold: true });
  if (hint) T(hint, x + 10, y + 20, w - 20, { size: 6.8, color: COLOR.muted });
  const top = hint ? 32 : 24;
  return { x: x + 10, y: y + top, w: w - 20, h: h - top - 8 };
}

/** Cincin persen (seperti di layar). */
export function pdfRing(doc, cx, cy, r, pct, color) {
  doc.save().lineWidth(4).strokeColor(hex(COLOR.track)).circle(cx, cy, r).stroke().restore();
  const p = Math.max(0, Math.min(100, pct ?? 0));
  if (p <= 0) return;
  if (p >= 100) {
    doc.save().lineWidth(4).strokeColor(hex(color)).circle(cx, cy, r).stroke().restore();
    return;
  }
  const a = (p / 100) * Math.PI * 2;
  const x1 = cx;
  const y1 = cy - r;
  const x2 = cx + r * Math.sin(a);
  const y2 = cy - r * Math.cos(a);
  doc.save().lineWidth(4).lineCap('round').strokeColor(hex(color)).path(`M ${x1} ${y1} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2} ${y2}`).stroke().restore();
}

/**
 * Deretan kotak angka utama. tiles: { label, value, note, color, ring? (persen) }
 * Mengembalikan tinggi yang dipakai.
 */
export function pdfKpis(doc, x, y, w, tiles, { h = 50, gap = 6 } = {}) {
  const T = pdfText(doc);
  const tw = (w - (tiles.length - 1) * gap) / tiles.length;
  tiles.forEach((t, i) => {
    const tx = x + i * (tw + gap);
    doc.save().roundedRect(tx, y, tw, h, 5).lineWidth(0.6).fillAndStroke('#FFFFFF', hex(COLOR.line)).restore();
    doc.save().rect(tx, y + 6, 3, h - 12).fill(hex(t.color)).restore();
    let lx = tx + 10;
    if (t.ring != null) {
      pdfRing(doc, tx + 24, y + h / 2, 13, t.ring, t.color);
      lx = tx + 44;
    }
    const lw = tx + tw - lx - 6;
    T(t.label.toUpperCase(), lx, y + 7, lw, { size: 6.4, bold: true, color: COLOR.muted });
    T(t.value, lx, y + 17, lw, { size: 15, bold: true, color: t.color === COLOR.ok || t.color === COLOR.ink ? COLOR.ink : t.color });
    if (t.note) T(t.note, lx, y + 36, lw, { size: 6.4, color: COLOR.muted });
  });
  return h;
}

function legend(doc, x, y, items) {
  const T = pdfText(doc);
  let lx = x;
  for (const [label, color] of items) {
    doc.save().rect(lx, y + 1.5, 6, 6).fill(hex(color)).restore();
    T(label, lx + 9, y, 80, { size: 6.8, color: COLOR.muted });
    lx += 14 + doc.font('Helvetica').fontSize(6.8).widthOfString(label);
  }
}

/** Sumbu Y dengan garis kisi; mengembalikan fungsi nilai -> y. */
function yAxis(doc, box, max, fmt = (v) => String(v)) {
  const T = pdfText(doc);
  const ph = box.h - 14; // ruang label sumbu X di bawah
  const y = (v) => box.y + ph - (ph * v) / max;
  for (let i = 0; i <= 4; i += 1) {
    const v = (max / 4) * i;
    const yy = y(v);
    doc.save().lineWidth(0.4).strokeColor(hex(COLOR.grid)).moveTo(box.x + 22, yy).lineTo(box.x + box.w, yy).stroke().restore();
    T(fmt(Math.round(v)), box.x, yy - 3, 19, { size: 6, color: COLOR.muted, align: 'right' });
  }
  return { y, base: box.y + ph };
}

/** Label sumbu X: dijarangkan bila batangnya rapat. */
function xLabels(doc, box, labels, slot, x0) {
  const T = pdfText(doc);
  const every = Math.max(1, Math.ceil(34 / slot));
  labels.forEach((l, i) => {
    // label terakhir ikut ditulis hanya bila tidak menabrak label sebelumnya
    const last = i === labels.length - 1 && i % every >= Math.ceil(every / 2);
    if (i % every && !last) return;
    T(l, x0 + i * slot + slot / 2 - 20, box.y + box.h - 9, 40, { size: 6, color: COLOR.muted, align: 'center' });
  });
}

/** Batang bertumpuk Baik / Ada temuan / STOP per hari / minggu / bulan. rows: { label, ok, warn, stop } */
export function pdfStackTrend(doc, box, rows, { labels = ['Baik', 'Ada temuan', 'STOP'] } = {}) {
  const T = pdfText(doc);
  legend(doc, box.x + box.w - 170, box.y - 16, [
    [labels[0], COLOR.ok],
    [labels[1], COLOR.warn],
    [labels[2], COLOR.stop],
  ]);
  const max = niceMax(Math.max(1, ...rows.map((r) => r.ok + r.warn + r.stop)));
  const ax = yAxis(doc, box, max);
  const x0 = box.x + 24;
  const slot = (box.w - 24) / Math.max(1, rows.length);
  const bw = Math.min(20, slot * 0.66);
  rows.forEach((r, i) => {
    const bx = x0 + i * slot + (slot - bw) / 2;
    let acc = 0;
    for (const [v, c] of [
      [r.ok, COLOR.ok],
      [r.warn, COLOR.warn],
      [r.stop, COLOR.stop],
    ]) {
      if (!v) continue;
      const y1 = ax.y(acc + v);
      const y2 = ax.y(acc);
      doc.save().rect(bx, y1, bw, Math.max(0.6, y2 - y1)).fill(hex(c)).restore();
      acc += v;
    }
    if (acc && slot >= 13) T(acc, bx - 6, ax.y(acc) - 8, bw + 12, { size: 6, align: 'center', bold: true });
  });
  xLabels(doc, box, rows.map((r) => r.label), slot, x0);
}

/** Kepatuhan per periode: batang persen dengan garis 100%. rows: { label, pct, done, expected } */
export function pdfCompliance(doc, box, rows) {
  const T = pdfText(doc);
  const ax = yAxis(doc, box, 100, (v) => `${v}%`);
  const x0 = box.x + 24;
  const slot = (box.w - 24) / Math.max(1, rows.length);
  const bw = Math.min(20, slot * 0.66);
  rows.forEach((r, i) => {
    const bx = x0 + i * slot + (slot - bw) / 2;
    const p = r.pct ?? 0;
    if (p > 0) doc.save().rect(bx, ax.y(p), bw, ax.base - ax.y(p)).fill(hex(toneColor(r.pct))).restore();
    if (slot >= 15 && r.pct != null) T(`${r.pct}%`, bx - 8, ax.y(p) - 8, bw + 16, { size: 6, align: 'center', bold: true, color: toneColor(r.pct) });
  });
  doc.save().lineWidth(0.8).dash(3, { space: 2 }).strokeColor(hex(COLOR.ok)).moveTo(x0, ax.y(100)).lineTo(box.x + box.w, ax.y(100)).stroke().undash().restore();
  xLabels(doc, box, rows.map((r) => r.label), slot, x0);
}

/** Batang mendatar STOP + perbaiki (butir / objek paling bermasalah). rows: { label, sub, stop, fix, note } */
export function pdfHBars(doc, box, rows, { empty = 'Tidak ada temuan.', stopLabel = 'STOP', fixLabel = 'Perbaiki' } = {}) {
  const T = pdfText(doc);
  if (!rows.length) {
    T(empty, box.x, box.y + 4, box.w, { size: 8, color: COLOR.muted });
    return;
  }
  legend(doc, box.x + box.w - 110, box.y - 16, [
    [stopLabel, COLOR.stop],
    [fixLabel, COLOR.warn],
  ]);
  const max = Math.max(1, ...rows.map((r) => r.stop + r.fix));
  const rh = Math.min(22, box.h / rows.length);
  const lw = box.w * 0.42;
  const bx = box.x + lw + 6;
  const bwMax = box.w - lw - 6 - 26;
  rows.forEach((r, i) => {
    const y = box.y + i * rh;
    T(r.label, box.x, y + (r.sub ? 1 : 4), lw, { size: 7.4, bold: true });
    if (r.sub) T(r.sub, box.x, y + 10, lw, { size: 6, color: COLOR.muted });
    doc.save().roundedRect(bx, y + 3, bwMax, rh - 8, 2).fill(hex(COLOR.track)).restore();
    let acc = 0;
    for (const [v, c] of [
      [r.stop, COLOR.stop],
      [r.fix, COLOR.warn],
    ]) {
      if (!v) continue;
      const w = (bwMax * v) / max;
      doc.save().rect(bx + acc, y + 3, w, rh - 8).fill(hex(c)).restore();
      acc += w;
    }
    T(r.stop + r.fix, bx + bwMax + 4, y + 4, 22, { size: 7.4, bold: true });
  });
}

/* ============================================================== WORD */

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDER = { top: NONE, bottom: NONE, left: NONE, right: NONE };

/**
 * Grafik batang mendatar sebagai tabel Word.
 * rows: { label, sub?, segs: [{ v, color }], text }  ·  max: nilai penuh batang (default: terbesar)
 */
export function docxBars(rows, { max, labelW = 3600, barW = 8200, textW = 1500, font = 'Calibri', empty = 'Tidak ada data.' } = {}) {
  const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font, size: o.size ?? 15, bold: o.bold, color: o.color });
  const total = labelW + barW + textW;
  if (!rows.length) {
    return new Table({
      width: { size: total, type: WidthType.DXA },
      columnWidths: [total],
      borders: { ...NO_BORDER, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new TableRow({ children: [new TableCell({ borders: NO_BORDER, width: { size: total, type: WidthType.DXA }, children: [new Paragraph({ children: [run(empty, { color: COLOR.muted })] })] })] })],
    });
  }
  const m = max ?? Math.max(1, ...rows.map((r) => r.segs.reduce((a, s) => a + (s.v || 0), 0)));
  const bar = (segs) => {
    const parts = [];
    let used = 0;
    for (const s of segs) {
      if (!s.v) continue;
      const w = Math.max(60, Math.round((barW * Math.min(s.v, m)) / m));
      if (used + w > barW) break;
      parts.push({ w, fill: s.color });
      used += w;
    }
    if (barW - used >= 20) parts.push({ w: barW - used, fill: COLOR.track });
    return new Table({
      width: { size: barW, type: WidthType.DXA },
      columnWidths: parts.map((p) => p.w),
      layout: TableLayoutType.FIXED,
      borders: { ...NO_BORDER, insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({
          height: { value: 200, rule: 'exact' },
          children: parts.map(
            (p) =>
              new TableCell({
                width: { size: p.w, type: WidthType.DXA },
                borders: NO_BORDER,
                shading: { type: ShadingType.CLEAR, color: 'auto', fill: p.fill },
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                children: [new Paragraph({ children: [run('', { size: 2 })] })],
              }),
          ),
        }),
      ],
    });
  };
  const cell = (w, children, o = {}) =>
    new TableCell({ width: { size: w, type: WidthType.DXA }, borders: NO_BORDER, verticalAlign: VerticalAlign.CENTER, margins: { top: 30, bottom: 30, left: o.left ?? 0, right: 60 }, children });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: [labelW, barW, textW],
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDER, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLOR.grid }, insideVertical: NONE },
    rows: rows.map(
      (r) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(labelW, [new Paragraph({ children: [run(r.label, { bold: true })] }), ...(r.sub ? [new Paragraph({ children: [run(r.sub, { size: 12, color: COLOR.muted })] })] : [])]),
            cell(barW, [bar(r.segs), new Paragraph({ children: [run('', { size: 2 })] })]),
            cell(textW, [new Paragraph({ children: [run(r.text, { bold: true, color: r.textColor })] })], { left: 60 }),
          ],
        }),
    ),
  });
}

/** Keterangan warna untuk grafik Word. */
export function docxLegend(items, font = 'Calibri') {
  const kids = [];
  for (const [label, color] of items) {
    kids.push(new TextRun({ text: '■ ', font, size: 16, color }), new TextRun({ text: `${label}    `, font, size: 14, color: COLOR.muted }));
  }
  return new Paragraph({ children: kids, spacing: { after: 40 } });
}

/* ============================================================== EXCEL */

/** Batang dari karakter blok berwarna (rich text) untuk satu sel Excel. segs: [{ v, color }] */
export function xlsxBar(segs, max, width = 26) {
  const richText = [];
  let used = 0;
  for (const s of segs) {
    if (!s.v) continue;
    const n = Math.max(1, Math.round((width * s.v) / Math.max(1, max)));
    const k = Math.min(n, width - used);
    if (k <= 0) break;
    richText.push({ text: '█'.repeat(k), font: { name: 'Calibri', size: 9, color: { argb: `FF${s.color}` } } });
    used += k;
  }
  if (!richText.length) richText.push({ text: ' ', font: { name: 'Calibri', size: 9 } });
  return { richText };
}
