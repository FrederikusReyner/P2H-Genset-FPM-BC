import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { query } from './db.js';
import { AppError } from './errors.js';
import { state } from './state.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import exportRoutes from './routes/exports.js';
import findingsRoutes from './routes/findings.js';
import metaRoutes from './routes/meta.js';
import notificationRoutes from './routes/notifications.js';
import photoRoutes from './routes/photos.js';
import p2hRoutes from './routes/p2h.js';
import unitRoutes from './routes/units.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render berada di belakang proxy
  app.disable('x-powered-by');

  // aturan keamanan halaman web (dipakai bila server ini ikut menyajikan aplikasinya)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(compression());

  const localhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // curl, uptime monitor, unduhan langsung
        if (config.corsOrigins.includes(origin.replace(/\/+$/, ''))) return cb(null, true);
        if (!config.isProd && localhost.test(origin)) return cb(null, true);
        return cb(null, false); // tidak diizinkan: browser akan memblokir
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
    }),
  );

  // P2H membawa foto temuan: batasnya lebih besar, tapi hanya untuk yang sudah membawa tanda masuk
  const bigJson = express.json({ limit: '16mb' });
  app.use('/api/p2h', (req, res, next) => (req.headers.authorization ? bigJson(req, res, next) : next()));
  app.use(express.json({ limit: '1mb' }));

  // batas umum: 900 permintaan per menit per alamat IP (cukup longgar untuk banyak HP di satu jaringan site)
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 900, standardHeaders: 'draft-7', legacyHeaders: false, skip: (req) => req.path === '/health', message: { error: { code: 'too_many', message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' } } }));

  // log sederhana (tanpa health check supaya tidak ramai)
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    const t = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 400 || !config.isProd) console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - t} ms)`);
    });
    next();
  });

  /** Cek hidup. Dipakai Render (health check) dan monitor uptime. Tidak butuh login. */
  app.get('/api/health', async (_req, res) => {
    let db = false;
    try {
      await query('SELECT 1');
      db = true;
    } catch {
      /* db belum siap */
    }
    res.status(db && state.ready ? 200 : 503).json({
      ok: db && state.ready,
      ready: state.ready,
      db,
      version: config.version,
      time: new Date().toISOString(),
    });
  });

  // selama database / migrasi belum selesai (server baru bangun), tolak dengan pesan ramah
  app.use('/api', (req, res, next) => {
    if (state.ready) return next();
    res.status(503).json({ error: { code: 'starting', message: 'Server sedang menyiapkan database. Coba lagi sebentar.' } });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/meta', metaRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api/p2h', p2hRoutes);
  app.use('/api/findings', findingsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/photos', photoRoutes);
  app.use('/api/exports', exportRoutes);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Alamat tidak dikenal.' } });
  });

  // ---- tampilan web (hasil build frontend) ----
  const indexHtml = path.join(config.webDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.webDir, {
        index: false,
        redirect: false,
        setHeaders(res, file) {
          const base = path.basename(file);
          if (['sw.js', 'index.html', 'manifest.webmanifest', 'registerSW.js'].includes(base)) res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'public, max-age=86400');
          if (base === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
        },
      }),
    );
    // alamat halaman aplikasi (mis. /p2h/12) -> index.html
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(indexHtml);
    });
    console.log(`[web] menyajikan tampilan aplikasi dari ${config.webDir}`);
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send('P2H Genset API berjalan. Buka aplikasi web untuk memakainya.');
    });
  }

  // ---- penanganan error (semua jadi JSON yang rapi) ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra ? { details: err.extra } : {}) } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'too_large', message: 'Data terlalu besar.' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_json', message: 'Data yang dikirim tidak terbaca.' } });
    }
    console.error(`[error] ${req.method} ${req.path}:`, err);
    return res.status(500).json({ error: { code: 'server_error', message: 'Terjadi kesalahan di server. Coba lagi; kalau tetap gagal, hubungi admin.' } });
  });

  return app;
}
