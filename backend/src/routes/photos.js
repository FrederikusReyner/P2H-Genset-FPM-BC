import { Router } from 'express';
import { query } from '../db.js';
import { notFound } from '../errors.js';
import { requireAuth, scopeOf } from '../middleware/auth.js';
import { idParam } from '../middleware/validate.js';

const r = Router();

/**
 * Foto temuan. Hanya untuk yang sudah masuk, dan hanya foto dari site pengguna (admin: semua).
 * Isi foto tidak pernah berubah untuk nomor yang sama, jadi boleh disimpan lama di HP.
 */
r.get('/:id', requireAuth, async (req, res) => {
  const id = idParam(req);
  const { rows } = await query(
    `SELECT p.mime, p.data, f.site_id FROM p2h_photos p JOIN p2h_forms f ON f.id = p.form_id WHERE p.id = $1`,
    [id],
  );
  const p = rows[0];
  const scope = scopeOf(req.user);
  if (!p || (scope != null && p.site_id !== scope)) throw notFound('Foto tidak ditemukan.');
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Content-Length', p.data.length);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(p.data);
});

export default r;
