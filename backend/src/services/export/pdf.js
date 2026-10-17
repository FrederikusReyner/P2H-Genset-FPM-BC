import PDFDocument from 'pdfkit';
import { plain, segments } from '../../text.js';
import { FORM_REV, PENTING, TITLE, formExportData } from './common.js';

const F = 'Helvetica';
const FB = 'Helvetica-Bold';
const FI = 'Helvetica-Oblique';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 26;
const CW = PAGE_W - M * 2;

// kolom tabel (sama seperti form kertas)
const COLS = { no: 22, uraian: 252, kode: 36, baik: 32, rusak: 32, perbaiki: 38 };
COLS.catatan = CW - (COLS.no + COLS.uraian + COLS.kode + COLS.baik + COLS.rusak + COLS.perbaiki);
const X = {};
{
  let x = M;
  for (const k of ['no', 'uraian', 'kode', 'baik', 'rusak', 'perbaiki', 'catatan']) {
    X[k] = x;
    x += COLS[k];
  }
}

const LINE = '#222222';
const GRAY = '#E9E9E4';
const SOFT = '#F4F4F0';
const RED = '#B3261E';
const AMBER = '#9A6700';

function tick(doc, cx, cy, color = '#111111') {
  doc.save().lineWidth(1.3).lineCap('round').lineJoin('round').strokeColor(color);
  doc.moveTo(cx - 3.4, cy + 0.2).lineTo(cx - 1.0, cy + 2.8).lineTo(cx + 3.6, cy - 3.2).stroke();
  doc.restore();
}

function box(doc, x, y, w, h, { fill, stroke = LINE, width = 0.5 } = {}) {
  doc.save().lineWidth(width);
  if (fill) doc.rect(x, y, w, h).fillAndStroke(fill, stroke);
  else doc.rect(x, y, w, h).stroke(stroke);
  doc.restore();
}

function txt(doc, s, x, y, w, { size = 7.4, font = F, color = '#111111', align = 'left', lineBreak = false } = {}) {
  doc.font(font).fontSize(size).fillColor(color).text(String(s ?? ''), x, y, { width: w, align, lineBreak, ellipsis: !lineBreak });
}

function rich(doc, segs, x, y, w, size) {
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    doc.font(s.bold ? FB : F).fontSize(size).fillColor('#111111');
    if (i === 0) doc.text(s.text, x, y, { width: w, continued: !last });
    else doc.text(s.text, { continued: !last });
  });
}

function measure(doc, s, w, size, font = F) {
  doc.font(font).fontSize(size);
  return doc.heightOfString(String(s || ' '), { width: w });
}

function dotted(doc, x1, y, x2) {
  doc.save().lineWidth(0.5).dash(1, { space: 1.6 }).strokeColor('#555555').moveTo(x1, y).lineTo(x2, y).stroke().undash().restore();
}

