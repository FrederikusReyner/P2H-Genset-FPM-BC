import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';

/*
 * Gateway WhatsApp milik sendiri: server ini tersambung langsung ke WhatsApp sebagai "perangkat tertaut"
 * (seperti WhatsApp Web), tanpa layanan pihak ketiga. Pustakanya Baileys (@whiskeysockets/baileys).
 *
 * Yang perlu diketahui:
 *  - Ini bukan API resmi WhatsApp. Nomor pengirim bisa diblokir WhatsApp; pakai nomor khusus.
 *  - Sesi (kunci tautan perangkat) disimpan terenkripsi di tabel wa_auth. Penyimpanan Render hilang tiap restart,
 *    jadi tidak bisa disimpan sebagai berkas.
 *  - Hanya grup tujuan yang diproses. Pesan baru dari chat dan grup lain tidak dibuka (tidak didekripsi),
 *    riwayat lengkap tidak diminta, dan tidak ada isi pesan yang disimpan atau dicatat di log.
 *  - Pustaka baru dimuat kalau WhatsApp memang ditautkan, supaya server yang tidak memakainya tetap ringan.
 */

const SEND_TIMEOUT_MS = 45_000;
const OPEN_TIMEOUT_MS = 25_000;

/* ---------- penyimpanan mentah: tabel wa_auth dan baris settings 'wa_target' ---------- */

