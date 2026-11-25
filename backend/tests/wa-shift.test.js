// Uji rekap ringkas P2H Genset semua site tiap akhir shift ke grup WhatsApp, dengan database PostgreSQL sungguhan
// (dinyalakan sementara oleh embedded-postgres, lalu dihapus). WhatsApp ditiru: tidak ada pesan sungguhan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

const PORT = 5400 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2h-shiftsum-'));
process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/p2h`;
process.env.JWT_SECRET ||= 'x'.repeat(40);

const GROUP = '120363000000000000@g.us';
const DATE = '2026-11-10'; // Selasa. Shift I berakhir 18:00 WITA = 10:00 UTC
const NOW = Date.parse('2026-11-10T11:00:00Z'); // 19:00 WITA: Shift I baru berakhir 1 jam, Shift II berjalan

describe('Rekap ringkas semua site tiap akhir shift', () => {
  let pg;
  let db;
  let rep;
  let srn;
  let lti;
  let units; // Suaran: a, b (running); Lati: c (running), d (breakdown)
  let userId;
  let sent;
  let failNext;
  let since;
  let ready;

  before(async () => {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('p2h');
    db = await import('../src/db.js');
    await (await import('../src/bootstrap.js')).bootstrap(() => {});
    rep = await import('../src/services/wa-report.js');

    srn = (await db.query(`SELECT id FROM sites WHERE name = 'Suaran'`)).rows[0].id;
    lti = (await db.query(`SELECT id FROM sites WHERE name = 'Lati'`)).rows[0].id;
    // data uji rapi: semua genset nonaktif kecuali 2 di Suaran dan 2 di Lati (satu breakdown: tidak wajib P2H)
    await db.query(`UPDATE units SET status = 'inactive'`);
    const pick = async (site) => (await db.query(`SELECT id, code FROM units WHERE site_id = $1 AND pmmr_group = 'produksi' ORDER BY code LIMIT 2`, [site])).rows;
    const [a, b] = await pick(srn);
    const [c, d] = await pick(lti);
    await db.query(`UPDATE units SET status = 'running' WHERE id = ANY($1::int[])`, [[a.id, b.id, c.id]]);
    await db.query(`UPDATE units SET status = 'breakdown' WHERE id = $1`, [d.id]);
    units = { a, b, c, d };
    userId = (
      await db.query(`INSERT INTO users (nrp, name, password_hash, role, site_id) VALUES ('uji-shift', 'Budi Santoso', 'x', 'teknisi', $1) RETURNING id`, [srn])
    ).rows[0].id;
  });

  after(async () => {
    rep?.stopShiftSummary();
    await db?.pool.end().catch(() => {});
    await pg?.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sent = [];
    failNext = false;
    since = '2026-11-01T00:00:00Z';
    ready = true;
    await db.query('DELETE FROM wa_shift_summaries');
    await db.query('DELETE FROM p2h_forms');
    rep.__setDepsForTest({
      ready: () => ready,
      target: () => ({ id: GROUP, name: 'Grup uji', since }),
      now: () => NOW,
      send: async (jid, text) => {
        if (failNext) {
          failNext = false;
          throw new Error('WhatsApp sedang tidak tersambung.');
        }
        sent.push({ jid, text });
      },
    });
  });

  async function p2h(u, site, result, { verified = false } = {}) {
    await db.query(
      `INSERT INTO p2h_forms (unit_id, site_id, shift_date, shift, user_id, inspector_name, unit_code, site_name, result, n_aa, n_a, sup_name, sup_signed_at)
       VALUES ($1,$2,$3,1,$4,'Budi Santoso',$5,'x',$6,$7,$8,$9,$10)`,
      [u.id, site, DATE, userId, u.code, result, result === 'stop_aa' ? 1 : 0, result === 'temuan_a' ? 1 : 0, verified ? 'Andi' : null, verified ? new Date(NOW) : null],
    );
  }

  test('akhir shift: satu pesan ringkas semua site, tidak terkirim dua kali', async () => {
    await p2h(units.a, srn, 'baik', { verified: true });
    await p2h(units.b, srn, 'stop_aa');
    const r = await rep.sendShiftSummaryIfDue();
    assert.deepEqual(r, { ok: true, date: DATE, shift: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, GROUP);
    assert.equal(
      sent[0].text,
      [
        '📋 *Rekap P2H Genset · Shift I*',
        'Selasa, 10 November 2026',
        'P2H: 2/3 genset · terverifikasi 1',
        '',
        '✅ Suaran 2/2 · 1 STOP',
        '⏳ Lati 0/1',
        '',
        `🛑 STOP AA: ${units.b.code}`,
        `❌ Belum P2H: ${units.c.code}`,
      ].join('\n'),
    );
    assert.doesNotMatch(sent[0].text, new RegExp(units.d.code), 'genset breakdown tidak wajib P2H');
    assert.deepEqual(await rep.sendShiftSummaryIfDue(), { ok: false, skipped: 'sudah dikirim' });
    assert.equal(sent.length, 1);
  });

  test('semua lengkap dan baik: rekap singkat', async () => {
    for (const [u, s] of [[units.a, srn], [units.b, srn], [units.c, lti]]) await p2h(u, s, 'baik', { verified: true });
    await rep.sendShiftSummaryIfDue();
    assert.match(sent[0].text, /P2H: 3\/3 genset · terverifikasi 3\n\n✅ Suaran 2\/2\n✅ Lati 1\/1\n\nSemua genset sudah P2H dan baik\.$/);
  });

  test('kiriman gagal: penanda dilepas, lalu berhasil pada percobaan berikutnya', async () => {
    failNext = true;
    assert.equal((await rep.sendShiftSummaryIfDue()).ok, false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM wa_shift_summaries')).rows[0].n, 0);
    assert.equal((await rep.sendShiftSummaryIfDue()).ok, true);
    assert.equal(sent.length, 1);
  });

  test('WhatsApp belum aktif / grup dipilih sesudah shift berakhir: tidak dikirim', async () => {
    ready = false;
    assert.deepEqual(await rep.sendShiftSummaryIfDue(), { ok: false, skipped: 'tidak aktif' });
    ready = true;
    since = '2026-11-10T10:30:00Z';
    assert.deepEqual(await rep.sendShiftSummaryIfDue(), { ok: false, skipped: 'sebelum grup dipilih' });
    assert.equal(sent.length, 0);
  });

  test('Shift II: direkap pagi berikutnya (server yang sempat tidur tetap menyusulkan shift terakhir)', async () => {
    // 07:00 WITA tanggal 11 = Shift II tanggal 10 baru berakhir 1 jam
    rep.__setDepsForTest({ ready: () => true, target: () => ({ id: GROUP, since }), now: () => Date.parse('2026-11-10T23:00:00Z'), send: async (jid, text) => void sent.push({ jid, text }) });
    assert.deepEqual(await rep.sendShiftSummaryIfDue(), { ok: true, date: DATE, shift: 2 });
    assert.match(sent[0].text, /^📋 \*Rekap P2H Genset · Shift II\*\nSelasa, 10 November 2026\nP2H: 0\/3 genset/);
  });
});