/** Bangun PDF satu form P2H. Mengembalikan { buffer, filename }. */
export async function buildFormPdf(id) {
  const data = await formExportData(id);
  if (!data) return null;
  const f = data.form;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: { Title: `${TITLE} - ${data.header.no_unit}`, Author: 'P2H Genset', Subject: `P2H ${data.header.hari_tgl} Shift ${data.header.shift}` },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  /* ---------- ukur tinggi baris supaya muat 1 halaman ---------- */
  const SZ = 7.2;
  const cellPad = 2.2;
  const baseRows = [];
  for (const s of data.sections) {
    baseRows.push({ type: 'section', title: s.title });
    for (const it of s.items) {
      const noteText = it.note || it.hint || '';
      const hText = measure(doc, plain(it.text), COLS.uraian - cellPad * 2, SZ);
      const hNote = noteText ? measure(doc, noteText, COLS.catatan - cellPad * 2, SZ - 0.4, it.note ? F : FI) : 0;
      baseRows.push({ type: 'item', it, extra: Math.max(0, Math.max(hText, hNote) - (SZ + 1)) });
    }
  }

  const HEADER_H = 54;
  const INFO_H = 5 * 13;
  const TBL_HEAD = 25;
  const PARAM_H = 14;
  const PENTING_H = 12 + PENTING.reduce((n, p) => n + p.lines.length, 0) * 9.4 + 3;
  const SIGN_H = 84;
  const FOOT_H = 16;
  const GAPS = 14;
  const available = PAGE_H - M - 18 - M;
  let RH = 13.6;
  const total = (rh) =>
    HEADER_H + INFO_H + TBL_HEAD + baseRows.reduce((n, r) => n + (r.type === 'section' ? rh : rh + r.extra), 0) +
    PARAM_H + 6 * rh + PENTING_H + SIGN_H + FOOT_H + GAPS;
  while (RH > 10.0 && total(RH) > available) RH -= 0.1;
  const fitsOnePage = total(RH) <= available;

  let y = M;

  /* ---------- kepala: logo + judul ---------- */
  if (data.logos.mtl) doc.image(data.logos.mtl, M, y + 2, { fit: [60, 34], align: 'left' });
  if (data.logos.berau) doc.image(data.logos.berau, PAGE_W - M - 56, y - 2, { fit: [56, 50], align: 'right' });
  txt(doc, TITLE, M + 64, y + 6, CW - 128, { size: 14, font: FB, align: 'center' });
  const chip =
    data.result === 'stop_aa'
      ? { t: 'HASIL: STOP OPERASI (AA)', c: RED }
      : data.result === 'temuan_a'
        ? { t: 'HASIL: ADA TEMUAN (A)', c: AMBER }
        : { t: 'HASIL: SEMUA BAIK', c: '#2E7D14' };
  txt(doc, chip.t, M + 64, y + 26, CW - 128, { size: 8, font: FB, align: 'center', color: chip.c });
  txt(doc, data.verified ? `STATUS: ${data.verify_text}` : `STATUS: ${data.verify_text}`, M + 64, y + 38, CW - 128, {
    size: 7, font: FB, align: 'center', color: data.verified ? '#2E7D14' : '#777777',
  });
  y += HEADER_H;

  /* ---------- identitas ---------- */
  const left = [
    ['NAMA', data.header.nama],
    ['HARI / TGL', data.header.hari_tgl],
    ['SHIFT', data.header.shift],
    ['LOKASI', data.header.lokasi],
  ];
  const right = [
    ['JOB SITE', data.header.job_site],
    ['MODEL UNIT', data.header.model_unit],
    ['NO. UNIT', data.header.no_unit],
    ['HM / KM AWAL', data.header.hm_awal],
    ['HM / KM AKHIR', data.header.hm_akhir],
  ];
  const drawInfo = (rows, x0, labelW, valW) => {
    rows.forEach(([l, v], i) => {
      const ry = y + i * 13;
      txt(doc, l, x0, ry + 2, labelW, { size: 7.6 });
      txt(doc, ':', x0 + labelW, ry + 2, 6, { size: 7.6 });
      txt(doc, v, x0 + labelW + 8, ry + 1, valW - 4, { size: 8.4, font: FB });
      dotted(doc, x0 + labelW + 8, ry + 11.2, x0 + labelW + 8 + valW);
    });
  };
  drawInfo(left, M, 54, 205);
  drawInfo(right, M + 292, 62, 180);
  y += INFO_H;

  /* ---------- tabel cek ---------- */
  const th = TBL_HEAD;
  const half = th / 2;
  for (const [k, label] of [['no', 'No'], ['uraian', 'URAIAN'], ['catatan', 'CATATAN']]) {
    box(doc, X[k], y, COLS[k], th, { fill: GRAY });
    txt(doc, label, X[k], y + th / 2 - 4, COLS[k], { size: 7.6, font: FB, align: 'center' });
  }
  box(doc, X.kode, y, COLS.kode, th, { fill: GRAY });
  txt(doc, 'KODE', X.kode, y + 4, COLS.kode, { size: 6.8, font: FB, align: 'center' });
  txt(doc, 'BAHAYA', X.kode, y + 12.4, COLS.kode, { size: 6.8, font: FB, align: 'center' });
  box(doc, X.baik, y, COLS.baik + COLS.rusak + COLS.perbaiki, half, { fill: GRAY });
  txt(doc, 'KONDISI', X.baik, y + 2.6, COLS.baik + COLS.rusak + COLS.perbaiki, { size: 7.2, font: FB, align: 'center' });
  for (const [k, label] of [['baik', 'BAIK'], ['rusak', 'RUSAK'], ['perbaiki', 'PERBAIKI']]) {
    box(doc, X[k], y + half, COLS[k], half, { fill: GRAY });
    txt(doc, label, X[k], y + half + 2.8, COLS[k], { size: 6.6, font: FB, align: 'center' });
  }
  y += th;

  for (const row of baseRows) {
    if (row.type === 'section') {
      const h = RH;
      for (const k of Object.keys(COLS)) box(doc, X[k], y, COLS[k], h, { fill: SOFT });
      txt(doc, row.title, X.uraian + cellPad, y + (h - 7.6) / 2 + 0.4, COLS.uraian, { size: 7.6, font: FB });
      y += h;
      continue;
    }
    const { it } = row;
    const h = RH + row.extra;
    const bad = it.condition !== 'baik';
    for (const k of Object.keys(COLS)) box(doc, X[k], y, COLS[k], h, { fill: bad ? '#FBEDEB' : undefined });
    txt(doc, it.no, X.no, y + (h - SZ) / 2 + 0.4, COLS.no, { size: SZ, align: 'center' });
    const uy = row.extra ? y + 1.8 : y + (h - SZ) / 2 + 0.4;
    rich(doc, segments(it.text), X.uraian + cellPad, uy, COLS.uraian - cellPad * 2, SZ);
    txt(doc, it.danger, X.kode, y + (h - SZ) / 2 + 0.4, COLS.kode, {
      size: SZ, font: FB, align: 'center', color: it.danger === 'AA' ? RED : '#111111',
    });
    const cx = (k) => X[k] + COLS[k] / 2;
    const cy = y + h / 2;
    if (it.condition === 'baik') tick(doc, cx('baik'), cy);
    if (it.condition === 'rusak') tick(doc, cx('rusak'), cy, RED);
    if (it.condition === 'perbaiki') tick(doc, cx('perbaiki'), cy, AMBER);
    const note = it.note || it.hint;
    if (note) {
      doc.font(it.note ? F : FI).fontSize(SZ - 0.4).fillColor(it.note ? '#111111' : '#666666');
      doc.text(note, X.catatan + cellPad, y + (row.extra ? 1.6 : (h - (SZ - 0.4)) / 2 + 0.3), {
        width: COLS.catatan - cellPad * 2,
        lineBreak: true,
      });
    }
    y += h;
  }

  /* ---------- parameter panel ---------- */
  const pw = { label: COLS.uraian, idle: COLS.kode + COLS.baik, load: COLS.rusak + COLS.perbaiki };
  box(doc, X.no, y, COLS.no, PARAM_H, { fill: SOFT });
  box(doc, X.uraian, y, COLS.uraian, PARAM_H, { fill: SOFT });
  txt(doc, 'Parameter Panel Genset', X.uraian + cellPad, y + 3.4, COLS.uraian, { size: 7.6, font: FB });
  box(doc, X.kode, y, pw.idle, PARAM_H, { fill: SOFT });
  txt(doc, 'Kosongan', X.kode, y + 3.6, pw.idle, { size: 7.2, font: FB, align: 'center' });
  box(doc, X.rusak, y, pw.load, PARAM_H, { fill: SOFT });
  txt(doc, 'Berbeban', X.rusak, y + 3.6, pw.load, { size: 7.2, font: FB, align: 'center' });
  box(doc, X.catatan, y, COLS.catatan, PARAM_H, { fill: SOFT });
  y += PARAM_H;
  data.params.forEach((p, i) => {
    box(doc, X.no, y, COLS.no, RH);
    box(doc, X.uraian, y, COLS.uraian, RH);
    box(doc, X.kode, y, pw.idle, RH);
    box(doc, X.rusak, y, pw.load, RH);
    box(doc, X.catatan, y, COLS.catatan, RH);
    txt(doc, i + 1, X.no, y + (RH - SZ) / 2 + 0.4, COLS.no, { size: SZ, align: 'center' });
    txt(doc, p.label, X.uraian + cellPad, y + (RH - SZ) / 2 + 0.4, COLS.uraian, { size: SZ });
    txt(doc, p.idle, X.kode + 2, y + (RH - SZ) / 2 + 0.2, pw.idle - 26, { size: SZ + 0.8, font: FB, align: 'right' });
    txt(doc, p.unit, X.kode + pw.idle - 22, y + (RH - SZ) / 2 + 0.6, 20, { size: SZ - 0.4, color: '#444444', align: 'right' });
    txt(doc, p.load, X.rusak + 2, y + (RH - SZ) / 2 + 0.2, pw.load - 26, { size: SZ + 0.8, font: FB, align: 'right' });
    txt(doc, p.unit, X.rusak + pw.load - 22, y + (RH - SZ) / 2 + 0.6, 20, { size: SZ - 0.4, color: '#444444', align: 'right' });
    y += RH;
  });

  /* ---------- catatan penting ---------- */
  y += 5;
  txt(doc, 'Penting :', M, y, 80, { size: 7.4, font: FI });
  y += 9.6;
  for (const p of PENTING) {
    p.lines.forEach((ln, i) => {
      if (i === 0) txt(doc, p.n, M + 2, y, 10, { size: 7.2 });
      const m = /^(Kode Bahaya (?:AA|A))( = )(.*)$/.exec(ln);
      if (m) {
        doc.font(FB).fontSize(7.2).fillColor('#111111').text(m[1], M + 14, y, { continued: true, lineBreak: false });
        doc.font(F).text(m[2], { continued: true, lineBreak: false });
        const stop = /^(.*)(\(STOP OPERASI\))$/.exec(m[3]);
        if (stop) {
          doc.font(F).text(stop[1], { continued: true, lineBreak: false });
          doc.font(FB).fillColor(RED).text(stop[2], { lineBreak: false });
        } else doc.font(F).text(m[3], { lineBreak: false });
      } else txt(doc, ln, M + 14, y, CW - 14, { size: 7.2 });
      y += 9.4;
    });
  }
  y += 3;

  /* ---------- tanda tangan + info tambahan ---------- */
  if (!fitsOnePage && y + SIGN_H > PAGE_H - M - 18) {
    doc.addPage();
    y = M;
  }
  const w1 = 148;
  const w2 = 148;
  const w3 = CW - w1 - w2;
  const sx = [M, M + w1, M + w1 + w2];
  const drawSign = (x, w, titleLines, sign, roleLabel, pendingText) => {
    box(doc, x, y, w, SIGN_H);
    txt(doc, 'Tanda Tangan', x + 4, y + 3, w - 8, { size: 7.4, font: FI });
    txt(doc, titleLines, x + 4, y + 11.6, w - 8, { size: 7.4, font: FI });
    if (sign?.img) doc.image(sign.img, x + 14, y + 19, { fit: [w - 28, 30], align: 'center', valign: 'center' });
    else if (pendingText) txt(doc, pendingText, x + 4, y + 30, w - 8, { size: 7, font: FB, align: 'center', color: '#8A8A80' });
    const nm = sign?.name ? `( ${sign.name} )` : '(                                         )';
    txt(doc, nm, x + 4, y + 51, w - 8, { size: 7.8, font: FB, align: 'center' });
    txt(doc, roleLabel + (sign?.nrp ? ` · SID ${sign.nrp}` : ''), x + 4, y + 61, w - 8, { size: 6.8, font: FI, align: 'center' });
    if (sign?.company) txt(doc, sign.company, x + 4, y + 69, w - 8, { size: 6.4, align: 'center', color: '#444444' });
    if (sign?.at) {
      if (sign.verified) {
        txt(doc, 'TERVERIFIKASI', x + 4, y + 3, w - 8, { size: 6.2, font: FB, color: '#2E7D14', align: 'right' });
        txt(doc, sign.at, x + 4, y + 76.5, w - 8, { size: 5.8, color: '#2E7D14', align: 'center' });
      } else {
        txt(doc, sign.at, x + 4, y + 3, w - 8, { size: 5.8, color: '#666666', align: 'right' });
      }
    }
  };
  drawSign(sx[0], w1, 'Teknisi (Mekanik / Electrician)', data.sign_mek, 'Teknisi');
  drawSign(sx[1], w2, 'Pengawas (Foreman / Spv)', data.sign_sup, 'Pengawas', 'MENUNGGU VERIFIKASI');

  box(doc, sx[2], y, w3, SIGN_H);
  txt(doc, 'INFO TAMBAHAN dan TINDAK LANJUT :', sx[2] + 4, y + 3, w3 - 8, { size: 7.4, font: FB });
  let ly = y + 13;
  const maxY = y + SIGN_H - 3;
  const lines = [];
  if (data.notes) lines.push({ t: data.notes, f: F, c: '#111111' });
  for (const fd of data.findings) {
    const st =
      fd.fix_status === 'closed'
        ? `SELESAI${fd.fix_at ? ' ' + fd.fix_at.slice(0, 10) : ''}${fd.fix_by ? ' oleh ' + fd.fix_by : ''}`
        : fd.fix_status === 'in_progress'
          ? 'sedang diperbaiki'
          : 'belum diperbaiki';
    lines.push({
      t: `• [${fd.code}] ${fd.text} — ${fd.condition}${fd.note ? ': ' + fd.note : ''} (${st}${fd.fix_note ? ': ' + fd.fix_note : ''})`,
      f: F,
      c: fd.code === 'AA' ? RED : '#111111',
    });
  }
  doc.fontSize(6.8);
  let truncated = false;
  for (const ln of lines) {
    const h = measure(doc, ln.t, w3 - 10, 6.8, ln.f);
    if (ly + h > maxY) {
      truncated = true;
      break;
    }
    doc.font(ln.f).fontSize(6.8).fillColor(ln.c).text(ln.t, sx[2] + 5, ly, { width: w3 - 10 });
    ly += h + 1.2;
  }
  if (truncated) txt(doc, '… selengkapnya lihat di aplikasi', sx[2] + 5, maxY - 7, w3 - 10, { size: 6.2, font: FI, color: '#666666' });
  y += SIGN_H;

  /* ---------- kaki halaman ---------- */
  const fy = PAGE_H - M - 4;
  txt(doc, FORM_REV, M, fy, 180, { size: 6.4, color: '#777777' });
  txt(doc, `P2H #${f.id} · ${data.header.no_unit} · Shift ${data.header.shift} · ${data.long_date}`, M + 120, fy, CW - 240, {
    size: 6.4, color: '#777777', align: 'center',
  });
  txt(doc, `Dikirim ${data.stamp} · dibuat oleh aplikasi P2H Genset`, PAGE_W - M - 230, fy, 230, {
    size: 6.4, color: '#777777', align: 'right',
  });

  /* ---------- lampiran foto temuan (hanya bila ada foto) ---------- */
  const withPhotos = data.findings.filter((x) => x.images.length);
  if (withPhotos.length) {
    doc.addPage();
    let py = M;
    txt(doc, 'LAMPIRAN FOTO TEMUAN', M, py, CW, { size: 13, font: FB });
    txt(doc, `${data.header.no_unit} · ${data.header.hari_tgl} · Shift ${data.header.shift} · ${data.header.site}`, M, py + 17, CW, { size: 8, color: '#444444' });
    py += 36;
    const gap = 8;
    const cw3 = (CW - 2 * gap) / 3;
    const ph = cw3 * 0.75;
    for (const fd of withPhotos) {
      const title = `[${fd.code}] ${fd.text} — ${fd.condition}${fd.note ? ': ' + fd.note : ''}`;
      const th = measure(doc, title, CW, 8.4, FB);
      if (py + th + 4 + ph > PAGE_H - M - 14) {
        doc.addPage();
        py = M;
      }
      doc.font(FB).fontSize(8.4).fillColor(fd.code === 'AA' ? RED : '#111111').text(title, M, py, { width: CW });
      py += th + 4;
      for (let i = 0; i < fd.images.length; i += 3) {
        if (py + ph > PAGE_H - M - 14) {
          doc.addPage();
          py = M;
        }
        fd.images.slice(i, i + 3).forEach((im, k) => {
          const x = M + k * (cw3 + gap);
          box(doc, x, py, cw3, ph, { stroke: '#C9CDBF' });
          try {
            doc.image(im.buffer, x + 1, py + 1, { fit: [cw3 - 2, ph - 2], align: 'center', valign: 'center' });
          } catch {
            txt(doc, 'foto tidak bisa dicetak', x, py + ph / 2 - 4, cw3, { size: 7, align: 'center', color: '#777777' });
          }
        });
        py += ph + gap;
      }
      py += 4;
    }
    txt(doc, `P2H #${f.id} · ${data.header.no_unit} · lampiran foto`, M, PAGE_H - M - 4, CW, { size: 6.4, color: '#777777' });
  }

  doc.end();
  return { buffer: await done, filename: `${data.filename}.pdf` };
}
