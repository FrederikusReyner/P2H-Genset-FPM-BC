import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { forbidden, unauthorized } from '../errors.js';

export const ROLES = ['teknisi', 'pengawas', 'teknisi_pengawas', 'admin'];
export const CAN_FILL = ['teknisi', 'teknisi_pengawas', 'admin']; // boleh mengisi P2H
export const CAN_SIGN = ['pengawas', 'teknisi_pengawas', 'admin']; // boleh memverifikasi (tanda tangan pengawas); P2H sendiri tidak boleh (kecuali admin)
export const CAN_FIX = ['teknisi', 'pengawas', 'teknisi_pengawas', 'admin']; // boleh memperbarui tindak lanjut temuan

const USER_COLS = `id, nrp, name, role, site_id, company, job_title, phone, is_active, must_change_password,
  token_version, notif_mode, notif_site_ids, notif_seen_id, (signature_png IS NOT NULL) AS has_signature`;

export function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export async function requireAuth(req, _res, next) {
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!m) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(m[1], config.jwtSecret);
  } catch {
    throw unauthorized('Sesi habis. Silakan masuk lagi.');
  }
  if (payload.typ) throw unauthorized(); // token jenis lain (mis. tiket unduhan) tidak boleh dipakai di sini
  const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [payload.sub]);
  const u = rows[0];
  if (!u || !u.is_active || u.token_version !== payload.tv) throw unauthorized('Sesi habis. Silakan masuk lagi.');
  req.user = u;
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

/**
 * Batas site: admin melihat semua site (null). Teknisi dan pengawas hanya site-nya sendiri.
 * Akun yang belum diberi site mendapat -1, yang tidak cocok dengan site mana pun (jadi tidak melihat apa-apa).
 */
export const scopeOf = (u) => (u.role === 'admin' ? null : (u.site_id ?? -1));

/** Data pengguna yang aman dikirim ke HP. */
export function publicUser(u, extra = {}) {
  return {
    id: u.id,
    nrp: u.nrp,
    name: u.name,
    role: u.role,
    site_id: u.site_id,
    company: u.company ?? null,
    job_title: u.job_title ?? null,
    phone: u.phone ?? null,
    must_change_password: !!u.must_change_password,
    notif_mode: u.notif_mode,
    notif_site_ids: u.notif_site_ids ?? null,
    has_signature: !!u.has_signature,
    ...extra,
  };
}
