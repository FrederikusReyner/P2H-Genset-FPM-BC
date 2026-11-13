// Uji rekap P2H per site per shift dan kabar "temuan selesai" ke grup WhatsApp, dengan database PostgreSQL sungguhan
// (dinyalakan sementara oleh embedded-postgres, lalu dihapus). WhatsApp ditiru: tidak ada pesan sungguhan.
// Jalankan:  npm run test:rekap
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

const PORT = 5400 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2h-rekap-'));
process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/p2h`;
process.env.JWT_SECRET ||= 'x'.repeat(40);
process.env.APP_URL = 'https://p2h.example.test';

const GROUP = '120363000000000000@g.us';
const DATE = '2026-11-10'; // Shift I berakhir 18:00 WITA = 10:00 UTC
const NOW = Date.parse('2026-11-10T14:00:00Z'); // 22:00 WITA: Shift I sudah lewat 4 jam, Shift II sedang jalan

describe('Rekap P2H per site per shift ke grup WhatsApp', () => {
  let pg;
  let db;
  let rep;
  let site;
  let units; // genset Suaran: [0..2] running, [3] breakdown
  let userId;
  let sent;
  let failNext;
  let since;

  before(async () => {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('p2h');
    db = await import('../src/db.js');
    await (await import('../src/bootstrap.js')).bootstrap(() => {});
    rep = await import('../src/services/wa-report.js');

    site = (await db.query(`SELECT id FROM sites WHERE name = 'Suaran'`)).rows[0].id;
    // site uji dibuat rapi: 4 genset, satu di antaranya breakdown (tidak wajib P2H)
    await db.query(`UPDATE units SET status = 'inactive' WHERE site_id = $1`, [site]);
    const ids = (await db.query(`SELECT id FROM units WHERE site_id = $1 ORDER BY code LIMIT 4`, [site])).rows.map((r) => r.id);
    assert.equal(ids.length, 4, 'site Suaran punya minimal 4 genset');
    await db.query(`UPDATE units SET status = 'running' WHERE id = ANY($1::int[])`, [ids.slice(0, 3)]);
    await db.query(`UPDATE units SET status = 'breakdown' WHERE id = $1`, [ids[3]]);
    units = (await db.query(`SELECT id, code FROM units WHERE id = ANY($1::int[]) ORDER BY code`, [ids])).rows;
    userId = (
      await db.query(`INSERT INTO users (nrp, name, password_hash, role, site_id) VALUES ('uji-rekap', 'Budi Santoso', 'x', 'pengawas', $1) RETURNING id`, [site])
    ).rows[0].id;
  });

  after(async () => {
    await db?.pool.end().catch(() => {});
    await pg?.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sent = [];
    failNext = false;
    since = '2026-11-01T00:00:00Z';
    await db.query('DELETE FROM wa_site_reports');
    await db.query('DELETE FROM p2h_forms');
    rep.__setDepsForTest({
      ready: () => true,
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

  /** Simpan satu P2H. findings: [[kode, teks, kondisi, catatan, status perbaikan?]] */
  async function p2h(u, { date = DATE, shift = 1, findings = [], verified = true } = {}) {
    const nAA = findings.filter((f) => f[0] === 'AA').length;
    const nA = findings.length - nAA;
    const f = (
      await db.query(
        `INSERT INTO p2h_forms (unit_id, site_id, shift_date, shift, user_id, inspector_name, unit_code, site_name, result, n_aa, n_a,
                                sup_name, sup_signed_at)
         VALUES ($1,$2,$3,$4,$5,'Budi Santoso',$6,'Suaran',$7,$8,$9,$10,$11) RETURNING id`,
        [u.id, site, date, shift, userId, u.code, nAA ? 'stop_aa' : nA ? 'temuan_a' : 'baik', nAA, nA,
          verified ? 'Andi Pratama' : null, verified ? new Date(NOW) : null],
      )
    ).rows[0].id;
    let no = 0;
    for (const [code, text, condition, note, fix = 'open'] of findings) {
      no += 1;
      await db.query(
        `INSERT INTO p2h_answers (form_id, section_code, section_title, section_order, item_no, item_text, danger_code, condition, note, fix_status)
         VALUES ($1,'A','Mesin',1,$2,$3,$4,$5,$6,$7)`,
        [f, no, text, code, condition, note, fix],
      );
    }
    return f;
  }

  const verifyAll = () => db.query(`UPDATE p2h_forms SET sup_name = 'Andi Pratama', sup_signed_at = now() WHERE sup_signed_at IS NULL`);

  test('belum semua genset wajib di-P2H: rekap belum dikirim', async () => {
    await p2h(units[0]);
    await p2h(units[1]);
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: false, skipped: 'belum lengkap' });
    assert.equal(sent.length, 0);
  });

  test('semua sudah P2H tetapi ada yang belum diverifikasi: rekap belum dikirim', async () => {
    await p2h(units[0]);
    await p2h(units[1]);
    await p2h(units[2], { verified: false });
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: false, skipped: 'belum lengkap' });
    assert.equal(sent.length, 0);
  });

  test('semua terverifikasi: satu rekap lengkap, tidak terkirim dua kali', async () => {
    await p2h(units[0]);
    const fa = await p2h(units[1], { findings: [['A', 'Lampu **panel**', 'perbaiki', 'satu lampu mati']] });
    await p2h(units[2]);
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: true, complete: true });
    assert.equal(sent.length, 1);
    const t = sent[0].text;
    assert.equal(sent[0].jid, GROUP);
    assert.match(t, /^📋 \*Rekap P2H Suaran · Shift I\*\nSelasa, 10 November 2026\n✅ 3 dari 3 genset sudah P2H dan diverifikasi/);
    assert.match(t, new RegExp(`⚠️ ${units[1].code}\\n {3}A, perbaiki dalam 12 jam · Lampu panel \\(Perbaiki\\): satu lampu mati\\n {3}Rincian: https://p2h.example.test/p2h/${fa}`));
    assert.match(t, new RegExp(`Baik: ${units[0].code}, ${units[2].code}`));
    assert.match(t, new RegExp(`Breakdown \\(tidak wajib P2H\\): ${units[3].code}`));
    assert.match(t, /Diverifikasi oleh: Andi Pratama$/);
    assert.ok(!t.includes('**'));
    assert.equal(await rep.reportSent(site, DATE, 1), true);

    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: false, skipped: 'sudah dikirim' });
    assert.equal(sent.length, 1);
  });

  test('semua baik: rekap singkat', async () => {
    for (const u of units.slice(0, 3)) await p2h(u);
    await rep.sendIfComplete(site, DATE, 1);
    assert.match(sent[0].text, /\n\nSemua genset baik, tidak ada temuan\./);
    assert.ok(!sent[0].text.includes('Baik:'));
  });

  test('STOP AA yang belum selesai ditandai STOP; yang sudah diperbaiki ditandai', async () => {
    await p2h(units[0], { findings: [['AA', 'Level oli mesin', 'rusak', 'oli merembes']] });
    await p2h(units[1], { findings: [['AA', 'Tekanan oli', 'rusak', 'sensor rusak', 'closed']] });
    await p2h(units[2]);
    await rep.sendIfComplete(site, DATE, 1);
    const t = sent[0].text;
    assert.match(t, new RegExp(`🛑 ${units[0].code} · STOP OPERASI\\n {3}AA · Level oli mesin \\(Rusak\\): oli merembes\\n`));
    assert.match(t, new RegExp(`⚠️ ${units[1].code}\\n {3}AA · Tekanan oli \\(Rusak\\): sensor rusak · sudah diperbaiki`));
  });

  test('kiriman gagal: tanda dilepas, lalu berhasil pada kesempatan berikutnya', async () => {
    for (const u of units.slice(0, 3)) await p2h(u);
    failNext = true;
    assert.equal((await rep.sendIfComplete(site, DATE, 1)).ok, false);
    assert.equal(await rep.reportSent(site, DATE, 1), false);
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: true, complete: true });
    assert.equal(sent.length, 1);
  });

  test('shift sudah lewat 3 jam tetapi belum lengkap: rekap "belum lengkap" dengan daftar yang kurang', async () => {
    await p2h(units[0]);
    await p2h(units[1], { verified: false });
    // Shift II hari yang sama baru berjalan: belum boleh dikirim
    await p2h(units[0], { shift: 2, verified: false });
    const out = await rep.sendOverdue(site);
    assert.deepEqual(out, [{ ok: true, complete: false }]);
    assert.equal(sent.length, 1);
    const t = sent[0].text;
    assert.match(t, /^⏰ \*Rekap P2H Suaran · Shift I \(belum lengkap\)\*/);
    assert.match(t, /Sudah P2H: 2 dari 3 genset · diverifikasi: 1 dari 2/);
    assert.match(t, new RegExp(`Belum P2H: ${units[2].code}\\n`));
    assert.match(t, new RegExp(`Belum diverifikasi: ${units[1].code}`));
    assert.equal(await rep.reportSent(site, DATE, 2), false);

    // sesudah itu lengkap pun tidak dikirim lagi
    await p2h(units[2]);
    await verifyAll();
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: false, skipped: 'sudah dikirim' });
    assert.equal(sent.length, 1);
  });

  test('shift yang berakhir sebelum grup dipilih tidak direkap', async () => {
    since = '2026-11-10T12:00:00Z';
    for (const u of units.slice(0, 3)) await p2h(u);
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: false, skipped: 'sebelum grup dipilih' });
    assert.deepEqual(await rep.sendOverdue(site), []);
    assert.equal(sent.length, 0);
  });

  test('onSiteActivity (dipanggil sesudah verifikasi) mengirim rekap yang sudah lengkap', async () => {
    for (const u of units.slice(0, 3)) await p2h(u, { date: '2026-11-10', shift: 2 });
    await rep.onSiteActivity(site, '2026-11-10', 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Shift II\*/);
  });

  test('WhatsApp belum aktif: tidak ada yang dikirim', async () => {
    rep.__setDepsForTest({ ready: () => false, send: async () => assert.fail('tidak boleh mengirim') });
    for (const u of units.slice(0, 3)) await p2h(u);
    assert.deepEqual(await rep.sendIfComplete(site, DATE, 1), { ok: false, skipped: 'tidak aktif' });
    assert.deepEqual(await rep.notifyFixedGroup({ unit_code: 'X' }), { ok: false, skipped: true });
  });

  test('temuan selesai: STOP terakhir -> "Boleh jalan lagi"', async () => {
    assert.deepEqual(
      await rep.notifyFixedGroup({
        unit_code: 'GS-SUA-01', site_name: 'Suaran', item_text: 'Level **oli** mesin', danger_code: 'AA', fix_note: 'ganti seal depan',
        by_name: 'Andi Pratama', by_role: 'pengawas', first_seen_at: new Date(NOW - 6.5 * 3600_000).toISOString(), unit_free: true, still_stop: false,
      }),
      { ok: true },
    );
    assert.equal(
      sent[0].text,
      [
        '✅ *Boleh jalan lagi · GS-SUA-01*',
        'Tidak ada lagi temuan STOP di unit ini.',
        '',
        'Site: Suaran',
        'Butir: Level oli mesin (kode AA)',
        'Perbaikan: ganti seal depan',
        'Ditutup oleh: Andi Pratama (Pengawas)',
        'Lama terbuka: 6 jam',
      ].join('\n'),
    );
  });

  test('temuan A selesai, unit masih punya STOP lain', () => {
    const t = rep.buildFixedMessage(
      { unit_code: 'GS-SUA-02', site_name: 'Suaran', item_text: 'Lampu panel', danger_code: 'A', fix_note: 'lampu diganti', by_name: 'Budi', by_role: 'teknisi', first_seen_at: new Date(NOW - 50 * 3600_000), unit_free: false, still_stop: true },
      NOW,
    );
    assert.match(t, /^✅ \*Temuan selesai · GS-SUA-02\*\n🛑 Unit masih STOP: ada temuan AA lain yang belum selesai\./);
    assert.match(t, /Ditutup oleh: Budi \(Teknisi\)/);
    assert.match(t, /Lama terbuka: 2 hari 2 jam$/);
  });
});
