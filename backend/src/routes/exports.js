import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { requireAuth, scopeOf } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { buildFormDocx } from '../services/export/docx.js';
import { buildFormPdf } from '../services/export/pdf.js';
import { buildRekapDocx, buildRekapPdf, buildRekapXlsx, rekapPreview } from '../services/export/rekap.js';
import { buildFormXlsx } from '../services/export/xlsx.js';
import { buildPmmrXlsx } from '../services/pmmr/workbook.js';

const r = Router();

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const FORM_BUILD = { pdf: buildFormPdf, docx: buildFormDocx, xlsx: buildFormXlsx };
const REKAP_BUILD = { pdf: buildRekapPdf, docx: buildRekapDocx, xlsx: buildRekapXlsx };

const TicketIn = z.object({
  kind: z.enum(['p2h', 'rekap', 'pmmr']),
  format: z.enum(['pdf', 'docx', 'xlsx']),
  id: z.number().int().optional(),
  filters: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

/**
 * Unduhan memakai "tiket" berumur 3 menit: HP meminta tiket (pakai login), lalu membuka alamat unduhan.
 * Cara ini jalan juga di iPhone / aplikasi terpasang, yang sulit menyimpan file hasil fetch.
 */
r.post('/ticket', requireAuth, async (req, res) => {
  const b = parse(TicketIn, req.body);
  if (b.kind === 'p2h' && !b.id) throw badRequest('Nomor P2H diperlukan.');
  if (b.kind === 'pmmr' && b.format !== 'xlsx') throw badRequest('Rekap PMMR hanya tersedia dalam format Excel.');
  const token = jwt.sign(
    { typ: 'export', kind: b.kind, format: b.format, id: b.id, filters: b.filters || {}, uid: req.user.id },
    config.jwtSecret,
    { expiresIn: '3m' },
  );
  res.json({ path: `/api/exports/file?t=${encodeURIComponent(token)}` });
});

/** Ringkasan rekap untuk layar (mingguan / bulanan / tahunan) sebelum diunduh. */
r.get('/rekap-preview', requireAuth, async (req, res) => {
  res.json(await rekapPreview(req.query, req.user));
});

r.get('/file', async (req, res) => {
  let p;
  try {
    p = jwt.verify(String(req.query.t || ''), config.jwtSecret);
  } catch {
    throw unauthorized('Tautan unduhan sudah kedaluwarsa. Kembali ke aplikasi lalu unduh lagi.');
  }
  if (p.typ !== 'export') throw unauthorized();
  const u = (await query('SELECT id, role, site_id, is_active FROM users WHERE id = $1', [p.uid])).rows[0];
  if (!u?.is_active) throw unauthorized();

  let out;
  if (p.kind === 'p2h') {
    const scope = scopeOf(u);
    if (scope != null) {
      const f = (await query('SELECT site_id FROM p2h_forms WHERE id = $1', [p.id])).rows[0];
      if (!f || f.site_id !== scope) throw notFound('P2H tidak ditemukan.');
    }
    out = await FORM_BUILD[p.format](p.id);
    if (!out) throw notFound('P2H tidak ditemukan.');
  } else if (p.kind === 'pmmr') {
    out = await buildPmmrXlsx(p.filters || {}, u);
  } else {
    out = await REKAP_BUILD[p.format](p.filters || {}, u);
  }
  const ascii = out.filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', MIME[p.format]);
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(out.buffer);
});

export default r;
