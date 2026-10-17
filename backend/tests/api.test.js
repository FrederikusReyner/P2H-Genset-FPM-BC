// Uji otomatis API. Jalankan server + database dulu, lalu:  npm test
// Memakai akun admin dari berkas .env (ADMIN_NRP / ADMIN_PASSWORD). Data uji dibersihkan di akhir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
try {
  process.loadEnvFile(path.join(here, '..', '.env'));
} catch {
  /* tidak ada .env */
}
const JSZip = require('jszip');
const ExcelJS = require('exceljs');

const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const SIG_TEK = fs.readFileSync(path.join(here, 'fixtures', 'signature-mekanik.txt'), 'utf8');
const SIG_SUP = fs.readFileSync(path.join(here, 'fixtures', 'signature-pengawas.txt'), 'utf8');
const jpg = (n) => `data:image/jpeg;base64,${fs.readFileSync(path.join(here, 'fixtures', n)).toString('base64')}`;
const PHOTO_A = jpg('foto-a.jpg');
const PHOTO_B = jpg('foto-b.jpg');

async function api(method, url, { token, body, raw } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, json, text };
}

const rnd = Math.random().toString(36).slice(2, 7);
const ctx = { forms: [], users: [], units: [] };

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Jawaban lengkap untuk semua butir. overrides = { nomorUrut(1-based): [kondisi, catatan, foto?] }.
 * Butir rusak / perbaiki otomatis diberi 1 foto, kecuali foto diisi [] (untuk menguji "foto wajib").
 */
function buildAnswers(meta, overrides = {}) {
  const answers = [];
  let n = 0;
  for (const sec of meta.checklist) {
    for (const it of sec.items) {
      n += 1;
      const o = overrides[n];
      if (!o) {
        answers.push({ item_id: it.id, condition: 'baik', note: null });
      } else {
        answers.push({ item_id: it.id, condition: o[0], note: o[1], photos: o[2] ?? [PHOTO_A] });
      }
    }
  }
  return answers;
}

const PARAMS_OK = {
  temp: { idle: 62, load: 78 }, oil: { idle: 55, load: 63 }, rpm: { idle: 1500, load: 1499 },
  load: { idle: 0, load: 387 }, volt: { idle: 400, load: 400 }, batt: { idle: 27.6, load: 28.5 },
};

