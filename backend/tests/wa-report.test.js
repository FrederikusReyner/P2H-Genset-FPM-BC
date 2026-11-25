// Uji kabar "temuan selesai diperbaiki" ke grup WhatsApp. WhatsApp ditiru: tidak ada pesan sungguhan.
// (Rekap per site per shift sudah tidak dikirim: grup hanya menerima temuan A / AA dan perbaikannya.)
// Jalankan:  npm run test:rekap
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

process.env.JWT_SECRET ||= 'x'.repeat(40);
process.env.DATABASE_URL ||= 'postgres://uji:uji@localhost:1/uji'; // tidak dipakai: modul ini tidak menyentuh database

const GROUP = '120363000000000000@g.us';
const NOW = Date.parse('2026-11-10T14:00:00Z');

describe('Kabar temuan selesai ke grup WhatsApp', () => {
  let rep;
  let sent;

  beforeEach(async () => {
    rep ??= await import('../src/services/wa-report.js');
    sent = [];
    rep.__setDepsForTest({ ready: () => true, target: () => ({ id: GROUP, name: 'Grup uji' }), now: () => NOW, send: async (jid, text) => void sent.push({ jid, text }) });
  });

  test('WhatsApp belum aktif: tidak ada yang dikirim', async () => {
    rep.__setDepsForTest({ ready: () => false, send: async () => assert.fail('tidak boleh mengirim') });
    assert.deepEqual(await rep.notifyFixedGroup({ unit_code: 'X' }), { ok: false, skipped: true });
  });

  test('rekap per site per shift tidak ada lagi (grup tidak terlalu ramai)', () => {
    assert.equal(rep.onSiteActivity, undefined);
    assert.equal(rep.sendIfComplete, undefined);
  });

  test('temuan selesai: STOP terakhir -> "Boleh jalan lagi"', async () => {
    assert.deepEqual(
      await rep.notifyFixedGroup({
        unit_code: 'GS-SUA-01', site_name: 'Suaran', item_text: 'Level **oli** mesin', danger_code: 'AA', fix_note: 'ganti seal depan',
        by_name: 'Andi Pratama', by_role: 'pengawas', first_seen_at: new Date(NOW - 6.5 * 3600_000).toISOString(), unit_free: true, still_stop: false,
      }),
      { ok: true },
    );
    assert.equal(sent[0].jid, GROUP);
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

  test('kiriman gagal: tidak melempar error, perbaikan tetap tersimpan', async () => {
    rep.__setDepsForTest({ ready: () => true, target: () => ({ id: GROUP }), send: async () => { throw new Error('putus'); } });
    assert.deepEqual(await rep.notifyFixedGroup({ unit_code: 'GS-1', site_name: 'Suaran', item_text: 'x', danger_code: 'A', by_name: 'B' }), { ok: false, reason: 'putus' });
  });
});
