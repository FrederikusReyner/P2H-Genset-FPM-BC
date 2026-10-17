import {
  AlignmentType, BorderStyle, Document, HeightRule, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { plain, segments } from '../../text.js';
import { FORM_REV, PENTING, TITLE, fitSize, formExportData } from './common.js';

const FONT = 'Calibri';
const RED = 'B3261E';
const AMBER = '9A6700';
const GREEN = '2E7D14';

// lebar kolom (satuan twip; 1 cm = 567). Total = 10.7 cm x ... muat A4 dengan margin 1 cm
const W = { no: 440, uraian: 4850, kode: 700, baik: 620, rusak: 620, perbaiki: 900, catatan: 2610 };
const TOTAL = Object.values(W).reduce((a, b) => a + b, 0); // 10740 (lebar tulis A4 = 10786)

const thin = { style: BorderStyle.SINGLE, size: 4, color: '222222' };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const allBorders = { top: thin, bottom: thin, left: thin, right: thin };

const run = (text, o = {}) =>
  new TextRun({ text: String(text ?? ''), font: FONT, size: o.size ?? 15, bold: o.bold, italics: o.italics, color: o.color });

const para = (children, o = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: o.align ?? AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line },
  });

function cell(children, { width, span, fill, align, v = VerticalAlign.CENTER, borders = allBorders, margins } = {}) {
  const arr = Array.isArray(children) ? children : [children];
  // potongan teks (tebal/biasa) dalam satu sel = SATU paragraf; kalau isinya paragraf-paragraf, pakai apa adanya
  const kids = arr.some((c) => c instanceof Paragraph) ? arr.map((c) => (c instanceof Paragraph ? c : para(c, { align }))) : [para(arr, { align })];
  return new TableCell({
    children: kids.length ? kids : [para(run(''))],
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: span,
    verticalAlign: v,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    borders,
    margins: margins ?? { top: 8, bottom: 8, left: 55, right: 55 },
  });
}

const rowOf = (cells, h = 195) => new TableRow({ children: cells, height: { value: h, rule: HeightRule.ATLEAST }, cantSplit: true });

const richRuns = (text, o = {}) => segments(text).map((s) => run(s.text, { ...o, bold: s.bold || o.bold }));

const tick = (color = '111111') => run('✓', { size: 15, bold: true, color });

function img(buf, w, h) {
  if (!buf) return null;
  return new ImageRun({ type: 'png', data: buf, transformation: { width: w, height: h } });
}