describe('API P2H Genset', () => {
  let admin; let meta; let units;
  let tek; let sup; let tek2; let sup2; // tek & sup: site Suaran. tek2 & sup2: site Binungan
  let suaran; let binungan;

  before(async () => {
    const h = await api('GET', '/api/health');
    assert.equal(h.status, 200, 'server harus hidup dan siap (npm start)');
  });

  test('login salah ditolak, login admin berhasil', async () => {
    const bad = await api('POST', '/api/auth/login', { body: { nrp: 'admin', password: 'salah-banget' } });
    assert.equal(bad.status, 401);
    assert.match(bad.json.error.message, /No SID/);
    const ok = await api('POST', '/api/auth/login', {
      body: { nrp: process.env.ADMIN_NRP || 'admin', password: process.env.ADMIN_PASSWORD || 'Admin12345' },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    admin = ok.json.token;
    assert.equal(ok.json.user.role, 'admin');
  });

  test('tanpa login ditolak', async () => {
    assert.equal((await api('GET', '/api/units')).status, 401);
    assert.equal((await api('GET', '/api/dashboard')).status, 401);
    assert.equal((await api('GET', '/api/photos/1')).status, 401);
  });

  test('meta: 5 site, 4 bagian, 30 butir, 6 parameter', async () => {
    const r = await api('GET', '/api/meta', { token: admin });
    assert.equal(r.status, 200);
    meta = r.json;
    assert.deepEqual(meta.sites.map((s) => s.name), ['Binungan', 'Suaran', 'Gurimbang', 'Lati', 'Sambarata']);
    binungan = meta.sites[0].id;
    suaran = meta.sites[1].id;
    assert.equal(meta.checklist.length, 4);
    assert.equal(meta.checklist.flatMap((s) => s.items).length, 30);
    assert.equal(meta.params.length, 6);
    assert.deepEqual(meta.checklist.map((s) => s.items.length), [11, 10, 7, 2]);
    const aa = meta.checklist.flatMap((s) => s.items).filter((i) => i.danger_code === 'AA').length;
    assert.equal(aa, 8, 'ada 8 butir kode AA di form');
  });

  test('unit: 25 genset dari PMMR ada semua', async () => {
    const r = await api('GET', '/api/units', { token: admin });
    assert.equal(r.status, 200);
    units = r.json.items;
    const seed = JSON.parse(fs.readFileSync(path.join(here, '..', 'seed', 'units.json'), 'utf8'));
    assert.equal(seed.length, 25);
    const codes = new Set(units.map((u) => u.code.toLowerCase()));
    for (const s of seed) assert.ok(codes.has(s.code.toLowerCase()), `unit ${s.code} tidak ada`);
    const sites = new Set(units.map((u) => u.site_name));
    for (const n of ['Binungan', 'Suaran', 'Gurimbang', 'Lati', 'Sambarata']) assert.ok(sites.has(n), `site ${n} tidak ada`);
  });

  // Supaya uji tidak bertabrakan dengan data yang sudah ada (mis. contoh data), pakai unit uji sendiri:
  // A, B, C, E di Suaran dan D di Binungan.
  test('admin membuat 5 unit uji (dihapus lagi di akhir)', async () => {
    for (const [k, site] of [['A', suaran], ['B', suaran], ['C', suaran], ['D', binungan], ['E', suaran]]) {
      const r = await api('POST', '/api/units', {
        token: admin,
        body: { code: `UJI-${rnd}-${k}`, site_id: site, location: 'UJI', brand: 'Uji', model: 'T1', capacity_kva: 1000, rated_kw: 800, rated_voltage: 400, rated_rpm: 1500, status: 'running', hm_master: 100 },
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      ctx.units.push(r.json.item);
    }
    const dup = await api('POST', '/api/units', { token: admin, body: { code: `uji-${rnd}-a`, site_id: suaran, status: 'running' } });
    assert.equal(dup.status, 409, 'kode unit tidak boleh kembar (tanpa peduli huruf besar/kecil)');
  });

  test('admin membuat akun teknisi dan pengawas (Nama, Perusahaan, Jabatan, No SID, site); wajib ganti password', async () => {
    const wrong = await api('POST', '/api/users', { token: admin, body: { nrp: `x${rnd}`, name: 'Tanpa Site', role: 'pengawas' } });
    assert.equal(wrong.status, 422, 'pengawas tanpa site ditolak');
    assert.match(wrong.json.error.message, /site/i);
    const old = await api('POST', '/api/users', { token: admin, body: { nrp: `y${rnd}`, name: 'Peran Lama', role: 'manajemen', site_id: suaran } });
    assert.equal(old.status, 422, 'peran manajemen sudah tidak ada');

    const specs = [
      ['tek', 'teknisi', suaran, 'Teknisi'],
      ['sup', 'pengawas', suaran, 'Foreman'],
      ['tek2', 'teknisi', binungan, 'Teknisi'],
      ['sup2', 'pengawas', binungan, 'Foreman'],
    ];
    for (const [key, role, site, job] of specs) {
      const nrp = `t${key}${rnd}`;
      const r = await api('POST', '/api/users', {
        token: admin,
        body: { nrp, name: `Uji ${role} ${key} ${rnd}`, role, site_id: site, company: 'PT Uji Coba', job_title: job },
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.equal(r.json.item.company, 'PT Uji Coba');
      assert.equal(r.json.item.job_title, job);
      assert.ok(r.json.initial_password.length >= 8);
      assert.equal(r.json.item.must_change_password, true);
      const l = await api('POST', '/api/auth/login', { body: { nrp, password: r.json.initial_password } });
      assert.equal(l.status, 200);
      assert.equal(l.json.user.company, 'PT Uji Coba');
      const ch = await api('POST', '/api/auth/password', {
        token: l.json.token,
        body: { current_password: r.json.initial_password, new_password: 'PasswordBaru1' },
      });
      assert.equal(ch.status, 200);
      ctx.users.push({ id: r.json.item.id, role, site_id: site });
      const info = { token: ch.json.token, id: r.json.item.id, nrp };
      if (key === 'tek') tek = info;
      if (key === 'sup') sup = info;
      if (key === 'tek2') tek2 = info;
      if (key === 'sup2') sup2 = info;
    }
    const me = await api('GET', '/api/auth/me', { token: tek.token });
    assert.equal(me.json.user.must_change_password, false);
  });

  const today = () => meta.shift.shift_date;
  const unitOf = (i) => ctx.units[i]; // 0=A 1=B 2=C 3=D(Binungan) 4=E

  test('teknisi dan pengawas hanya melihat site-nya (meta, unit, dashboard)', async () => {
    const m = await api('GET', '/api/meta', { token: tek.token });
    assert.deepEqual(m.json.sites.map((s) => s.name), ['Suaran']);
    const u = await api('GET', '/api/units', { token: tek.token });
    assert.ok(u.json.items.length >= 5 && u.json.items.every((x) => x.site_id === suaran), 'hanya unit Suaran');
    const u2 = await api('GET', '/api/units', { token: tek2.token });
    assert.ok(u2.json.items.every((x) => x.site_id === binungan), 'hanya unit Binungan');
    assert.ok(u2.json.items.some((x) => x.id === unitOf(3).id));
    const d = await api('GET', '/api/dashboard', { token: sup.token });
    assert.equal(d.json.sites.length, 1);
    assert.equal(d.json.sites[0].name, 'Suaran');
    const dAdmin = await api('GET', '/api/dashboard', { token: admin });
    assert.equal(dAdmin.json.sites.length, 5, 'admin melihat semua site');
    // permintaan site lain diabaikan
    const h = await api('GET', `/api/p2h?site_id=${binungan}&limit=200`, { token: sup.token });
    assert.ok(h.json.items.every((x) => x.site_id === suaran));
  });

  test('teknisi mengirim P2H semua baik (dengan client_uuid) -> 201, kirim ulang -> 200 tanpa dobel', async () => {
    const uuid = crypto.randomUUID();
    const body = {
      client_uuid: uuid, unit_id: unitOf(0).id, shift_date: addDays(today(), -3), shift: 1,
      hm_start: 26630, hm_end: 26642.5, params: PARAMS_OK, answers: buildAnswers(meta), notes: 'Semua normal',
      signature_png: SIG_TEK, location: 'CPP Suaran',
    };
    const r = await api('POST', '/api/p2h', { token: tek.token, body });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.result, 'baik');
    ctx.forms.push(r.json.id);
    ctx.f1 = r.json.id;
    const again = await api('POST', '/api/p2h', { token: tek.token, body });
    assert.equal(again.status, 200);
    assert.equal(again.json.duplicate, true);
    assert.equal(again.json.id, r.json.id);
  });

  test('unit + tanggal + shift yang sama -> 409', async () => {
    const r = await api('POST', '/api/p2h', {
      token: tek.token,
      body: { unit_id: unitOf(0).id, shift_date: addDays(today(), -3), shift: 1, answers: buildAnswers(meta), signature_png: SIG_TEK },
    });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.error.details.existing_form_id, ctx.f1);
  });

  test('validasi: butir kurang, catatan kosong, FOTO WAJIB, foto rusak, tanggal masa depan, tanpa tanda tangan', async () => {
    const full = buildAnswers(meta);
    const base = { unit_id: unitOf(1).id, shift_date: today(), shift: meta.shift.shift, signature_png: SIG_TEK };
    let r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: full.slice(1) } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /belum diisi/);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: buildAnswers(meta, { 2: ['rusak', '', [PHOTO_A]] }) } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /catatan wajib/i);

    // rusak + catatan, tetapi TANPA foto -> tidak bisa dikirim
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes', []] }) } });
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'photo_required');
    assert.match(r.json.error.message, /foto wajib/i);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: buildAnswers(meta, { 13: ['perbaiki', 'Kabel longgar', []] }) } });
    assert.equal(r.status, 422, 'perlu diperbaiki juga wajib foto');
    assert.equal(r.json.error.code, 'photo_required');

    // foto yang bukan gambar / terlalu banyak
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes', ['data:image/jpeg;base64,AAAAAAAAAAAA']] }) } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /rusak atau bukan gambar/);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes', ['data:text/html;base64,PGI+']] }) } });
    assert.equal(r.status, 422);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes', [PHOTO_A, PHOTO_B, PHOTO_A, PHOTO_B]] }) } });
    assert.equal(r.status, 422, 'maksimal 3 foto per butir');

    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, shift_date: addDays(today(), 3), answers: full } });
    assert.equal(r.status, 422);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: full, signature_png: undefined } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /Tanda tangan/);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: full, hm_start: 100, hm_end: 50 } });
    assert.equal(r.status, 422);
    r = await api('POST', '/api/p2h', { token: tek.token, body: { ...base, answers: full, params: { temp: { load: 9999 } } } });
    assert.equal(r.status, 422);
  });

  test('yang tidak boleh mengisi P2H: pengawas, dan teknisi di luar site-nya', async () => {
    const body = { unit_id: unitOf(1).id, shift_date: today(), shift: meta.shift.shift, answers: buildAnswers(meta), signature_png: SIG_TEK };
    assert.equal((await api('POST', '/api/p2h', { token: sup.token, body })).status, 403, 'pengawas memverifikasi, tidak mengisi');
    const other = await api('POST', '/api/p2h', { token: tek2.token, body });
    assert.equal(other.status, 403, 'teknisi Binungan tidak boleh mengisi genset Suaran');
    assert.match(other.json.error.message, /bukan di site Anda/);
  });

  test('temuan AA + A (dengan foto) -> STOP OPERASI; foto tersimpan dan bisa dibuka', async () => {
    const u = unitOf(1);
    const r = await api('POST', '/api/p2h', {
      token: tek.token,
      body: {
        unit_id: u.id, shift_date: today(), shift: meta.shift.shift, hm_start: 5000, params: PARAMS_OK, signature_png: SIG_TEK,
        answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes dari seal depan', [PHOTO_A, PHOTO_B]], 13: ['perbaiki', 'Kabel grounding longgar', [PHOTO_B]] }),
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.result, 'stop_aa');
    assert.equal(r.json.n_aa, 1);
    assert.equal(r.json.n_a, 1);
    ctx.forms.push(r.json.id);
    ctx.f2 = r.json.id;
    ctx.u2 = u.id;

    const f = await api('GET', '/api/findings?status=open', { token: tek.token });
    assert.equal(f.status, 200);
    const mine = f.json.items.filter((x) => x.unit_id === u.id);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].danger_code, 'AA', 'AA harus di urutan pertama');
    assert.ok(mine.some((x) => x.due_at), 'temuan A punya batas waktu 12 jam');
    assert.equal(mine[0].photo_ids.length, 2, 'temuan AA membawa 2 foto');
    assert.equal(mine[1].photo_ids.length, 1);
    ctx.findingAA = mine[0].id;
    ctx.findingA = mine[1].id;

    const d = await api('GET', `/api/p2h/${ctx.f2}`, { token: tek.token });
    const bad = d.json.sections.flatMap((s) => s.items).filter((i) => i.condition !== 'baik');
    assert.equal(bad.length, 2);
    assert.ok(bad.every((i) => i.photos.length >= 1));
    const baik = d.json.sections.flatMap((s) => s.items).find((i) => i.condition === 'baik');
    assert.equal(baik.photos.length, 0);
    ctx.photoId = bad.find((i) => i.danger_code === 'AA').photos[0].id;
    ctx.photoIds = bad.flatMap((i) => i.photos.map((p) => p.id));

    const img = await api('GET', `/api/photos/${ctx.photoId}`, { token: tek.token, raw: true });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    const buf = Buffer.from(await img.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(buf.equals(fs.readFileSync(path.join(here, 'fixtures', 'foto-a.jpg'))), 'foto tersimpan utuh');
    assert.equal((await api('GET', `/api/photos/${ctx.photoId}`, { token: tek2.token, raw: true })).status, 404, 'site lain tidak boleh melihat');
    assert.equal((await api('GET', `/api/photos/${ctx.photoId}`, { token: sup.token, raw: true })).status, 200);
    assert.equal((await api('GET', `/api/photos/${ctx.photoId}`, { token: admin, raw: true })).status, 200);
  });

  test('detail P2H lengkap + izin sesuai peran + status verifikasi', async () => {
    const r = await api('GET', `/api/p2h/${ctx.f2}`, { token: tek.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.sections.length, 4);
    assert.equal(r.json.sections.flatMap((s) => s.items).length, 30);
    assert.equal(r.json.params.length, 6);
    assert.equal(r.json.params[5].load, 28.5);
    assert.equal(r.json.permissions.can_edit, true);
    assert.equal(r.json.permissions.can_sign, false);
    assert.equal(r.json.form.inspector_company, 'PT Uji Coba');
    assert.equal(r.json.form.sup_signed_at, null, 'belum diverifikasi');
    const s = await api('GET', `/api/p2h/${ctx.f2}`, { token: sup.token });
    assert.equal(s.json.permissions.can_sign, true);
    assert.equal(s.json.permissions.can_edit, false);
    // pengawas / teknisi site lain tidak bisa membuka
    assert.equal((await api('GET', `/api/p2h/${ctx.f2}`, { token: sup2.token })).status, 404);
    assert.equal((await api('GET', `/api/p2h/${ctx.f2}`, { token: tek2.token })).status, 404);
  });

  test('site lain tidak melihat / mengubah: daftar, temuan, tindak lanjut, verifikasi, unduhan, rekap', async () => {
    const list = await api('GET', '/api/p2h?limit=200', { token: tek2.token });
    assert.ok(list.json.items.every((x) => x.site_id === binungan));
    assert.ok(!list.json.items.some((x) => x.id === ctx.f2));
    const fnd = await api('GET', '/api/findings?status=open', { token: sup2.token });
    assert.ok(fnd.json.items.every((x) => x.site_id === binungan));
    assert.ok(!fnd.json.items.some((x) => x.id === ctx.findingAA));
    assert.equal((await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: sup2.token, body: { status: 'in_progress' } })).status, 404);
    assert.equal((await api('POST', `/api/p2h/${ctx.f2}/verify`, { token: sup2.token, body: { signature_png: SIG_SUP } })).status, 404);
    assert.equal((await api('PUT', `/api/p2h/${ctx.f2}`, { token: tek2.token, body: { params: {}, answers: buildAnswers(meta) } })).status, 404);
    // unduhan P2H site lain: tiket boleh dibuat, tetapi berkas ditolak
    const t = await api('POST', '/api/exports/ticket', { token: sup2.token, body: { kind: 'p2h', format: 'pdf', id: ctx.f2 } });
    const dl = await api('GET', t.json.path, { raw: true });
    assert.equal(dl.status, 404);
    // rekap: selalu terkunci ke site sendiri
    const pv = await api('GET', `/api/exports/rekap-preview?period=year&date=${today()}&unit_id=${unitOf(1).id}`, { token: sup2.token });
    assert.equal(pv.status, 200);
    assert.equal(pv.json.sum.total, 0, 'Binungan tidak melihat P2H unit Suaran');
    // pemberitahuan: site lain tidak ikut menerima
    const n = await api('GET', '/api/notifications', { token: sup2.token });
    assert.ok(n.json.items.every((x) => x.site_id === null || x.site_id === binungan));
    const n2 = await api('GET', '/api/notifications', { token: sup.token });
    assert.ok(n2.json.items.some((x) => x.kind === 'p2h_stop' && x.site_id === suaran), 'pengawas Suaran menerima kabar STOP di Suaran');
  });

  test('ubah P2H: foto lama dipertahankan / diganti, foto tetap wajib, jadi Baik menghapus foto, banyak foto > 1 MB', async () => {
    const u = unitOf(4);
    const created = await api('POST', '/api/p2h', {
      token: tek.token,
      body: {
        unit_id: u.id, shift_date: addDays(today(), -5), shift: 1, params: PARAMS_OK, signature_png: SIG_TEK,
        answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes', [PHOTO_A]], 13: ['perbaiki', 'Kabel longgar', [PHOTO_B]] }),
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    ctx.forms.push(created.json.id);
    const id = created.json.id;
    const read = async () => (await api('GET', `/api/p2h/${id}`, { token: tek.token })).json.sections.flatMap((s) => s.items);
    let items = await read();
    const it2 = items.find((i) => i.item_no === 2 && i.danger_code === 'AA') ?? items.find((i) => i.condition === 'rusak');
    const it13 = items.find((i) => i.condition === 'perbaiki');
    const old2 = it2.photos[0].id;
    const old13 = it13.photos[0].id;
    const answersOf = (over) =>
      items.map((i) => {
        const o = over[i.item_id];
        return o ?? { item_id: i.item_id, condition: i.condition, note: i.note, ...(i.condition !== 'baik' ? { keep_photo_ids: i.photos.map((p) => p.id) } : {}) };
      });

    // 1) dipertahankan apa adanya
    let r = await api('PUT', `/api/p2h/${id}`, { token: tek.token, body: { params: PARAMS_OK, hm_end: 5010, answers: answersOf({}) } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    items = await read();
    assert.deepEqual(items.find((i) => i.item_id === it2.item_id).photos.map((p) => p.id), [old2]);

    // 2) foto dibuang semua tanpa gantinya -> ditolak
    r = await api('PUT', `/api/p2h/${id}`, { token: tek.token, body: { params: PARAMS_OK, answers: answersOf({ [it2.item_id]: { item_id: it2.item_id, condition: 'rusak', note: 'Oli rembes', keep_photo_ids: [] } }) } });
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, 'photo_required');

    // 3) diganti foto baru; butir lain jadi Baik (foto ikut hilang)
    r = await api('PUT', `/api/p2h/${id}`, {
      token: tek.token,
      body: {
        params: PARAMS_OK,
        answers: answersOf({
          [it2.item_id]: { item_id: it2.item_id, condition: 'rusak', note: 'Oli rembes', photos: [PHOTO_B], keep_photo_ids: [] },
          [it13.item_id]: { item_id: it13.item_id, condition: 'baik', note: null },
        }),
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    items = await read();
    const now2 = items.find((i) => i.item_id === it2.item_id);
    assert.equal(now2.photos.length, 1);
    assert.notEqual(now2.photos[0].id, old2, 'foto lama diganti');
    assert.equal((await api('GET', `/api/photos/${old2}`, { token: tek.token, raw: true })).status, 404);
    assert.equal(items.find((i) => i.item_id === it13.item_id).photos.length, 0);
    assert.equal((await api('GET', `/api/photos/${old13}`, { token: tek.token, raw: true })).status, 404, 'foto butir yang jadi Baik dihapus');

    // 4) foto lama milik butir lain tidak bisa "dipinjam"
    r = await api('PUT', `/api/p2h/${id}`, {
      token: tek.token,
      body: { params: PARAMS_OK, answers: answersOf({ [it13.item_id]: { item_id: it13.item_id, condition: 'rusak', note: 'Rusak lagi', keep_photo_ids: [now2.photos[0].id] } }) },
    });
    assert.equal(r.status, 422, 'foto milik butir lain tidak dihitung');

    // 5) banyak foto: lebih dari 1 MB dalam satu kiriman tetap diterima
    const big = await api('POST', '/api/p2h', {
      token: tek.token,
      body: {
        unit_id: u.id, shift_date: addDays(today(), -6), shift: 2, params: PARAMS_OK, signature_png: SIG_TEK,
        answers: buildAnswers(meta, Object.fromEntries([1, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, ['perbaiki', `Catatan ${n}`, [PHOTO_A, PHOTO_B, PHOTO_A]]]))),
      },
    });
    assert.equal(big.status, 201, JSON.stringify(big.json).slice(0, 300));
    ctx.forms.push(big.json.id);
    const bigDetail = await api('GET', `/api/p2h/${big.json.id}`, { token: tek.token });
    const nph = bigDetail.json.sections.flatMap((s) => s.items).reduce((n, i) => n + i.photos.length, 0);
    assert.equal(nph, 24);
    const list = await api('GET', `/api/p2h?unit_id=${u.id}`, { token: tek.token });
    assert.equal(list.json.items.find((x) => x.id === big.json.id).n_photos, 24);
  });

  test('teknisi mengisi HM akhir lewat ubah (edit) dan temuan baru memicu pemberitahuan', async () => {
    const d = await api('GET', `/api/p2h/${ctx.f1}`, { token: tek.token });
    const answers = d.json.sections.flatMap((s) => s.items).map((i) => ({ item_id: i.item_id, condition: i.condition, note: i.note }));
    answers[5] = { item_id: answers[5].item_id, condition: 'perbaiki', note: 'Sirip radiator penyok', photos: [PHOTO_A] };
    const r = await api('PUT', `/api/p2h/${ctx.f1}`, {
      token: tek.token,
      body: { hm_start: 26630, hm_end: 26655, params: PARAMS_OK, answers, notes: 'Diubah: HM akhir diisi', use_saved_signature: false },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result, 'temuan_a');
    const back = answers.map((a, i) => (i === 5 ? { item_id: a.item_id, condition: 'baik', note: null } : a));
    const r2 = await api('PUT', `/api/p2h/${ctx.f1}`, { token: tek.token, body: { hm_start: 26630, hm_end: 26655, params: PARAMS_OK, answers: back } });
    assert.equal(r2.json.result, 'baik');
  });

  test('verifikasi pengawas: baru Terverifikasi setelah pengawas (site yang sama) menandatangani', async () => {
    assert.equal((await api('POST', `/api/p2h/${ctx.f1}/verify`, { token: tek.token, body: {} })).status, 403, 'teknisi tidak boleh');
    assert.equal((await api('POST', `/api/p2h/${ctx.f1}/verify`, { token: sup2.token, body: { signature_png: SIG_SUP } })).status, 404, 'pengawas site lain tidak boleh');
    const nosig = await api('POST', `/api/p2h/${ctx.f1}/verify`, { token: sup.token, body: {} });
    assert.equal(nosig.status, 422, 'belum punya tanda tangan tersimpan');
    const before = await api('GET', `/api/p2h?unit_id=${unitOf(0).id}`, { token: sup.token });
    assert.equal(before.json.items[0].verified, false);

    const ok = await api('POST', `/api/p2h/${ctx.f1}/verify`, { token: sup.token, body: { signature_png: SIG_SUP, save_signature: true } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await api('POST', `/api/p2h/${ctx.f1}/verify`, { token: sup.token, body: {} })).status, 409);
    const d = await api('GET', `/api/p2h/${ctx.f1}`, { token: tek.token });
    assert.equal(d.json.form.sup_name.startsWith('Uji pengawas'), true);
    assert.equal(d.json.form.sup_company, 'PT Uji Coba');
    assert.ok(d.json.form.sup_signed_at);
    assert.equal(d.json.permissions.can_edit, false, 'setelah terverifikasi teknisi tidak bisa mengubah');
    const upd = await api('PUT', `/api/p2h/${ctx.f1}`, { token: tek.token, body: { params: {}, answers: buildAnswers(meta) } });
    assert.equal(upd.status, 403);
    assert.match(upd.json.error.message, /terverifikasi/i);
    const me = await api('GET', '/api/auth/me', { token: sup.token });
    assert.equal(me.json.user.has_signature, true);
    const after1 = await api('GET', `/api/p2h?unit_id=${unitOf(0).id}`, { token: sup.token });
    assert.equal(after1.json.items[0].verified, true);
    assert.equal(after1.json.items[0].signed, true);
  });

  test('daftar P2H dengan penyaring', async () => {
    const all = await api('GET', '/api/p2h?limit=5', { token: sup.token });
    assert.equal(all.status, 200);
    assert.ok(all.json.total >= 2);
    const stop = await api('GET', '/api/p2h?result=stop_aa', { token: sup.token });
    assert.ok(stop.json.items.every((x) => x.result === 'stop_aa'));
    const byUnit = await api('GET', `/api/p2h?unit_id=${ctx.u2}`, { token: sup.token });
    assert.ok(byUnit.json.items.every((x) => x.unit_id === ctx.u2));
    const uns = await api('GET', '/api/p2h?unverified=1', { token: sup.token });
    assert.ok(uns.json.items.every((x) => !x.verified));
    const uns2 = await api('GET', '/api/p2h?unsigned=1', { token: sup.token });
    assert.ok(uns2.json.items.every((x) => !x.signed), 'nama lama masih dikenali');
  });

  test('dashboard: angka, site, tren, temuan teratas', async () => {
    const r = await api('GET', '/api/dashboard', { token: admin });
    assert.equal(r.status, 200);
    const d = r.json;
    assert.equal(d.sites.length, 5);
    assert.ok(d.kpi.required >= 20);
    assert.ok(d.kpi.stop >= 1, 'unit dengan temuan AA terbuka dihitung STOP');
    assert.equal(d.trend.length, 14);
    assert.ok(d.open_findings.total >= 2);
    assert.ok(d.top_items.length >= 1);
    const u = d.sites.flatMap((s) => s.units).find((x) => x.id === ctx.u2);
    assert.equal(u.state, 'stop');
    const scoped = await api('GET', '/api/dashboard', { token: sup.token });
    assert.ok(scoped.json.open_findings.items.every((x) => x.site_id === suaran));
  });

  test('tindak lanjut: sedang diperbaiki lalu selesai (catatan wajib) -> unit tidak STOP lagi', async () => {
    let r = await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: tek.token, body: { status: 'in_progress' } });
    assert.equal(r.status, 200);
    let f = await api('GET', '/api/findings?status=open', { token: tek.token });
    assert.equal(f.json.items.find((x) => x.id === ctx.findingAA)?.status, 'in_progress');
    r = await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: tek.token, body: { status: 'closed' } });
    assert.equal(r.status, 422, 'menutup tanpa catatan ditolak');
    r = await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: tek.token, body: { status: 'closed', note: 'Seal depan diganti, oli ditambah' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    r = await api('PATCH', `/api/findings/${ctx.findingA}`, { token: sup.token, body: { status: 'closed', note: 'Kabel grounding dikencangkan' } });
    assert.equal(r.status, 200);
    f = await api('GET', '/api/findings?status=open', { token: tek.token });
    assert.equal(f.json.items.filter((x) => x.unit_id === ctx.u2).length, 0);
    const closed = await api('GET', '/api/findings?status=closed', { token: tek.token });
    assert.ok(closed.json.items.some((x) => x.unit_id === ctx.u2 && x.fix_note));
    const dash = await api('GET', '/api/dashboard', { token: sup.token });
    const u = dash.json.sites.flatMap((s) => s.units).find((x) => x.id === ctx.u2);
    assert.equal(u.state, 'ok');
    assert.equal((await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: tek.token, body: { status: 'open' } })).status, 409);
  });

  test('temuan yang sama di dua shift digabung jadi satu baris (times = 2, foto dari dua laporan)', async () => {
    const u = unitOf(2);
    const mk = async (date, shift) =>
      api('POST', '/api/p2h', {
        token: tek.token,
        body: { unit_id: u.id, shift_date: date, shift, signature_png: SIG_TEK, answers: buildAnswers(meta, { 9: ['rusak', 'Mufler bocor'] }) },
      });
    const a = await mk(addDays(today(), -2), 1);
    const b = await mk(addDays(today(), -2), 2);
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(b.status, 201);
    ctx.forms.push(a.json.id, b.json.id);
    ctx.uC = u.id;
    const f = await api('GET', `/api/findings?status=open&unit_id=${u.id}`, { token: tek.token });
    assert.equal(f.json.items.length, 1);
    assert.equal(f.json.items[0].times, 2);
    assert.equal(f.json.items[0].photo_ids.length, 2, 'foto dari kedua laporan ikut tampil');
    // tutup sekali -> dua laporan ikut selesai
    const r = await api('PATCH', `/api/findings/${f.json.items[0].id}`, { token: tek.token, body: { status: 'closed', note: 'Mufler diganti' } });
    assert.equal(r.json.changed, 2);
  });

  const zipHas = async (buf, re) => {
    const z = await JSZip.loadAsync(buf);
    const xml = await z.file('word/document.xml').async('string');
    return { z, xml, found: re.test(xml.replace(/<[^>]+>/g, '')) };
  };
  const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

  test('unduhan: tiket -> PDF / Word / Excel untuk satu P2H (memuat foto dan status verifikasi)', async () => {
    const want = { pdf: [0x25, 0x50, 0x44, 0x46], docx: [0x50, 0x4b, 0x03, 0x04], xlsx: [0x50, 0x4b, 0x03, 0x04] };
    const get = async (format, id, token) => {
      const t = await api('POST', '/api/exports/ticket', { token, body: { kind: 'p2h', format, id } });
      assert.equal(t.status, 200, JSON.stringify(t.json));
      const res = await api('GET', t.json.path, { raw: true });
      assert.equal(res.status, 200, `${format}: ${await res.clone().text()}`);
      assert.match(res.headers.get('content-disposition'), /attachment; filename=/);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.deepEqual([...buf.subarray(0, 4)], want[format], `${format} bukan berkas yang valid`);
      assert.ok(buf.length > 4000, `${format} terlalu kecil (${buf.length})`);
      return buf;
    };
    fs.mkdirSync(path.join(here, 'out'), { recursive: true });
    // P2H dengan foto (belum terverifikasi)
    const pdf = await get('pdf', ctx.f2, sup.token);
    assert.equal(pdfPages(pdf), 2, 'PDF: 1 halaman form + 1 halaman lampiran foto');
    const docx = await get('docx', ctx.f2, sup.token);
    const dz = await zipHas(docx, /LAMPIRAN FOTO TEMUAN/);
    assert.ok(dz.found, 'Word memuat lampiran foto');
    assert.ok(Object.keys(dz.z.files).filter((n) => n.startsWith('word/media/')).length >= 3, 'foto masuk ke Word');
    assert.match(dz.xml.replace(/<[^>]+>/g, ''), /MENUNGGU VERIFIKASI/);
    const xlsx = await get('xlsx', ctx.f2, sup.token);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx);
    assert.ok(wb.getWorksheet('Foto Temuan'), 'Excel punya lembar Foto Temuan');
    assert.equal(wb.getWorksheet('Foto Temuan').getImages().length, 3);
    fs.writeFileSync(path.join(here, 'out', 'contoh-p2h.pdf'), pdf);
    fs.writeFileSync(path.join(here, 'out', 'contoh-p2h.docx'), docx);
    fs.writeFileSync(path.join(here, 'out', 'contoh-p2h.xlsx'), xlsx);
    // P2H tanpa foto dan sudah terverifikasi
    const pdf1 = await get('pdf', ctx.f1, tek.token);
    assert.equal(pdfPages(pdf1), 1, 'tanpa foto: tetap 1 halaman');
    const d1 = await zipHas(await get('docx', ctx.f1, tek.token), /TERVERIFIKASI/);
    assert.ok(d1.found, 'Word memuat status TERVERIFIKASI');
    assert.ok(!/LAMPIRAN FOTO/.test(d1.xml.replace(/<[^>]+>/g, '')));
    fs.writeFileSync(path.join(here, 'out', 'contoh-p2h-terverifikasi.pdf'), pdf1);
    const bad = await api('GET', '/api/exports/file?t=ngawur', { raw: true });
    assert.equal(bad.status, 401);
  });

  test('rekap mingguan / bulanan / tahunan: ringkasan di layar dan unduhan PDF / Word / Excel', async () => {
    const uid = ctx.u2;
    const preview = (period, extra = '') => api('GET', `/api/exports/rekap-preview?period=${period}&date=${today()}&unit_id=${uid}${extra}`, { token: sup.token });
    const wk = await preview('week');
    const mo = await preview('month');
    const yr = await preview('year');
    for (const r of [wk, mo, yr]) assert.equal(r.status, 200, JSON.stringify(r.json));
    // rentang tanggal
    assert.equal(wk.json.period, 'week');
    assert.equal(new Date(`${wk.json.from}T00:00:00Z`).getUTCDay(), 1, 'minggu mulai Senin');
    assert.equal(new Date(`${wk.json.to}T00:00:00Z`).getUTCDay(), 0, 'minggu berakhir Minggu');
    assert.equal(wk.json.buckets.length, 7);
    assert.equal(wk.json.bucket_unit, 'Hari');
    assert.equal(mo.json.from.slice(8), '01');
    assert.equal(mo.json.bucket_unit, 'Minggu');
    assert.ok(mo.json.buckets.length >= 4 && mo.json.buckets.length <= 6);
    assert.equal(yr.json.from, `${today().slice(0, 4)}-01-01`);
    assert.equal(yr.json.to, `${today().slice(0, 4)}-12-31`);
    assert.equal(yr.json.buckets.length, 12);
    assert.equal(yr.json.bucket_unit, 'Bulan');
    // isi: unit B punya 1 P2H (STOP) hari ini; tahunan memuatnya
    assert.equal(yr.json.sum.total, 1);
    assert.equal(yr.json.sum.stop, 1);
    assert.equal(yr.json.sum.unverified, 1);
    assert.equal(yr.json.findings.total, 2);
    assert.equal(yr.json.findings.closed, 2);
    assert.equal(yr.json.sites.length, 1);
    assert.equal(yr.json.buckets.reduce((n, b) => n + b.total, 0), yr.json.sum.total, 'rincian cocok dengan total');
    // periode di masa lalu yang kosong
    const old = await api('GET', `/api/exports/rekap-preview?period=week&date=2020-03-04&unit_id=${uid}`, { token: sup.token });
    assert.equal(old.json.sum.total, 0);
    assert.equal(old.json.from, '2020-03-02');
    // unduhan tiap jenis x tiap format
    fs.mkdirSync(path.join(here, 'out'), { recursive: true });
    const want = { pdf: [0x25, 0x50, 0x44, 0x46], docx: [0x50, 0x4b, 0x03, 0x04], xlsx: [0x50, 0x4b, 0x03, 0x04] };
    for (const period of ['week', 'month', 'year']) {
      for (const format of ['pdf', 'docx', 'xlsx']) {
        const t = await api('POST', '/api/exports/ticket', { token: sup.token, body: { kind: 'rekap', format, filters: { period, date: today() } } });
        const res = await api('GET', t.json.path, { raw: true });
        assert.equal(res.status, 200, `${period}/${format}: ${await res.clone().text()}`);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.deepEqual([...buf.subarray(0, 4)], want[format]);
        assert.ok(buf.length > 3000, `${period}/${format} terlalu kecil`);
        assert.match(res.headers.get('content-disposition'), new RegExp(period === 'week' ? 'Mingguan' : period === 'month' ? 'Bulanan' : 'Tahunan'));
        fs.writeFileSync(path.join(here, 'out', `contoh-rekap-${period}.${format}`), buf);
        if (format === 'xlsx' && period === 'month') {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buf);
          assert.deepEqual(wb.worksheets.map((w) => w.name), ['Ringkasan', 'Rekap P2H', 'Temuan']);
        }
      }
    }
    // rentang manual (lama) tetap bisa
    const t = await api('POST', '/api/exports/ticket', { token: sup.token, body: { kind: 'rekap', format: 'xlsx', filters: { from: addDays(today(), -10), to: today() } } });
    assert.equal((await api('GET', t.json.path, { raw: true })).status, 200);
  });

  test('pemberitahuan di dalam aplikasi + tandai sudah dibaca', async () => {
    const r = await api('GET', '/api/notifications', { token: sup.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.items.length >= 3);
    assert.ok(r.json.items.some((n) => n.kind === 'p2h_stop'));
    assert.ok(r.json.unread >= 1);
    await api('POST', '/api/notifications/seen', { token: sup.token, body: {} });
    const after2 = await api('GET', '/api/notifications', { token: sup.token });
    assert.equal(after2.json.unread, 0);
    // pilihan "hanya temuan" menyembunyikan P2H biasa
    await api('PUT', '/api/auth/prefs', { token: sup.token, body: { notif_mode: 'findings', notif_site_ids: null } });
    const only = await api('GET', '/api/notifications', { token: sup.token });
    assert.ok(only.json.items.every((n) => n.kind !== 'p2h_ok'));
    await api('PUT', '/api/auth/prefs', { token: sup.token, body: { notif_mode: 'all', notif_site_ids: null } });
  });

  test('push: kunci publik, daftar, cabut', async () => {
    const k = await api('GET', '/api/notifications/push/public-key');
    assert.equal(k.status, 200);
    assert.equal(k.json.enabled, true);
    assert.ok(k.json.public_key.length > 60);
    const sub = {
      endpoint: `https://push.example.invalid/send/${rnd}`,
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
    };
    assert.equal((await api('POST', '/api/notifications/push/subscribe', { token: tek.token, body: sub })).status, 200);
    const users = await api('GET', '/api/users', { token: admin });
    assert.equal(users.json.items.find((u) => u.id === tek.id).devices, 1);
    assert.equal((await api('POST', '/api/notifications/push/unsubscribe', { token: tek.token, body: { endpoint: sub.endpoint } })).status, 200);
  });

  test('admin: pengaturan, daftar cek, impor akun (No SID, Nama, Perusahaan, Jabatan, Peran, Site), catatan aktivitas', async () => {
    const s = await api('GET', '/api/admin/settings', { token: admin });
    assert.equal(s.json.settings.shift1_start, '06:00');
    const bad = await api('PUT', '/api/admin/settings', { token: admin, body: { ...s.json.settings, shift1_start: '19:00' } });
    assert.equal(bad.status, 400);
    assert.equal((await api('GET', '/api/admin/settings', { token: tek.token })).status, 403);
    assert.equal((await api('GET', '/api/admin/settings', { token: sup.token })).status, 403);
    assert.equal((await api('GET', '/api/users', { token: sup.token })).status, 403, 'pengawas tidak boleh mengelola akun');
    assert.equal((await api('POST', '/api/users', { token: sup.token, body: { nrp: 'zzz', name: 'Zzz', role: 'teknisi', site_id: suaran } })).status, 403);

    const cl = await api('GET', '/api/admin/checklist', { token: admin });
    assert.equal(cl.json.sections.length, 4);
    const add = await api('POST', '/api/admin/checklist/items', {
      token: admin, body: { section_code: 'housekeeping', text: `Butir uji ${rnd}`, danger_code: 'A' },
    });
    assert.equal(add.status, 201);
    const mv = await api('POST', `/api/admin/checklist/items/${add.json.id}/move`, { token: admin, body: { dir: 'up' } });
    assert.equal(mv.status, 200);
    const off = await api('PUT', `/api/admin/checklist/items/${add.json.id}`, {
      token: admin, body: { section_code: 'housekeeping', text: `Butir uji ${rnd}`, danger_code: 'A', is_active: false },
    });
    assert.equal(off.status, 200);
    const meta2 = await api('GET', '/api/meta', { token: admin });
    assert.equal(meta2.json.checklist.flatMap((x) => x.items).length, 30, 'butir nonaktif tidak muncul di form');

    const imp = await api('POST', '/api/users/import', {
      token: admin,
      body: { users: [
        { nrp: `imp1${rnd}`, name: 'Impor Satu', company: 'PT Mutiara Tanjung Lestari', job_title: 'Electrician', role: 'teknisi', site: 'Suaran' },
        { nrp: `imp2${rnd}`, name: 'Impor Dua', company: 'PT Berau Coal', job_title: 'Foreman', role: 'foreman', site: 'lati' },
        { nrp: `imp1${rnd}`, name: 'Dobel', role: 'teknisi', site: 'Suaran' },
        { nrp: `imp3${rnd}`, name: 'Salah Site', role: 'teknisi', site: 'Mars' },
        { nrp: `imp4${rnd}`, name: 'Tanpa Site', role: 'teknisi' },
        { nrp: `imp5${rnd}`, name: 'Peran Lama', role: 'manajemen', site: 'Lati' },
      ] },
    });
    assert.equal(imp.status, 200, JSON.stringify(imp.json));
    assert.equal(imp.json.created, 2);
    assert.equal(imp.json.failed, 4);
    assert.match(imp.json.results.find((x) => x.row === 5).message, /Site wajib/);
    assert.match(imp.json.results.find((x) => x.row === 6).message, /tidak dikenal/);
    const all = await api('GET', '/api/users', { token: admin });
    const made = all.json.items.filter((x) => x.nrp.startsWith('imp') && x.nrp.endsWith(rnd));
    assert.equal(made.length, 2);
    assert.equal(made.find((x) => x.nrp.startsWith('imp2')).role, 'pengawas');
    assert.equal(made.find((x) => x.nrp.startsWith('imp1')).company, 'PT Mutiara Tanjung Lestari');
    for (const u of made) ctx.users.push({ id: u.id, role: u.role, site_id: u.site_id });

    const au = await api('GET', '/api/admin/audit', { token: admin });
    assert.ok(au.json.items.length > 5);
  });

  test('admin tidak bisa menonaktifkan dirinya; pindah site / reset password mematikan sesi lama', async () => {
    const me = await api('GET', '/api/auth/me', { token: admin });
    const self = await api('PUT', `/api/users/${me.json.user.id}`, {
      token: admin, body: { name: 'Administrator', role: 'admin', is_active: false },
    });
    assert.equal(self.status, 400);
    const rs = await api('POST', `/api/users/${tek2.id}/reset-password`, { token: admin });
    assert.equal(rs.status, 200);
    assert.equal((await api('GET', '/api/auth/me', { token: tek2.token })).status, 401, 'sesi lama harus mati');
    // dipindah site -> sesi lama mati (supaya data yang tampil ikut berganti)
    const mv = await api('PUT', `/api/users/${sup2.id}`, { token: admin, body: { name: 'Pengawas Pindah', role: 'pengawas', site_id: suaran, company: 'PT Uji Coba', is_active: true } });
    assert.equal(mv.status, 200, JSON.stringify(mv.json));
    assert.equal((await api('GET', '/api/auth/me', { token: sup2.token })).status, 401);
    ctx.users.find((u) => u.id === sup2.id).site_id = suaran;
  });

  after(async () => {
    // bersihkan data uji
    if (!admin) return;
    for (const id of ctx.forms) await api('DELETE', `/api/p2h/${id}`, { token: admin });
    for (const u of ctx.units) await api('DELETE', `/api/units/${u.id}`, { token: admin });
    for (const u of ctx.users) {
      await api('PUT', `/api/users/${u.id}`, { token: admin, body: { name: 'Uji (dinonaktifkan)', role: u.role, site_id: u.site_id, is_active: false } });
    }
  });
});
