import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Tipe data: tanggal tetap berupa teks 'YYYY-MM-DD'; angka jadi angka JavaScript.
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // bigint

function sslOption() {
  const mode = config.databaseSsl;
  if (mode === 'false') return false;
  if (mode === 'true') return { rejectUnauthorized: false };
  // auto: komputer sendiri & alamat dalam Render (tanpa titik) tidak pakai SSL; selain itu pakai SSL
  try {
    const host = new URL(config.databaseUrl).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || !host.includes('.')) return false;
  } catch {
    return false;
  }
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
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
