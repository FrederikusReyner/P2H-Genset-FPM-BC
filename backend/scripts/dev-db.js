// Database PostgreSQL untuk uji coba di komputer sendiri (tanpa install apa pun).
// Jalankan:  npm run dev:db      (biarkan jendelanya terbuka)
// Alamat    : postgres://postgres:postgres@localhost:5433/p2h
// DBeaver bisa tersambung ke alamat yang sama untuk melihat isinya.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '..', '.devdb');
const port = Number(process.env.DEV_DB_PORT || 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error('[postgres]', String(e).trim()),
});

const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
if (fresh) {
  console.log('[dev-db] pertama kali: menyiapkan folder data…');
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase('p2h');

console.log(`[dev-db] PostgreSQL siap di port ${port}`);
console.log(`[dev-db] DATABASE_URL=postgres://postgres:postgres@localhost:${port}/p2h`);
console.log('[dev-db] Tekan Ctrl+C untuk berhenti.');

const stop = async () => {
  console.log('\n[dev-db] berhenti…');
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
