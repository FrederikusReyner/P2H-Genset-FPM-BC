import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';

const sqlDir = path.join(config.root, 'sql');

/** Jalankan semua berkas sql/*.sql yang belum pernah dijalankan (berurutan). */
export async function migrate(log = console.log) {
  const client = await pool.connect();
  try {
    // kunci supaya dua server yang hidup bersamaan tidak saling tabrak
    await client.query('SELECT pg_advisory_lock(727201)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = fs
      .readdirSync(sqlDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [f]);
      if (done.rowCount) continue;
      const sql = fs.readFileSync(path.join(sqlDir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        log(`[migrate] selesai: ${f}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Gagal menjalankan ${f}: ${err.message}`);
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(727201)');
    } catch {
      /* abaikan */
    }
    client.release();
  }
}

// Bisa juga dijalankan langsung: npm run migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => {
      console.log('[migrate] beres');
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
