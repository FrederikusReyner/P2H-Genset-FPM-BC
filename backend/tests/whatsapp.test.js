// Uji kabar temuan ke grup WhatsApp lewat gateway sendiri. Tidak butuh server, database, maupun internet:
// sambungan WhatsApp ditiru (makeWASocket palsu), penyimpanan sesi ditiru di memori. Tidak ada pesan sungguhan.
// Jalankan:  npm run test:wa
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.DATABASE_URL ||= 'postgres://tidak-dipakai/uji';
process.env.JWT_SECRET ||= 'x'.repeat(40);

const GROUP = '120363000000000000@g.us';
const OTHER = '120363999999999999@g.us';
const ME = '6282287686350:7@s.whatsapp.net';

const FORM = { id: 123, unit_code: 'GS-SUA-01', site_name: 'Suaran', shift: 1, shift_date: '2026-11-13', inspector_name: 'Budi Santoso' };
const AA = { danger_code: 'AA', item_text: 'Level **oli mesin**', condition: 'rusak', note: 'oli merembes di seal depan' };
const A = { danger_code: 'A', item_text: 'Lampu panel', condition: 'perbaiki', note: 'satu lampu mati' };

const until = async (fn, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('habis waktu menunggu');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/* ---------- WhatsApp tiruan ---------- */
const sockets = [];
function fakeSocket(cfg) {
  const handlers = {};
  const ev = {
    on: (n, f) => (handlers[n] ||= []).push(f),
    emit: (n, v) => (handlers[n] || []).forEach((f) => f(v)),
  };
  const s = {
    cfg,
    ev,
    sent: [],
    user: undefined,
    ended: false,
    async sendMessage(jid, c) {
      s.sent.push({ jid, text: c.text });
      return {};
    },
    async groupFetchAllParticipating() {
      return {
        [GROUP]: { id: GROUP, subject: 'FPM Suaran - Info Genset', size: 12, announce: false },
        [OTHER]: { id: OTHER, subject: 'Keluarga', size: 5, announce: false },
      };
    },
    async logout() {
      setImmediate(() => s.close(401));
    },
    end() {
      s.ended = true;
    },
    close(code) {
      ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: Object.assign(new Error(`tutup ${code}`), { output: { statusCode: code } }) } });
    },
    open() {
      s.user = cfg.auth.creds.me;
      ev.emit('connection.update', { connection: 'open' });
    },
    /** tiruan "HP men-scan QR": WhatsApp mengirim identitas lalu minta sambungan dibuka ulang */
    scan() {
      cfg.auth.creds.me = { id: ME, name: 'P2H Genset FPM' };
      ev.emit('creds.update', {});
      ev.emit('connection.update', { isNewLogin: true });
      s.close(515);
    },
  };
  sockets.push(s);
  setImmediate(() => (cfg.auth.creds.me ? s.open() : ev.emit('connection.update', { qr: `2@qr-uji-${sockets.length}` })));
  return s;
}

const store = new Map();
const raw = {
  async get(keys) {
    return Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
  },
  async set(entries) {
    for (const [k, v] of Object.entries(entries)) v == null ? store.delete(k) : store.set(k, v);
  },
  async clear() {
    store.clear();
  },
};
let savedTarget = null;
const targetStore = { load: async () => savedTarget, save: async (v) => void (savedTarget = v) };

