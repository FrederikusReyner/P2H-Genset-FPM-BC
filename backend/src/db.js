import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Tipe data: tanggal tetap berupa teks 'YYYY-MM-DD'; angka jadi angka JavaScript.
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // bigint

/**
 * Alamat database dari penyedia (Aiven, Render) sering berakhir "?sslmode=require".
 * Pengaturan itu dibuang dari alamat karena kita mengatur SSL sendiri di bawah; kalau dibiarkan,
 * pustaka pg bisa memaksa pemeriksaan sertifikat dan koneksi ke Aiven gagal ("self-signed certificate").
 */
function parseDatabaseUrl(raw) {
  try {
    const u = new URL(raw);
    const sslmode = u.searchParams.get('sslmode');
    for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) u.searchParams.delete(k);
    return { url: u.toString(), host: u.hostname, sslmode };
  } catch {
    return { url: raw, host: '', sslmode: null };
  }
}
const dbUrl = parseDatabaseUrl(config.databaseUrl);

function sslOption() {
  const mode = config.databaseSsl;
  if (mode === 'false' || dbUrl.sslmode === 'disable') return false;
  const on = config.databaseCa ? { ca: config.databaseCa, rejectUnauthorized: true } : { rejectUnauthorized: false };
  if (mode === 'true') return on;
  // auto: komputer sendiri & alamat dalam Render (tanpa titik) tidak pakai SSL; selain itu pakai SSL
  const host = dbUrl.host;
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || !host.includes('.')) return false;
  return on;
}

export const pool = new Pool({
  connectionString: dbUrl.url,
  ssl: sslOption(),
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
});

pool.on('error', (err) => {
  console.error('[db] koneksi menganggur error:', err.message);
});

export const query = (text, params) => pool.query(text, params);

/** Jalankan beberapa perintah sebagai satu paket (semua berhasil atau semua batal). */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* abaikan */
    }
    throw err;
  } finally {
    client.release();
  }
}