/** Bangun Word (.docx) satu form P2H. */
export async function buildFormDocx(id) {
  const data = await formExportData(id);
  if (!data) return null;
  const f = data.form;
  const kids = [];

  /* ---------- kepala ---------- */
  const mtl = img(data.logos.mtl, 68, 42); // logo MTL 249 x 155 px: jaga perbandingan supaya tidak gepeng / terpotong
  const berau = img(data.logos.berau, 52, 44);
  const chip =
    data.result === 'stop_aa' ? { t: 'HASIL: STOP OPERASI (AA)', c: RED } : data.result === 'temuan_a' ? { t: 'HASIL: ADA TEMUAN (A)', c: AMBER } : { t: 'HASIL: SEMUA BAIK', c: GREEN };
  kids.push(
    new Table({
      width: { size: TOTAL, type: WidthType.DXA },
      columnWidths: [1700, TOTAL - 3400, 1700],
      layout: TableLayoutType.FIXED,
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
      rows: [
        new TableRow({
          children: [
            cell(mtl ? para(mtl) : para(run('')), { width: 1700, borders: { top: none, bottom: none, left: none, right: none } }),
            cell(
              [
                para(run(TITLE, { size: 28, bold: true }), { align: AlignmentType.CENTER }),
                para(run(chip.t, { size: 16, bold: true, color: chip.c }), { align: AlignmentType.CENTER, before: 40 }),
                para(run(`STATUS: ${data.verify_text}`, { size: 13, bold: true, color: data.verified ? GREEN : '777777' }), { align: AlignmentType.CENTER, before: 10 }),
              ],
              { width: TOTAL - 3400, borders: { top: none, bottom: none, left: none, right: none } },
            ),
            cell(berau ? para(berau, { align: AlignmentType.RIGHT }) : para(run('')), { width: 1700, borders: { top: none, bottom: none, left: none, right: none } }),
          ],
        }),
      ],
    }),
  );
  kids.push(para(run('', { size: 6 }), { after: 10 }));

  /* ---------- identitas ---------- */
  const noB = { top: none, bottom: none, left: none, right: none };
  const underline = { top: none, left: none, right: none, bottom: { style: BorderStyle.DOTTED, size: 4, color: '555555' } };
  const L = [['NAMA', data.header.nama], ['HARI / TGL', data.header.hari_tgl], ['SHIFT', data.header.shift], ['LOKASI', data.header.lokasi], ['', '']];
  const R = [
    ['JOB SITE', data.header.job_site], ['MODEL UNIT', data.header.model_unit], ['NO. UNIT', data.header.no_unit],
    ['HM / KM AWAL', data.header.hm_awal], ['HM / KM AKHIR', data.header.hm_akhir],
  ];
  const cw = [1150, 3450, 250, 1350, 3450, 540];
  const infoRows = L.map((l, i) =>
    rowOf(
      [
        cell(run(l[0], { size: 15 }), { width: cw[0], borders: noB }),
        cell(l[0] ? run(l[1], { size: 17, bold: true }) : run(''), { width: cw[1], borders: l[0] ? underline : noB }),
        cell(run(''), { width: cw[2], borders: noB }),
        cell(run(R[i][0], { size: 15 }), { width: cw[3], borders: noB }),
        cell(run(R[i][1], { size: 17, bold: true }), { width: cw[4], borders: underline }),
        cell(run(''), { width: cw[5], borders: noB }),
      ],
      250,
    ),
  );
  kids.push(
    new Table({
      width: { size: TOTAL, type: WidthType.DXA },
      columnWidths: cw,
      layout: TableLayoutType.FIXED,
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
      rows: infoRows,
    }),
  );
  kids.push(para(run('', { size: 6 }), { after: 10 }));

  /* ---------- tabel cek ---------- */
  const G = 'E9E9E4';
  const S = 'F4F4F0';
  const hdr = (t, w, o = {}) => cell(para(run(t, { size: 14, bold: true }), { align: AlignmentType.CENTER }), { width: w, fill: G, ...o });
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        hdr('No', W.no, {}),
        hdr('URAIAN', W.uraian),
        cell([para(run('KODE', { size: 13, bold: true }), { align: AlignmentType.CENTER }), para(run('BAHAYA', { size: 13, bold: true }), { align: AlignmentType.CENTER })], { width: W.kode, fill: G }),
        cell(para(run('KONDISI', { size: 14, bold: true }), { align: AlignmentType.CENTER }), { width: W.baik + W.rusak + W.perbaiki, span: 3, fill: G }),
        hdr('CATATAN', W.catatan),
      ],
    }),
    new TableRow({
      tableHeader: true,
      children: [
        cell(run(''), { width: W.no, fill: G }),
        cell(run(''), { width: W.uraian, fill: G }),
        cell(run(''), { width: W.kode, fill: G }),
        hdr('BAIK', W.baik),
        hdr('RUSAK', W.rusak),
        hdr('PERBAIKI', W.perbaiki),
        cell(run(''), { width: W.catatan, fill: G }),
      ],
    }),
  ];
  for (const s of data.sections) {
    rows.push(
      rowOf(
        [
          cell(run(''), { width: W.no, fill: S }),
          cell(run(s.title, { size: 15, bold: true }), { width: W.uraian + W.kode + W.baik + W.rusak + W.perbaiki + W.catatan, span: 6, fill: S }),
        ],
        210,
      ),
    );
    for (const it of s.items) {
      const bad = it.condition !== 'baik';
      const fill = bad ? 'FBEDEB' : undefined;
      const note = it.note || it.hint;
      rows.push(
        rowOf(
          [
            cell(run(it.no, { size: 14 }), { width: W.no, align: AlignmentType.CENTER, fill }),
            cell(richRuns(it.text, { size: 14 }), { width: W.uraian, fill }),
            cell(run(it.danger, { size: 14, bold: true, color: it.danger === 'AA' ? RED : undefined }), { width: W.kode, align: AlignmentType.CENTER, fill }),
            cell(it.condition === 'baik' ? tick() : run(''), { width: W.baik, align: AlignmentType.CENTER, fill }),
            cell(it.condition === 'rusak' ? tick(RED) : run(''), { width: W.rusak, align: AlignmentType.CENTER, fill }),
            cell(it.condition === 'perbaiki' ? tick(AMBER) : run(''), { width: W.perbaiki, align: AlignmentType.CENTER, fill }),
            cell(run(note, { size: 13, italics: !it.note, color: it.note ? undefined : '666666' }), { width: W.catatan, fill }),
          ],
          210,
        ),
      );
    }
  }
  kids.push(new Table({ width: { size: TOTAL, type: WidthType.DXA }, columnWidths: Object.values(W), layout: TableLayoutType.FIXED, rows }));

  /* ---------- parameter panel ---------- */
  const pr = [
    rowOf(
      [
        cell(run(''), { width: W.no, fill: S }),
        cell(run('Parameter Panel Genset', { size: 15, bold: true }), { width: W.uraian, fill: S }),
        cell(para(run('Kosongan', { size: 14, bold: true }), { align: AlignmentType.CENTER }), { width: W.kode + W.baik, span: 2, fill: S }),
        cell(para(run('Berbeban', { size: 14, bold: true }), { align: AlignmentType.CENTER }), { width: W.rusak + W.perbaiki, span: 2, fill: S }),
        cell(run(''), { width: W.catatan, fill: S }),
      ],
      210,
    ),
    ...data.params.map((p, i) =>
      rowOf(
        [
          cell(run(i + 1, { size: 14 }), { width: W.no, align: AlignmentType.CENTER }),
          cell(run(p.label, { size: 14 }), { width: W.uraian }),
          cell(para([run(p.idle, { size: 16, bold: true }), run(p.idle ? `  ${p.unit}` : p.unit, { size: 12, color: '555555' })], { align: AlignmentType.RIGHT }), { width: W.kode + W.baik, span: 2 }),
          cell(para([run(p.load, { size: 16, bold: true }), run(p.load ? `  ${p.unit}` : p.unit, { size: 12, color: '555555' })], { align: AlignmentType.RIGHT }), { width: W.rusak + W.perbaiki, span: 2 }),
          cell(run(''), { width: W.catatan }),
        ],
        210,
      ),
    ),
  ];
  kids.push(new Table({ width: { size: TOTAL, type: WidthType.DXA }, columnWidths: Object.values(W), layout: TableLayoutType.FIXED, rows: pr }));

  /* ---------- catatan penting ---------- */
  kids.push(para(run('Penting :', { size: 14, italics: true }), { before: 30 }));
  for (const p of PENTING) {
    p.lines.forEach((ln, i) => {
      const m = /^(Kode Bahaya (?:AA|A))( = )(.*)$/.exec(ln);
      const runs = [run(i === 0 ? `${p.n}   ` : '     ', { size: 14 })];
      if (m) {
        runs.push(run(m[1], { size: 14, bold: true }), run(m[2], { size: 14 }));
        const stop = /^(.*)(\(STOP OPERASI\))$/.exec(m[3]);
        if (stop) runs.push(run(stop[1], { size: 14 }), run(stop[2], { size: 14, bold: true, color: RED }));
        else runs.push(run(m[3], { size: 14 }));
      } else runs.push(run(ln, { size: 14 }));
      kids.push(para(runs));
    });
  }
  kids.push(para(run('', { size: 6 }), { after: 10 }));

  /* ---------- tanda tangan + info tambahan ---------- */
  const sw = [2400, 2400, TOTAL - 4800];
  const signCell = (title, sign, width, pending) =>
    cell(
      [
        para(run(`Tanda Tangan · ${title}`, { size: 14, italics: true })),
        sign?.img
          ? para(img(sign.img, 96, 36), { align: AlignmentType.CENTER, before: 10 })
          : para(run(pending || '', { size: 13, bold: true, color: '8A8A80' }), { align: AlignmentType.CENTER, before: 130, after: 110 }),
        para(run(sign?.name ? `( ${sign.name} )` : '(                                      )', { size: 15, bold: true }), { align: AlignmentType.CENTER }),
        ...(sign?.nrp || sign?.company
          ? [para(run([sign.nrp ? `SID ${sign.nrp}` : '', sign.company].filter(Boolean).join(' · '), { size: 11, italics: true, color: '444444' }), { align: AlignmentType.CENTER })]
          : []),
        ...(sign?.verified ? [para(run(`TERVERIFIKASI ${sign.at}`, { size: 11, bold: true, color: GREEN }), { align: AlignmentType.CENTER })] : []),
      ],
      { width, v: VerticalAlign.TOP },
    );
  const info = [para(run('INFO TAMBAHAN dan TINDAK LANJUT :', { size: 14, bold: true }))];
  if (data.notes) info.push(para(run(data.notes, { size: 13 }), { before: 20 }));
  for (const fd of data.findings) {
    const st = fd.fix_status === 'closed' ? `SELESAI${fd.fix_at ? ' ' + fd.fix_at.slice(0, 10) : ''}${fd.fix_by ? ' oleh ' + fd.fix_by : ''}` : fd.fix_status === 'in_progress' ? 'sedang diperbaiki' : 'belum diperbaiki';
    info.push(
      para(run(`• [${fd.code}] ${fd.text} — ${fd.condition}${fd.note ? ': ' + fd.note : ''} (${st}${fd.fix_note ? ': ' + fd.fix_note : ''})`, { size: 12, color: fd.code === 'AA' ? RED : undefined }), { before: 20 }),
    );
  }
  kids.push(
    new Table({
      width: { size: TOTAL, type: WidthType.DXA },
      columnWidths: sw,
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            signCell('Teknisi', data.sign_mek, sw[0]),
            signCell('Pengawas', data.sign_sup, sw[1], 'MENUNGGU VERIFIKASI'),
            cell(info, { width: sw[2], v: VerticalAlign.TOP }),
          ],
        }),
      ],
    }),
  );

  kids.push(
    para(
      [
        run(`${FORM_REV}  ·  P2H #${f.id} · ${data.header.no_unit} · Shift ${data.header.shift} · ${data.long_date}  ·  Dikirim ${data.stamp}  ·  dibuat oleh aplikasi P2H Genset`, { size: 11, color: '777777' }),
      ],
      { before: 20 },
    ),
  );

  /* ---------- lampiran foto temuan (hanya bila ada foto) ---------- */
  const withPhotos = data.findings.filter((x) => x.images.length);
  if (withPhotos.length) {
    kids.push(
      new Paragraph({ children: [run('LAMPIRAN FOTO TEMUAN', { size: 26, bold: true })], pageBreakBefore: true }),
      para(run(`${data.header.no_unit} · ${data.header.hari_tgl} · Shift ${data.header.shift} · ${data.header.site}`, { size: 16, color: '444444' }), { after: 80 }),
    );
    const colW = Math.floor(TOTAL / 3);
    const light = { style: BorderStyle.SINGLE, size: 4, color: 'C9CDBF' };
    const lb = { top: light, bottom: light, left: light, right: light };
    for (const fd of withPhotos) {
      kids.push(
        para(run(`[${fd.code}] ${fd.text} — ${fd.condition}${fd.note ? ': ' + fd.note : ''}`, { size: 16, bold: true, color: fd.code === 'AA' ? RED : undefined }), { before: 140, after: 50 }),
      );
      const trs = [];
      for (let i = 0; i < fd.images.length; i += 3) {
        const chunk = fd.images.slice(i, i + 3);
        trs.push(
          new TableRow({
            cantSplit: true,
            children: [0, 1, 2].map((k) => {
              const im = chunk[k];
              const sz = im ? fitSize(im.buffer, 215, 165) : null;
              return cell(im ? para(new ImageRun({ type: im.mime === 'image/png' ? 'png' : 'jpg', data: im.buffer, transformation: sz }), { align: AlignmentType.CENTER }) : para(run('')), {
                width: colW,
                borders: im ? lb : { top: none, bottom: none, left: none, right: none },
                margins: { top: 40, bottom: 40, left: 40, right: 40 },
              });
            }),
          }),
        );
      }
      kids.push(new Table({ width: { size: colW * 3, type: WidthType.DXA }, columnWidths: [colW, colW, colW], layout: TableLayoutType.FIXED, rows: trs }));
    }
  }

  const doc = new Document({
    creator: 'P2H Genset',
    title: `${TITLE} - ${data.header.no_unit}`,
    description: `P2H ${data.header.hari_tgl} Shift ${data.header.shift}`,
    styles: { default: { document: { run: { font: FONT, size: 15 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 420, bottom: 340, left: 560, right: 560 } } },
        children: kids,
      },
    ],
  });
  return { buffer: await Packer.toBuffer(doc), filename: `${data.filename}.docx` };
}