describe('Kabar temuan ke grup WhatsApp (gateway sendiri)', () => {
  let gw;
  let wa;
  let config;
  let real;
  const last = () => sockets[sockets.length - 1];

  before(async () => {
    ({ config } = await import('../src/config.js'));
    config.appUrl = 'https://p2h.example.test';
    real = await import('@whiskeysockets/baileys');
    gw = await import('../src/services/wa-gateway.js');
    wa = await import('../src/services/whatsapp.js');
  });

  beforeEach(() => {
    gw.__resetForTest();
    gw.__setDepsForTest({ loadBaileys: async () => ({ ...real, makeWASocket: fakeSocket }), raw, target: targetStore, backoff: () => 10 });
    sockets.length = 0;
    store.clear();
    savedTarget = null;
  });

  after(() => gw.stopGateway());

  /** tautkan nomor dan pilih grup, seperti yang dilakukan admin di halaman Pengaturan */
  async function pairAndPick() {
    await gw.startPairing();
    await until(() => gw.gatewayStatus().qr);
    last().scan();
    await until(() => gw.gatewayStatus().phase === 'open');
    await gw.setTarget(GROUP);
  }

  test('isi pesan: temuan AA + A -> STOP OPERASI, lengkap dengan catatan dan tautan', () => {
    const m = wa.buildFindingMessage(FORM, [A, AA], { deadlineHours: 12 });
    assert.match(m, /^🛑 \*STOP OPERASI · GS-SUA-01\*\nJangan jalankan unit sebelum diperbaiki\./);
    assert.match(m, /Shift: I · Jumat, 13 November 2026/);
    assert.match(m, /\*Kode AA \(1\) · unit harus berhenti:\*\n1\. Level oli mesin \(Rusak\)\n {3}Catatan: oli merembes di seal depan/);
    assert.match(m, /\*Kode A \(1\) · perbaiki dalam 12 jam:\*\n1\. Lampu panel \(Perbaiki\)/);
    assert.ok(m.endsWith('Rincian dan foto: https://p2h.example.test/p2h/123'));
    assert.ok(!m.includes('**'));
  });

  test('isi pesan: hanya temuan A -> bukan STOP, batas jam mengikuti pengaturan', () => {
    const m = wa.buildFindingMessage({ ...FORM, shift: 2 }, [A], { deadlineHours: 24 });
    assert.match(m, /^⚠️ \*Ada temuan P2H · GS-SUA-01\*/);
    assert.ok(!/STOP|Kode AA/.test(m));
    assert.match(m, /perbaiki dalam 24 jam/);
  });

  test('menautkan: QR tampil sebagai gambar, sesudah scan tersambung, sesi tersimpan terenkripsi', async () => {
    await gw.startPairing();
    await until(() => gw.gatewayStatus().qr);
    const s1 = wa.whatsappStatus();
    assert.equal(s1.phase, 'pairing');
    assert.match(s1.qr, /^data:image\/gif;base64,/);
    // riwayat lengkap tidak diminta, HP tetap menerima notifikasi
    assert.equal(last().cfg.syncFullHistory, false);
    assert.equal(last().cfg.markOnlineOnConnect, false);

    last().scan();
    await until(() => gw.gatewayStatus().phase === 'open');
    assert.equal(sockets.length, 2, 'dibuka ulang sesudah scan');
    const s2 = wa.whatsappStatus();
    assert.equal(s2.paired, true);
    assert.equal(s2.number, '+6282287686350');
    assert.equal(s2.qr, null);
    assert.equal(s2.enabled, false, 'grup belum dipilih');

    await until(() => store.has('creds'));
    const sealed = store.get('creds');
    assert.match(sealed, /^v1\./);
    assert.ok(!sealed.includes('6282287686350'), 'nomor tidak terbaca di database');
    assert.ok(!JSON.stringify(s2).includes(sealed.slice(3, 40)), 'sesi tidak ikut ke tampilan');
  });

  test('hanya grup tujuan yang diproses; chat dan grup lain tidak dibuka', async () => {
    await pairAndPick();
    const ignore = last().cfg.shouldIgnoreJid;
    assert.equal(ignore(GROUP), false);
    assert.equal(ignore('6281111111111@s.whatsapp.net'), true);
    assert.equal(ignore(OTHER), true);
    assert.equal(ignore('status@broadcast'), true);
    assert.equal(ignore(ME), false, 'pesan sistem dari nomor sendiri tetap diproses');
  });

  test('pilih grup: hanya grup yang diikuti; nama diambil dari WhatsApp', async () => {
    await pairAndPick();
    assert.deepEqual(savedTarget, { id: GROUP, name: 'FPM Suaran - Info Genset' });
    await assert.rejects(() => gw.setTarget('120363000000000001@g.us'), /bukan anggota/);
    assert.equal((await gw.listGroups()).length, 2);
  });

  test('temuan dikirim ke grup tujuan; pesan tes juga', async () => {
    await pairAndPick();
    assert.equal(wa.whatsappStatus().enabled, true);
    assert.deepEqual(await wa.notifyFindingGroup(FORM, [AA, A], { deadlineHours: 12 }), { ok: true });
    assert.deepEqual(last().sent, [{ jid: GROUP, text: wa.buildFindingMessage(FORM, [AA, A], { deadlineHours: 12 }) }]);
    assert.deepEqual(await wa.sendTestToGroup('Admin Uji'), { ok: true });
    assert.match(last().sent[1].text, /Tes P2H Genset[\s\S]*Dikirim oleh: Admin Uji/);
    assert.equal(wa.whatsappStatus().last.ok, true);
  });

  test('belum ditautkan / tidak ada temuan: tidak ada yang dikirim, P2H tidak terganggu', async () => {
    assert.deepEqual(await wa.notifyFindingGroup(FORM, [AA]), { ok: false, skipped: true });
    assert.match((await wa.sendTestToGroup('Admin')).reason, /belum ditautkan/);
    assert.equal(sockets.length, 0);
  });

  test('sambungan putus: menyambung ulang sendiri, lalu pesan tetap terkirim', async () => {
    await pairAndPick();
    last().close(408);
    await until(() => sockets.length === 3 && gw.gatewayStatus().phase === 'open');
    assert.deepEqual(await wa.notifyFindingGroup(FORM, [A]), { ok: true });
    assert.equal(last().sent.length, 1);
  });

  test('tautan dicabut dari HP: sesi dihapus dan fitur mati', async () => {
    await pairAndPick();
    last().close(401);
    await until(() => gw.gatewayStatus().phase === 'idle');
    assert.equal(store.size, 0);
    assert.equal(wa.whatsappStatus().paired, false);
    assert.match(wa.whatsappStatus().error, /diputus/);
  });

  test('Putuskan dari halaman admin: perangkat dicabut di WhatsApp dan sesi dihapus', async () => {
    await pairAndPick();
    assert.deepEqual(await gw.logoutGateway(), { clean: true });
    assert.equal(store.size, 0);
    assert.equal(gw.gatewayStatus().phase, 'idle');
  });

  test('server hidup ulang: tersambung lagi dari sesi di database tanpa scan', async () => {
    await pairAndPick();
    await until(() => store.has('creds'));
    gw.stopGateway();
    gw.__resetForTest();
    gw.__setDepsForTest({ loadBaileys: async () => ({ ...real, makeWASocket: fakeSocket }), raw, target: targetStore, backoff: () => 10 });
    assert.equal(await gw.initGateway(), true);
    await until(() => gw.gatewayStatus().phase === 'open');
    assert.equal(gw.gatewayReady(), true);
  });

  test('JWT_SECRET berubah: sesi lama tidak bisa dibuka dan diminta tautkan ulang', async () => {
    await pairAndPick();
    await until(() => store.has('creds'));
    gw.stopGateway();
    const old = config.jwtSecret;
    gw.__resetForTest();
    config.jwtSecret = 'y'.repeat(40);
    try {
      gw.__setDepsForTest({ loadBaileys: async () => ({ ...real, makeWASocket: fakeSocket }), raw, target: targetStore, backoff: () => 10 });
      const n = sockets.length;
      await gw.initGateway();
      assert.equal(sockets.length, n, 'tidak menyambung dengan sesi yang tidak terbaca');
      assert.match(gw.gatewayStatus().error, /tidak bisa dibuka/);
    } finally {
      config.jwtSecret = old;
    }
  });
});
