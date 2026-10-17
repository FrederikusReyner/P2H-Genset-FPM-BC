import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { pool } from './db.js';
import { initPush } from './services/push.js';
import { state } from './state.js';

const app = createApp();

// Buka port dulu (supaya Render tahu server hidup), lalu siapkan database.
const server = app.listen(config.port, () => {
  console.log(`[server] P2H Genset API v${config.version} di port ${config.port} (${config.isProd ? 'produksi' : 'pengembangan'})`);
});

initPush();

async function prepare() {
  const max = 40;
  for (let i = 1; i <= max; i += 1) {
    try {
      await bootstrap(console.log);
      state.ready = true;
      console.log('[server] database siap. Server menerima permintaan.');
      return;
    } catch (err) {
      console.error(`[server] database belum siap (percobaan ${i}/${max}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.error('[server] gagal menyiapkan database. Periksa DATABASE_URL.');
  process.exit(1);
}
prepare();

function shutdown(sig) {
  console.log(`[server] ${sig}: berhenti…`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[server] unhandledRejection:', e));
