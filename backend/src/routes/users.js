import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { AppError, conflict, notFound } from '../errors.js';
import { ROLES, requireAuth, requireRole } from '../middleware/auth.js';
import { idParam, parse } from '../middleware/validate.js';
import { audit } from '../services/audit.js';

const r = Router();
r.use(requireAuth, requireRole('admin'));

// password acak yang mudah dibaca (tanpa huruf yang mirip: 0/O, 1/l/I)
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomPassword(len = 8) {
  return Array.from({ length: len }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
}

/** Teknisi dan pengawas wajib punya site (supaya hanya melihat site-nya); admin melihat semua. */
async function assertSite(role, siteId) {
  if (role === 'admin') return;
  if (!siteId) throw new AppError(422, 'validation', 'site: pilih site untuk teknisi / pengawas.');
  const ok = await query('SELECT 1 FROM sites WHERE id = $1 AND is_active', [siteId]);
  if (!ok.rowCount) throw new AppError(422, 'validation', 'site: site tidak dikenal.');
}

const COLS = `id, nrp, name, role, site_id, company, job_title, phone, is_active, must_change_password,
  last_login_at, created_at, (signature_png IS NOT NULL) AS has_signature,
  (SELECT count(*)::int FROM push_subscriptions ps WHERE ps.user_id = users.id) AS devices`;

r.get('/', async (_req, res) => {
  const { rows } = await query(`SELECT ${COLS} FROM users ORDER BY is_active DESC, role, name`);
  res.json({ items: rows });
});

const UserIn = z.object({
  nrp: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, 'hanya huruf, angka, titik, garis'), // No SID
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  site_id: z.number().int().nullable().optional(),
  company: z.string().trim().max(80).nullable().optional(),
  job_title: z.string().trim().max(60).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  password: z.string().min(6).max(100).optional(),
});

r.post('/', async (req, res) => {
  const b = parse(UserIn, req.body);
  await assertSite(b.role, b.site_id);
  const dup = await query('SELECT 1 FROM users WHERE lower(nrp) = lower($1)', [b.nrp]);
  if (dup.rowCount) throw conflict(`No SID "${b.nrp}" sudah punya akun.`);
  const password = b.password || randomPassword();
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (nrp, name, password_hash, role, site_id, company, job_title, phone, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING ${COLS}`,
    [b.nrp, b.name, hash, b.role, b.role === 'admin' ? null : b.site_id, b.company || null, b.job_title || null, b.phone || null],
  );
  await audit(null, req.user, 'user.create', 'user', rows[0].id, { nrp: b.nrp, role: b.role });
  res.status(201).json({ item: rows[0], initial_password: password });
});

const UserUpdate = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  site_id: z.number().int().nullable().optional(),
  company: z.string().trim().max(80).nullable().optional(),
  job_title: z.string().trim().max(60).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  is_active: z.boolean(),
});

r.put('/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(UserUpdate, req.body);
  await assertSite(b.role, b.site_id);
  if (id === req.user.id && (!b.is_active || b.role !== 'admin')) {
    throw new AppError(400, 'self_lockout', 'Anda tidak bisa menonaktifkan atau menurunkan akun Anda sendiri.');
  }
  const { rows } = await query(
    `UPDATE users SET name = $2, role = $3, site_id = $4, company = $5, job_title = $6, phone = $7, is_active = $8,
            token_version = CASE WHEN $8 = false OR role <> $3 OR site_id IS DISTINCT FROM $4 THEN token_version + 1 ELSE token_version END,
            updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, b.name, b.role, b.role === 'admin' ? null : b.site_id, b.company || null, b.job_title || null, b.phone || null, b.is_active],
  );
  if (!rows[0]) throw notFound('Pengguna tidak ditemukan.');
  await audit(null, req.user, 'user.update', 'user', id, { role: b.role, is_active: b.is_active });
  res.json({ item: rows[0] });
});

