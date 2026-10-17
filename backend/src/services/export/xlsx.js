import ExcelJS from 'exceljs';
import { plain, segments } from '../../text.js';
import { FORM_REV, PENTING, TITLE, formExportData } from './common.js';

const RED = 'FFB3261E';
const AMBER = 'FF9A6700';
const GREEN = 'FF2E7D14';
const GRAY = 'FFE9E9E4';
const SOFT = 'FFF4F4F0';
const PINK = 'FFFBEDEB';
const thin = { style: 'thin', color: { argb: 'FF222222' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

const rich = (text, size = 9) => ({
  richText: segments(text).map((s) => ({ text: s.text, font: { name: 'Calibri', size, bold: s.bold } })),
});

/** Bangun Excel (.xlsx) satu form P2H, tampilannya mengikuti form kertas. */
export async function buildFormXlsx(id) {
  const data = await formExportData(id);
  if (!data) return null;
  const f = data.form;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'P2H Genset';
  wb.created = new Date();
  const ws = wb.addWorksheet('P2H', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
      margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [{ width: 5 }, { width: 60 }, { width: 9 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 38 }];
  const font = (o = {}) => ({ name: 'Calibri', size: 9, ...o });
  let r = 1;

  /* ---------- kepala ---------- */
  ws.getRow(1).height = 40;
  ws.mergeCells('B1:F1');
  Object.assign(ws.getCell('B1'), { value: TITLE });
  ws.getCell('B1').font = font({ size: 15, bold: true });
  ws.getCell('B1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells('B2:F2');
  const chip = data.result === 'stop_aa' ? ['HASIL: STOP OPERASI (AA)', RED] : data.result === 'temuan_a' ? ['HASIL: ADA TEMUAN (A)', AMBER] : ['HASIL: SEMUA BAIK', GREEN];
  ws.getCell('B2').value = chip[0];
  ws.getCell('B2').font = font({ size: 10, bold: true, color: { argb: chip[1] } });
  ws.getCell('B2').alignment = { horizontal: 'center' };
  if (data.logos.mtl) {
    const id1 = wb.addImage({ buffer: data.logos.mtl, extension: 'png' });
    ws.addImage(id1, { tl: { col: 0.15, row: 0.15 }, ext: { width: 84, height: 45 } });
  }
  if (data.logos.berau) {
    const id2 = wb.addImage({ buffer: data.logos.berau, extension: 'png' });
    ws.addImage(id2, { tl: { col: 6.55, row: 0.1 }, ext: { width: 54, height: 45 } });
  }
  r = 4;

  /* ---------- identitas ---------- */
  const L = [['NAMA', data.header.nama], ['HARI / TGL', data.header.hari_tgl], ['SHIFT', data.header.shift], ['LOKASI', data.header.lokasi]];
  const R = [
    ['JOB SITE', data.header.job_site], ['MODEL UNIT', data.header.model_unit], ['NO. UNIT', data.header.no_unit],
    ['HM / KM AWAL', f.hm_start], ['HM / KM AKHIR', f.hm_end],
  ];
  for (let i = 0; i < 5; i += 1) {
    const row = ws.getRow(r + i);
    row.height = 16;
    if (L[i]) {
      const c = ws.getCell(`B${r + i}`);
      c.value = { richText: [{ text: `${L[i][0].padEnd(12, ' ')} :  `, font: font({ size: 9 }) }, { text: String(L[i][1] ?? ''), font: font({ size: 10, bold: true }) }] };
      c.border = { bottom: { style: 'dotted', color: { argb: 'FF666666' } } };
    }
    ws.mergeCells(`D${r + i}:G${r + i}`);
    const c2 = ws.getCell(`D${r + i}`);
    const isNum = typeof R[i][1] === 'number';
    c2.value = {
      richText: [
        { text: `${R[i][0].padEnd(14, ' ')} :  `, font: font({ size: 9 }) },
        { text: R[i][1] == null ? '' : isNum ? String(R[i][1]).replace('.', ',') : String(R[i][1]), font: font({ size: 10, bold: true }) },
      ],
    };
    c2.border = { bottom: { style: 'dotted', color: { argb: 'FF666666' } } };
  }
  r += 6;

  /* ---------- tabel cek ---------- */
  const head = (addr, v, extra = {}) => {
    const c = ws.getCell(addr);
    c.value = v;
    c.font = font({ bold: true, size: 9 });
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
    c.border = BORDER;
    Object.assign(c, extra);
  };
  ws.mergeCells(`A${r}:A${r + 1}`); head(`A${r}`, 'No');
  ws.mergeCells(`B${r}:B${r + 1}`); head(`B${r}`, 'URAIAN');
  ws.mergeCells(`C${r}:C${r + 1}`); head(`C${r}`, 'KODE\nBAHAYA');
  ws.mergeCells(`D${r}:F${r}`); head(`D${r}`, 'KONDISI');
  ws.mergeCells(`G${r}:G${r + 1}`); head(`G${r}`, 'CATATAN');
  head(`D${r + 1}`, 'BAIK'); head(`E${r + 1}`, 'RUSAK'); head(`F${r + 1}`, 'PERBAIKI');
  for (const col of 'ABCDEFG') { ws.getCell(`${col}${r + 1}`).border = BORDER; ws.getCell(`${col}${r}`).border = BORDER; }
  ws.getRow(r).height = 15; ws.getRow(r + 1).height = 15;
  const tableHeadRow = r;
  r += 2;

  for (const s of data.sections) {
    ws.mergeCells(`B${r}:G${r}`);
    ws.getCell(`A${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    ws.getCell(`B${r}`).value = s.title;
    ws.getCell(`B${r}`).font = font({ bold: true, size: 9 });
    ws.getCell(`B${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    for (const col of 'ABCDEFG') ws.getCell(`${col}${r}`).border = BORDER;
    ws.getRow(r).height = 15;
    r += 1;
    for (const it of s.items) {
      const bad = it.condition !== 'baik';
      const row = ws.getRow(r);
      row.getCell(1).value = it.no;
      row.getCell(2).value = rich(it.text, 9);
      row.getCell(3).value = it.danger;
      row.getCell(4).value = it.condition === 'baik' ? '✓' : '';
      row.getCell(5).value = it.condition === 'rusak' ? '✓' : '';
      row.getCell(6).value = it.condition === 'perbaiki' ? '✓' : '';
      row.getCell(7).value = it.note || it.hint || '';
      for (let c = 1; c <= 7; c += 1) {
        const cell = row.getCell(c);
        cell.border = BORDER;
        cell.font = font({ size: 9 });
        cell.alignment = { vertical: 'middle', horizontal: [2, 7].includes(c) ? 'left' : 'center', wrapText: c === 2 || c === 7 };
        if (bad) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } };
      }
      row.getCell(3).font = font({ bold: true, color: it.danger === 'AA' ? { argb: RED } : undefined });
      row.getCell(4).font = font({ bold: true, size: 12 });
      row.getCell(5).font = font({ bold: true, size: 12, color: { argb: RED } });
      row.getCell(6).font = font({ bold: true, size: 12, color: { argb: AMBER } });
      row.getCell(7).font = font({ size: 8, italic: !it.note, color: { argb: it.note ? 'FF111111' : 'FF666666' } });
      row.height = Math.max(15, plain(it.text).length > 70 || (it.note || it.hint).length > 40 ? 26 : 15);
      r += 1;
    }
  }

  /* ---------- parameter ---------- */
  ws.mergeCells(`C${r}:D${r}`);
  ws.mergeCells(`E${r}:F${r}`);
  ws.getCell(`B${r}`).value = 'Parameter Panel Genset';
  ws.getCell(`C${r}`).value = 'Kosongan';
  ws.getCell(`E${r}`).value = 'Berbeban';
  for (const col of 'ABCDEFG') {
    const c = ws.getCell(`${col}${r}`);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    c.border = BORDER;
    c.font = font({ bold: true });
    c.alignment = { horizontal: col === 'B' ? 'left' : 'center', vertical: 'middle' };
  }
  ws.getRow(r).height = 15;
  r += 1;
  data.params.forEach((p, i) => {
    ws.mergeCells(`C${r}:D${r}`);
    ws.mergeCells(`E${r}:F${r}`);
    ws.getCell(`A${r}`).value = i + 1;
    ws.getCell(`B${r}`).value = p.label;
    const fmt = `General" ${p.unit}"`;
    ws.getCell(`C${r}`).value = p.idle_n ?? null;
    ws.getCell(`C${r}`).numFmt = fmt;
    ws.getCell(`E${r}`).value = p.load_n ?? null;
    ws.getCell(`E${r}`).numFmt = fmt;
    for (const col of 'ABCDEFG') {
      const c = ws.getCell(`${col}${r}`);
      c.border = BORDER;
      c.font = font({ bold: col === 'C' || col === 'E', size: col === 'C' || col === 'E' ? 10 : 9 });
      c.alignment = { horizontal: col === 'B' ? 'left' : 'center', vertical: 'middle' };
    }
    ws.getRow(r).height = 15;
    r += 1;
  });

  /* ---------- penting ---------- */
  r += 1;
  ws.getCell(`A${r}`).value = 'Penting :';
  ws.getCell(`A${r}`).font = font({ italic: true, size: 8 });
  r += 1;
  for (const p of PENTING) {
    p.lines.forEach((ln, i) => {
      ws.mergeCells(`B${r}:G${r}`);
      if (i === 0) { ws.getCell(`A${r}`).value = p.n; ws.getCell(`A${r}`).font = font({ size: 8 }); ws.getCell(`A${r}`).alignment = { horizontal: 'center' }; }
      ws.getCell(`B${r}`).value = ln;
      ws.getCell(`B${r}`).font = font({ size: 8, bold: /^Kode Bahaya/.test(ln) });
      r += 1;
    });
  }
  r += 1;

  /* ---------- tanda tangan + info ---------- */
  const top = r;
  const SH = 6;
  ws.mergeCells(`A${top}:B${top + SH - 1}`);
  ws.mergeCells(`C${top}:F${top + SH - 1}`);
  ws.mergeCells(`G${top}:G${top + SH - 1}`);
  const lab = (addr, t, sign, role) => {
    const c = ws.getCell(addr);
    c.value = { richText: [{ text: `Tanda Tangan\n${t}`, font: font({ italic: true, size: 8 }) }, { text: `\n\n\n\n( ${sign?.name || '                              '} )\n`, font: font({ bold: true, size: 9 }) }, { text: role, font: font({ italic: true, size: 8 }) }] };
    c.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
  };
  lab(`A${top}`, 'Mekanik/Electrician', data.sign_mek, 'Mekanik/Electrician');
  lab(`C${top}`, 'Foreman / Spv', data.sign_sup, 'Pengawas/PJA');
  const info = [data.notes, ...data.findings.map((fd) => `• [${fd.code}] ${fd.text} — ${fd.condition}${fd.note ? ': ' + fd.note : ''} (${fd.status}${fd.fix_note ? ': ' + fd.fix_note : ''})`)].filter(Boolean).join('\n');
  const gc = ws.getCell(`G${top}`);
  gc.value = { richText: [{ text: 'INFO TAMBAHAN dan TINDAK LANJUT :\n', font: font({ bold: true, size: 8 }) }, { text: info, font: font({ size: 8 }) }] };
  gc.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  for (let i = 0; i < SH; i += 1) {
    ws.getRow(top + i).height = 17;
    for (const col of 'ABCDEFG') ws.getCell(`${col}${top + i}`).border = {
      top: i === 0 ? thin : undefined, bottom: i === SH - 1 ? thin : undefined,
      left: ['A', 'C', 'G'].includes(col) ? thin : undefined, right: ['B', 'F', 'G'].includes(col) ? thin : undefined,
    };
  }
  if (data.sign_mek?.img) {
    const idm = wb.addImage({ buffer: data.sign_mek.img, extension: 'png' });
    ws.addImage(idm, { tl: { col: 0.9, row: top - 1 + 1.3 }, ext: { width: 120, height: 42 } });
  }
  if (data.sign_sup?.img) {
    const ids = wb.addImage({ buffer: data.sign_sup.img, extension: 'png' });
    ws.addImage(ids, { tl: { col: 2.1, row: top - 1 + 1.3 }, ext: { width: 120, height: 42 } });
  }
  r = top + SH + 1;
  ws.mergeCells(`A${r}:G${r}`);
  ws.getCell(`A${r}`).value = `${FORM_REV}  ·  P2H #${f.id} · ${data.header.no_unit} · Shift ${data.header.shift} · ${data.long_date}  ·  Dikirim ${data.stamp}  ·  dibuat oleh aplikasi P2H Genset`;
  ws.getCell(`A${r}`).font = font({ size: 7, color: { argb: 'FF777777' } });
  ws.pageSetup.printArea = `A1:G${r}`;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${data.filename}.xlsx` };
}
