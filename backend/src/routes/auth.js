import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { AppError } from '../errors.js';
import { publicUser, requireAuth, signToken } from '../middleware/auth.js';
import { assertPngDataUrl, parse } from '../middleware/validate.js';

const r = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'too_many', message: 'Terlalu banyak percobaan masuk. Tunggu 1 menit lalu coba lagi.' } },
});

// hash palsu agar waktu cek password sama walau ID tidak ada
const DUMMY_HASH = bcrypt.hashSync('tidak-ada-orang-ini', 10);

const LoginIn = z.object({
  nrp: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

const FULL_USER = `SELECT id, nrp, name, role, site_id, job_title, phone, password_hash, signature_png,
  notif_mode, notif_site_ids, is_active, must_change_password, token_version,
  (signature_png IS NOT NULL) AS has_signature FROM users`;

r.post('/login', loginLimiter, async (req, res) => {
  const { nrp, password } = parse(LoginIn, req.body);
  const { rows } = await query(`${FULL_USER} WHERE lower(nrp) = lower($1)`, [nrp]);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new AppError(401, 'bad_login', 'ID karyawan atau password salah.');
  if (!u.is_active) throw new AppError(403, 'disabled', 'Akun Anda dinonaktifkan. Hubungi admin.');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  res.json({ token: signToken(u), user: publicUser(u, { signature_png: u.signature_png }) });
});

r.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(`${FULL_USER} WHERE id = $1`, [req.user.id]);
  res.json({ user: publicUser(rows[0], { signature_png: rows[0].signature_png }) });
});

const PasswordIn = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(6).max(100),
});

r.post('/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = parse(PasswordIn, req.body);
  const { rows } = await query(`${FULL_USER} WHERE id = $1`, [req.user.id]);
  const u = rows[0];
  if (!(await bcrypt.compare(current_password, u.password_hash))) {
    throw new AppError(400, 'bad_password', 'Password lama salah.');
  }
  if (current_password === new_password) {
    throw new AppError(400, 'same_password', 'Password baru harus berbeda dari yang lama.');
  }
  const hash = await bcrypt.hash(new_password, 10);
  const upd = await query(
    `UPDATE users SET password_hash = $1, must_change_password = false, token_version = token_version + 1, updated_at = now()
      WHERE id = $2 RETURNING id, token_version`,
    [hash, u.id],
  );
  // token lama (di HP lain) tidak berlaku lagi; HP ini langsung dapat token baru
  res.json({ token: signToken({ id: u.id, token_version: upd.rows[0].token_version }) });
});

r.put('/signature', requireAuth, async (req, res) => {
  const { signature_png } = parse(z.object({ signature_png: z.string().nullable() }), req.body);
  if (signature_png) assertPngDataUrl(signature_png);
  await query('UPDATE users SET signature_png = $1, updated_at = now() WHERE id = $2', [signature_png, req.user.id]);
  res.json({ ok: true, has_signature: !!signature_png });
});

const PrefsIn = z.object({
  notif_mode: z.enum(['all', 'findings']),
  notif_site_ids: z.array(z.number().int()).max(20).nullable(),
});

r.put('/prefs', requireAuth, async (req, res) => {
  const { notif_mode, notif_site_ids } = parse(PrefsIn, req.body);
  const ids = notif_site_ids && notif_site_ids.length ? notif_site_ids : null;
  await query('UPDATE users SET notif_mode = $1, notif_site_ids = $2, updated_at = now() WHERE id = $3', [
    notif_mode,
    ids,
    req.user.id,
  ]);
  res.json({ ok: true, notif_mode, notif_site_ids: ids });
});

export default r;