r.post('/:id/reset-password', async (req, res) => {
  const id = idParam(req);
  const password = randomPassword();
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `UPDATE users SET password_hash = $2, must_change_password = true, token_version = token_version + 1, updated_at = now()
      WHERE id = $1 RETURNING nrp, name`,
    [id, hash],
  );
  if (!rows[0]) throw notFound('Pengguna tidak ditemukan.');
  await audit(null, req.user, 'user.reset_password', 'user', id, { nrp: rows[0].nrp });
  res.json({ nrp: rows[0].nrp, name: rows[0].name, initial_password: password });
});

/* ---- impor banyak akun sekaligus (tempel dari Excel) ---- */

const ROLE_ALIAS = {
  teknisi: 'teknisi', mekanik: 'teknisi', electrician: 'teknisi', elektrik: 'teknisi', technician: 'teknisi',
  pengawas: 'pengawas', foreman: 'pengawas', spv: 'pengawas', supervisor: 'pengawas', pja: 'pengawas',
  admin: 'admin', administrator: 'admin',
};

const ImportIn = z.object({
  users: z
    .array(
      z.object({
        nrp: z.string().trim().max(60), // No SID
        name: z.string().trim().max(120),
        company: z.string().trim().max(80).optional().nullable(),
        job_title: z.string().trim().max(60).optional().nullable(),
        role: z.string().trim().max(40).optional().nullable(),
        site: z.string().trim().max(60).optional().nullable(),
        password: z.string().max(100).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

r.post('/import', async (req, res) => {
  const { users } = parse(ImportIn, req.body);
  const sites = (await query('SELECT id, code, name FROM sites')).rows;
  const findSite = (s) => {
    if (!s) return null;
    const k = s.trim().toLowerCase();
    return sites.find((x) => x.code.toLowerCase() === k || x.name.toLowerCase() === k)?.id ?? undefined;
  };

  const results = [];
  const seen = new Set();
  await tx(async (c) => {
    for (const [i, u] of users.entries()) {
      const row = i + 1;
      const nrp = u.nrp.trim();
      const fail = (msg) => results.push({ row, nrp, name: u.name, status: 'gagal', message: msg });
      if (!/^[A-Za-z0-9._-]{2,40}$/.test(nrp)) { fail('No SID tidak valid (hanya huruf, angka, titik, garis)'); continue; }
      if (u.name.trim().length < 2) { fail('Nama kosong'); continue; }
      const role = ROLE_ALIAS[(u.role || 'teknisi').trim().toLowerCase()];
      if (!role) { fail(`Peran "${u.role}" tidak dikenal (teknisi / pengawas / admin)`); continue; }
      const siteId = findSite(u.site);
      if (siteId === undefined) { fail(`Site "${u.site}" tidak dikenal`); continue; }
      if (role !== 'admin' && !siteId) { fail('Site wajib diisi untuk teknisi / pengawas'); continue; }
      const key = nrp.toLowerCase();
      if (seen.has(key)) { fail('No SID dobel di daftar'); continue; }
      seen.add(key);
      const dup = await c.query('SELECT 1 FROM users WHERE lower(nrp) = $1', [key]);
      if (dup.rowCount) { fail('Sudah punya akun'); continue; }
      const password = u.password && u.password.length >= 6 ? u.password : randomPassword();
      const hash = await bcrypt.hash(password, 10);
      await c.query(
        `INSERT INTO users (nrp, name, password_hash, role, site_id, company, job_title, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [nrp, u.name.trim(), hash, role, role === 'admin' ? null : siteId, u.company || null, u.job_title || null],
      );
      results.push({ row, nrp, name: u.name.trim(), role, status: 'dibuat', initial_password: password });
    }
    await audit(c, req.user, 'user.import', 'user', null, { dibuat: results.filter((x) => x.status === 'dibuat').length });
  });
  res.json({
    created: results.filter((x) => x.status === 'dibuat').length,
    failed: results.filter((x) => x.status === 'gagal').length,
    results,
  });
});

export default r;