const pgRaw = {
  async get(keys) {
    if (!keys.length) return {};
    const { rows } = await query('SELECT key, value FROM wa_auth WHERE key = ANY($1::text[])', [keys]);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  /** entries: { kunci: teks | null }  (null = hapus) */
  async set(entries) {
    const put = Object.entries(entries).filter(([, v]) => v != null);
    const del = Object.entries(entries).filter(([, v]) => v == null).map(([k]) => k);
    if (put.length) {
      await query(
        `INSERT INTO wa_auth (key, value) SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [put.map(([k]) => k), put.map(([, v]) => v)],
      );
    }
    if (del.length) await query('DELETE FROM wa_auth WHERE key = ANY($1::text[])', [del]);
  },
  async clear() {
    await query('DELETE FROM wa_auth');
  },
};

const pgTarget = {
  async load() {
    const { rows } = await query(`SELECT value FROM settings WHERE key = 'wa_target'`);
    return rows[0]?.value || null;
  },
  async save(v) {
    if (!v) return void (await query(`DELETE FROM settings WHERE key = 'wa_target'`));
    await query(
      `INSERT INTO settings (key, value) VALUES ('wa_target', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(v)],
    );
  },
};

const defaultDeps = () => ({
  loadBaileys: () => import('@whiskeysockets/baileys'),
  raw: pgRaw,
  target: pgTarget,
  backoff: (n) => Math.min(60_000, 2_000 * 2 ** Math.min(n - 1, 5)), // 2, 4, 8, 16, 32, 60 detik
});
let deps = defaultDeps();

/* ---------- enkripsi isi sesi ---------- */

let encKey = null;
const key = () => (encKey ||= Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'p2h-genset', 'wa-auth-v1', 32)));

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`;
}

function unseal(sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1.')) throw new Error('format sesi tidak dikenal');
  const buf = Buffer.from(sealed.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/** Keadaan login untuk Baileys (creds + kunci Signal), dibaca / ditulis lewat penyimpanan terenkripsi. */
async function loadAuth(B) {
  const enc = (v) => seal(JSON.stringify(v, B.BufferJSON.replacer));
  const dec = (s) => JSON.parse(unseal(s), B.BufferJSON.reviver);
  let creds = null;
  let unreadable = false;
  const saved = (await deps.raw.get(['creds'])).creds;
  if (saved) {
    try {
      creds = dec(saved);
    } catch {
      // jangan dihapus otomatis: bisa jadi server lain (dengan JWT_SECRET yang benar) masih memakainya
      unreadable = true;
    }
  }
  creds ||= B.initAuthCreds();
  let chain = Promise.resolve();
  return {
    creds,
    unreadable,
    saveCreds() {
      chain = chain
        .then(() => deps.raw.set({ creds: enc(creds) }))
        .catch((err) => console.error('[wa] gagal menyimpan sesi:', err.message));
      return chain;
    },
    keys: {
      async get(type, ids) {
        const got = await deps.raw.get(ids.map((id) => `${type}-${id}`));
        const out = {};
        for (const id of ids) {
          const s = got[`${type}-${id}`];
          if (!s) continue;
          let v = dec(s);
          if (type === 'app-state-sync-key' && v) v = B.proto.Message.AppStateSyncKeyData.fromObject(v);
          out[id] = v;
        }
        return out;
      },
      async set(data) {
        const entries = {};
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const v = data[type][id];
            entries[`${type}-${id}`] = v ? enc(v) : null;
          }
        }
        await deps.raw.set(entries);
      },
    },
  };
}

/* ---------- keadaan ---------- */

// phase: idle (belum ditautkan) | pairing (menunggu scan QR) | connecting | open | closed (ditautkan, sedang tidak tersambung)
const ST = { phase: 'idle', qr: null, me: null, error: null, last: null };
let auth = null; // hasil loadAuth; dipakai ulang tiap sambung ulang
let sock = null; // sambungan yang sedang hidup
let epoch = 0; // naik tiap sambungan baru; kejadian dari sambungan lama diabaikan
let starting = null;
let retryTimer = null;
let retries = 0;
let waVersion = null;
let triedVersion = false;
let stopped = false;
let target = null; // { id, name } grup tujuan
let ignored = 0;
let sendChain = Promise.resolve();
const waiters = new Set();

const paired = () => !!auth?.creds?.me?.id;
const numberOf = (jid) => (jid ? `+${String(jid).split('@')[0].split(':')[0]}` : null);
const settle = (err) => {
  for (const w of [...waiters]) w.done(err);
};

/** Baileys menulis log lewat ini. Hanya peringatan dan error, dan hanya kalimatnya (tanpa isi pesan / kunci). */
function makeLogger() {
  const debug = !!process.env.WA_DEBUG;
  const say = (lvl) => (obj, msg) => {
    const text = typeof obj === 'string' ? obj : msg || obj?.err?.message || obj?.error?.message || '';
    if (text) console[lvl === 'error' ? 'error' : 'warn'](`[wa] baileys ${lvl}: ${text}`);
  };
  const off = () => {};
  const l = { level: debug ? 'info' : 'warn', child: () => l, trace: off, debug: off, info: debug ? say('info') : off, warn: say('warn'), error: say('error') };
  return l;
}

async function wipe() {
  auth = null;
  ST.me = null;
  await deps.raw.clear();
}

async function openSocket({ pairing = false } = {}) {
  if (sock || stopped) return undefined;
  if (starting) return starting;
  starting = (async () => {
    const B = await deps.loadBaileys();
    if (!auth) {
      auth = await loadAuth(B);
      if (auth.unreadable && !pairing) {
        ST.phase = 'idle';
        ST.error = 'Sesi WhatsApp yang tersimpan tidak bisa dibuka (JWT_SECRET server berubah?). Tautkan ulang.';
        console.warn(`[wa] ${ST.error}`);
        auth = null;
        return;
      }
    }
    if (!paired() && !pairing) {
      ST.phase = 'idle';
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = null;
    const my = ++epoch;
    const a = auth;
    ST.phase = paired() ? 'connecting' : 'pairing';
    ST.qr = null;
    const logger = makeLogger();
    const s = B.makeWASocket({
      auth: { creds: a.creds, keys: B.makeCacheableSignalKeyStore(a.keys, logger) },
      logger,
      browser: ['P2H Genset', 'Chrome', '1.0.0'], // nama yang tampil di daftar "Perangkat tertaut" di HP
      ...(waVersion ? { version: waVersion } : {}),
      markOnlineOnConnect: false, // HP tetap menerima notifikasi seperti biasa
      // riwayat lengkap tidak diminta. Sinkronisasi awal bawaan tetap jalan (tanpanya sesi tidak stabil),
      // tetapi isinya hanya lewat di memori: tidak ada yang menyimpan atau membacanya.
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      // hanya grup tujuan (dan pesan sistem dari nomor sendiri) yang diproses; selebihnya tidak dibuka
      shouldIgnoreJid: (jid) => {
        if (!jid || jid === target?.id) return false;
        const me = a.creds.me;
        if (me && (B.areJidsSameUser(jid, me.id) || (me.lid && B.areJidsSameUser(jid, me.lid)))) return false;
        ignored += 1;
        return true;
      },
    });
    sock = s;
    s.ev.on('creds.update', () => {
      if (a === auth) a.saveCreds();
    });
    s.ev.on('connection.update', (u) => {
      if (my !== epoch) return;
      if (u.qr) {
        ST.phase = 'pairing';
        ST.qr = u.qr;
      }
      if (u.isNewLogin) {
        ST.qr = null;
        ST.phase = 'connecting';
      }
      if (u.connection === 'open') {
        ST.phase = 'open';
        ST.qr = null;
        ST.error = null;
        ST.me = { number: numberOf(s.user?.id), name: s.user?.name || null };
        retries = 0;
        console.log(`[wa] tersambung sebagai ${ST.me.number}`);
        settle(null);
      } else if (u.connection === 'close') {
        onClose(B, u.lastDisconnect?.error).catch((err) => console.error('[wa] gagal menangani putus sambungan:', err.message));
      }
    });
  })().finally(() => {
    starting = null;
  });
  return starting;
}

async function onClose(B, err) {
  sock = null;
  ST.qr = null;
  if (stopped) return;
  const R = B.DisconnectReason;
  const code = err?.output?.statusCode;
  const why = err?.message || 'tanpa keterangan';

  if (code === R.loggedOut) {
    const was = paired();
    await wipe();
    ST.phase = 'idle';
    ST.error = was ? 'Tautan WhatsApp sudah diputus (dari HP, atau oleh WhatsApp). Tautkan lagi.' : null;
    if (was) console.warn(`[wa] ${ST.error}`);
    settle(new Error('WhatsApp tidak lagi ditautkan.'));
    return;
  }
  // versi WhatsApp Web bawaan pustaka sudah terlalu lama: ambil nomor versi terbaru, coba sekali lagi
  if (code === 405 && !triedVersion) {
    triedVersion = true;
    const r = await B.fetchLatestWaWebVersion({}).catch(() => null);
    if (r?.isLatest) waVersion = r.version;
    await openSocket({ pairing: !paired() });
    return;
  }
  // sesudah QR di-scan, WhatsApp meminta sambungan dibuka ulang
  if (code === R.restartRequired) {
    await openSocket({ pairing: !paired() });
    return;
  }
  if (!paired()) {
    await wipe();
    ST.phase = 'idle';
    ST.error = code === R.timedOut ? 'Kode QR kedaluwarsa. Tekan Hubungkan untuk membuat yang baru.' : `Gagal menautkan WhatsApp: ${why}`;
    settle(new Error(ST.error));
    return;
  }
  ST.phase = 'closed';
  if (code === R.connectionReplaced) {
    ST.error = 'Sesi WhatsApp ini sedang dipakai server lain. Server ini berhenti menyambung supaya tidak saling memutus.';
    console.warn(`[wa] ${ST.error}`);
    settle(new Error(ST.error));
    return;
  }
  if (code === R.forbidden) {
    ST.error = 'WhatsApp menolak nomor ini (kemungkinan diblokir).';
    console.warn(`[wa] ${ST.error}`);
    settle(new Error(ST.error));
    return;
  }
  // putus biasa (jaringan, server WhatsApp): sambung ulang sendiri, makin lama makin jarang
  ST.error = `Sambungan WhatsApp putus (${why}). Sedang mencoba lagi.`;
  retries += 1;
  retryTimer = setTimeout(() => {
    openSocket().catch((e) => console.error('[wa] gagal menyambung ulang:', e.message));
  }, deps.backoff(retries));
  retryTimer.unref?.();
}

/** Tunggu sampai tersambung (menyambung dulu bila perlu). Melempar error bila belum ditautkan atau habis waktu. */
async function ensureOpen(ms = OPEN_TIMEOUT_MS) {
  if (ST.phase === 'open' && sock) return sock;
  if (!sock) {
    clearTimeout(retryTimer);
    retryTimer = null;
    await openSocket();
  }
  if (ST.phase === 'open' && sock) return sock;
  if (!paired()) throw new Error(ST.error || 'WhatsApp belum ditautkan.');
  return new Promise((resolve, reject) => {
    const w = {
      done(err) {
        clearTimeout(t);
        waiters.delete(w);
        if (err) reject(err);
        else resolve(sock);
      },
    };
    const t = setTimeout(() => w.done(new Error('WhatsApp belum tersambung (habis waktu).')), ms);
    waiters.add(w);
  });
}

const withTimeout = (p, ms, msg) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

/* ---------- yang dipakai bagian lain ---------- */

/** Dipanggil sekali sesudah database siap. Menyambung sendiri bila WhatsApp sudah pernah ditautkan. */
export async function initGateway() {
  stopped = false;
  target = await deps.target.load();
  const has = (await deps.raw.get(['creds'])).creds;
  if (!has) {
    ST.phase = 'idle';
    return false;
  }
  await openSocket();
  return paired();
}

/** Dipanggil saat server berhenti: tutup sambungan tanpa memutus tautan. */
export function stopGateway() {
  stopped = true;
  clearTimeout(retryTimer);
  retryTimer = null;
  epoch += 1;
  const s = sock;
  sock = null;
  try {
    s?.end?.(undefined);
  } catch {
    /* abaikan */
  }
  settle(new Error('Server sedang berhenti.'));
}

export const gatewayReady = () => paired() && !!target;

export function gatewayStatus() {
  return {
    phase: ST.phase,
    paired: paired(),
    number: ST.me?.number ?? numberOf(auth?.creds?.me?.id),
    name: ST.me?.name ?? auth?.creds?.me?.name ?? null,
    qr: ST.qr,
    error: ST.error,
    target,
    last: ST.last,
  };
}

/** Admin menekan "Hubungkan": buat sambungan baru yang menampilkan kode QR untuk di-scan. */
export async function startPairing() {
  if (paired()) return;
  if (sock && ST.phase === 'pairing') return;
  stopped = false;
  await wipe(); // buang sisa sesi lama / yang tidak terbaca
  ST.error = null;
  triedVersion = false;
  await openSocket({ pairing: true });
}

/** Admin menutup QR sebelum di-scan. */
export async function cancelPairing() {
  if (paired() || !sock) return;
  epoch += 1;
  const s = sock;
  sock = null;
  try {
    s.end?.(undefined);
  } catch {
    /* abaikan */
  }
  await wipe();
  ST.phase = 'idle';
  ST.qr = null;
  ST.error = null;
}

/**
 * Putuskan tautan: minta WhatsApp mencabut perangkat ini, lalu hapus sesi dari database.
 * clean = false berarti WhatsApp tidak bisa dihubungi; sesi tetap dihapus, tapi perangkat "P2H Genset"
 * masih tercantum di HP dan perlu dicabut sendiri di sana.
 */
export async function logoutGateway() {
  clearTimeout(retryTimer);
  retryTimer = null;
  let clean = false;
  if (paired()) {
    try {
      const s = await ensureOpen(15_000);
      await s.logout();
      clean = true;
    } catch {
      /* tidak tersambung: hapus sesi di sini saja */
    }
  }
  epoch += 1;
  const s = sock;
  sock = null;
  try {
    s?.end?.(undefined);
  } catch {
    /* abaikan */
  }
  await wipe();
  ST.phase = 'idle';
  ST.qr = null;
  ST.error = null;
  settle(new Error('Tautan WhatsApp diputus.'));
  return { clean };
}

/** Kirim teks. Antre satu per satu; sambungan yang putus tepat saat mengirim dicoba sekali lagi. */
export function sendText(jid, text) {
  const once = async () => {
    const s = await ensureOpen();
    return withTimeout(s.sendMessage(jid, { text }), SEND_TIMEOUT_MS, 'WhatsApp tidak membalas (habis waktu).');
  };
  const run = async () => {
    try {
      try {
        await once();
      } catch (err) {
        // 428 = sambungan sudah tertutup sebelum pesan berangkat, jadi aman diulang (tidak akan dobel)
        if (err?.output?.statusCode !== 428) throw err;
        await once();
      }
      ST.last = { at: new Date().toISOString(), ok: true, detail: 'terkirim' };
    } catch (err) {
      ST.last = { at: new Date().toISOString(), ok: false, detail: err.message };
      throw err;
    }
  };
  const p = sendChain.then(run, run);
  sendChain = p.catch(() => {});
  return p;
}

/** Grup yang diikuti nomor pengirim. */
export async function listGroups() {
  const s = await ensureOpen();
  const all = await s.groupFetchAllParticipating();
  return Object.values(all)
    .map((g) => ({ id: g.id, name: g.subject || '', size: g.size ?? g.participants?.length ?? null, admin_only: !!g.announce }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** Pilih grup tujuan (null = kosongkan). Nama diambil dari WhatsApp, bukan dari kiriman tampilan. */
export async function setTarget(id) {
  if (!id) {
    target = null;
    await deps.target.save(null);
    return null;
  }
  const g = (await listGroups()).find((x) => x.id === id);
  if (!g) throw new Error('Nomor pengirim bukan anggota grup itu.');
  target = { id: g.id, name: g.name };
  await deps.target.save(target);
  return target;
}

/* ---------- khusus uji ---------- */

export function __setDepsForTest(d) {
  deps = { ...defaultDeps(), ...d };
}
export function __resetForTest() {
  clearTimeout(retryTimer);
  Object.assign(ST, { phase: 'idle', qr: null, me: null, error: null, last: null });
  auth = null;
  sock = null;
  epoch += 1;
  starting = null;
  retryTimer = null;
  retries = 0;
  waVersion = null;
  triedVersion = false;
  stopped = false;
  target = null;
  ignored = 0;
  encKey = null;
  sendChain = Promise.resolve();
  waiters.clear();
}
export const __ignoredCount = () => ignored;
