import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Di komputer sendiri: baca berkas .env bila ada. Di Render: pakai Environment Variables (tidak perlu .env).
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* tidak ada .env: tidak apa-apa */
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

let jwtSecret = env.JWT_SECRET || '';
if (!jwtSecret) {
  if (isProd) {
    console.error('[config] JWT_SECRET belum diisi. Isi dulu di Environment Variables (lihat panduan).');
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET kosong: dibuat acak sementara (login hilang tiap server restart).');
}
if (isProd && jwtSecret.length < 32) {
  console.error('[config] JWT_SECRET terlalu pendek (minimal 32 karakter).');
  process.exit(1);
}

export const config = {
  root,
  isProd,
  port: Number(env.PORT || 4000),
  databaseUrl: env.DATABASE_URL || '',
  databaseSsl: String(env.DATABASE_SSL || 'auto').toLowerCase(), // auto | true | false
  jwtSecret,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '30d',
  corsOrigins: list(env.CORS_ORIGINS),
  // alamat aplikasi (dipakai untuk tautan di notifikasi). Di Render otomatis terisi RENDER_EXTERNAL_URL.
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || list(env.CORS_ORIGINS)[0] || 'http://localhost:5173').replace(/\/+$/, ''),
  // folder hasil build tampilan web; kalau ada, server ini ikut menyajikan aplikasinya (satu layanan untuk web + server)
  webDir: env.WEB_DIR ? path.resolve(env.WEB_DIR) : path.resolve(root, '..', 'frontend', 'dist'),
  // sertifikat CA database (Aiven menyediakannya); kosong = tetap terenkripsi tapi tanpa pemeriksaan sertifikat
  databaseCa: String(env.DATABASE_CA || '').replace(/\\n/g, '\n').trim(),
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
  admin: {
    nrp: (env.ADMIN_NRP || '').trim(),
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Administrator',
  },
  tz: 'Asia/Makassar', // WITA (Kalimantan Timur)
  version: '1.0.0',
};

if (!config.databaseUrl) {
  console.error('[config] DATABASE_URL belum diisi. Isi dulu (lihat panduan).');
  process.exit(1);
}
