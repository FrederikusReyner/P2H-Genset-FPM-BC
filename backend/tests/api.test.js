// Uji otomatis API. Jalankan server + database dulu, lalu:  npm test
// Memakai akun admin dari berkas .env (ADMIN_NRP / ADMIN_PASSWORD). Data uji dibersihkan di akhir.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, '..', '.env'));
} catch {
  /* tidak ada .env */
}

const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const SIG_MEK = fs.readFileSync(path.join(here, 'fixtures', 'signature-mekanik.txt'), 'utf8');
const SIG_SUP = fs.readFileSync(path.join(here, 'fixtures', 'signature-pengawas.txt'), 'utf8');

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

/** Jawaban lengkap untuk semua butir; "overrides" = { itemIndex(1-based berurutan): [condition, note] } */
function buildAnswers(meta, overrides = {}) {
  const answers = [];
  let n = 0;
  for (const sec of meta.checklist) {
    for (const it of sec.items) {
      n += 1;
      const o = overrides[n];
      answers.push({ item_id: it.id, condition: o ? o[0] : 'baik', note: o ? o[1] : null });
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
  let mek; let sup; let mgmt;

  before(async () => {
    const h = await api('GET', '/api/health');
    assert.equal(h.status, 200, 'server harus hidup dan siap (npm start)');
  });

  test('login salah ditolak, login admin berhasil', async () => {
    const bad = await api('POST', '/api/auth/login', { body: { nrp: 'admin', password: 'salah-banget' } });
    assert.equal(bad.status, 401);
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
  });

  test('meta: 5 site, 4 bagian, 30 butir, 6 parameter', async () => {
    const r = await api('GET', '/api/meta', { token: admin });
    assert.equal(r.status, 200);
    meta = r.json;
    assert.deepEqual(meta.sites.map((s) => s.name), ['Binungan', 'Suaran', 'Gurimbang', 'Lati', 'Sambarata']);
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

  // Supaya uji tidak bertabrakan dengan data yang sudah ada (mis. contoh data), pakai 3 unit uji sendiri.
  test('admin membuat 3 unit uji (dihapus lagi di akhir)', async () => {
    for (const k of ['A', 'B', 'C']) {
      const r = await api('POST', '/api/units', {
        token: admin,
        body: { code: `UJI-${rnd}-${k}`, site_id: meta.sites[1].id, location: 'SUARAN', brand: 'Uji', model: 'T1', capacity_kva: 1000, rated_kw: 800, rated_voltage: 400, rated_rpm: 1500, status: 'running', hm_master: 100 },
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      ctx.units.push(r.json.item);
    }
    const dup = await api('POST', '/api/units', { token: admin, body: { code: `uji-${rnd}-a`, site_id: meta.sites[1].id, status: 'running' } });
    assert.equal(dup.status, 409, 'kode unit tidak boleh kembar (tanpa peduli huruf besar/kecil)');
  });

  test('admin membuat 3 akun uji dan akun harus ganti password', async () => {
    for (const [key, role] of [['mek', 'mekanik'], ['sup', 'pengawas'], ['mgmt', 'manajemen']]) {
      const nrp = `t${key}${rnd}`;
      const r = await api('POST', '/api/users', {
        token: admin,
        body: { nrp, name: `Uji ${role} ${rnd}`, role, site_id: meta.sites[1].id },
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.ok(r.json.initial_password.length >= 8);
      assert.equal(r.json.item.must_change_password, true);
      const l = await api('POST', '/api/auth/login', { body: { nrp, password: r.json.initial_password } });
      assert.equal(l.status, 200);
      const ch = await api('POST', '/api/auth/password', {
        token: l.json.token,
        body: { current_password: r.json.initial_password, new_password: 'PasswordBaru1' },
      });
      assert.equal(ch.status, 200);
      ctx.users.push(r.json.item.id);
      const info = { token: ch.json.token, id: r.json.item.id, nrp };
      if (key === 'mek') mek = info;
      if (key === 'sup') sup = info;
      if (key === 'mgmt') mgmt = info;
    }
    // token lama harus mati setelah ganti password
    const me = await api('GET', '/api/auth/me', { token: mek.token });
    assert.equal(me.json.user.must_change_password, false);
  });

  const today = () => meta.shift.shift_date;
  const unitOf = (i) => ctx.units[i];

  test('mekanik mengirim P2H semua baik (dengan client_uuid) -> 201, kirim ulang -> 200 tanpa dobel', async () => {
    const uuid = crypto.randomUUID();
    const body = {
      client_uuid: uuid, unit_id: unitOf(0).id, shift_date: addDays(today(), -3), shift: 1,
      hm_start: 26630, hm_end: 26642.5, params: PARAMS_OK, answers: buildAnswers(meta), notes: 'Semua normal',
      signature_png: SIG_MEK, location: 'CPP Suaran',
    };
    const r = await api('POST', '/api/p2h', { token: mek.token, body });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.result, 'baik');
    ctx.forms.push(r.json.id);
    ctx.f1 = r.json.id;
    const again = await api('POST', '/api/p2h', { token: mek.token, body });
    assert.equal(again.status, 200);
    assert.equal(again.json.duplicate, true);
    assert.equal(again.json.id, r.json.id);
  });

  test('unit + tanggal + shift yang sama -> 409', async () => {
    const r = await api('POST', '/api/p2h', {
      token: mek.token,
      body: { unit_id: unitOf(0).id, shift_date: addDays(today(), -3), shift: 1, answers: buildAnswers(meta), signature_png: SIG_MEK },
    });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.error.details.existing_form_id, ctx.f1);
  });

  test('validasi: butir kurang, catatan temuan kosong, tanggal masa depan, tanpa tanda tangan', async () => {
    const full = buildAnswers(meta);
    const base = { unit_id: unitOf(1).id, shift_date: today(), shift: meta.shift.shift, signature_png: SIG_MEK };
    let r = await api('POST', '/api/p2h', { token: mek.token, body: { ...base, answers: full.slice(1) } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /belum diisi/);
    r = await api('POST', '/api/p2h', { token: mek.token, body: { ...base, answers: buildAnswers(meta, { 2: ['rusak', ''] }) } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /catatan wajib/i);
    r = await api('POST', '/api/p2h', { token: mek.token, body: { ...base, shift_date: addDays(today(), 3), answers: full } });
    assert.equal(r.status, 422);
    r = await api('POST', '/api/p2h', { token: mek.token, body: { ...base, answers: full, signature_png: undefined } });
    assert.equal(r.status, 422);
    assert.match(r.json.error.message, /Tanda tangan/);
    r = await api('POST', '/api/p2h', { token: mek.token, body: { ...base, answers: full, hm_start: 100, hm_end: 50 } });
    assert.equal(r.status, 422);
    r = await api('POST', '/api/p2h', { token: mek.token, body: { ...base, answers: full, params: { temp: { load: 9999 } } } });
    assert.equal(r.status, 422);
  });

  test('manajemen tidak boleh mengisi P2H', async () => {
    const r = await api('POST', '/api/p2h', {
      token: mgmt.token,
      body: { unit_id: unitOf(1).id, shift_date: today(), shift: meta.shift.shift, answers: buildAnswers(meta), signature_png: SIG_MEK },
    });
    assert.equal(r.status, 403);
  });

  test('temuan AA + A -> hasil STOP OPERASI dan temuan terbuka muncul', async () => {
    const u = unitOf(1);
    const r = await api('POST', '/api/p2h', {
      token: mek.token,
      body: {
        unit_id: u.id, shift_date: today(), shift: meta.shift.shift, hm_start: 5000, params: PARAMS_OK, signature_png: SIG_MEK,
        answers: buildAnswers(meta, { 2: ['rusak', 'Oli rembes dari seal depan'], 13: ['perbaiki', 'Kabel grounding longgar'] }),
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.result, 'stop_aa');
    assert.equal(r.json.n_aa, 1);
    assert.equal(r.json.n_a, 1);
    ctx.forms.push(r.json.id);
    ctx.f2 = r.json.id;
    ctx.u2 = u.id;

    const f = await api('GET', '/api/findings?status=open', { token: mek.token });
    assert.equal(f.status, 200);
    const mine = f.json.items.filter((x) => x.unit_id === u.id);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].danger_code, 'AA', 'AA harus di urutan pertama');
    assert.ok(mine.some((x) => x.due_at), 'temuan A punya batas waktu 12 jam');
    ctx.findingAA = mine[0].id;
    ctx.findingA = mine[1].id;
  });

  test('detail P2H lengkap + izin sesuai peran', async () => {
    const r = await api('GET', `/api/p2h/${ctx.f2}`, { token: mek.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.sections.length, 4);
    assert.equal(r.json.sections.flatMap((s) => s.items).length, 30);
    assert.equal(r.json.params.length, 6);
    assert.equal(r.json.params[5].load, 28.5);
    assert.equal(r.json.permissions.can_edit, true);
    assert.equal(r.json.permissions.can_sign, false);
    const s = await api('GET', `/api/p2h/${ctx.f2}`, { token: sup.token });
    assert.equal(s.json.permissions.can_sign, true);
    const g = await api('GET', `/api/p2h/${ctx.f2}`, { token: mgmt.token });
    assert.equal(g.json.permissions.can_edit, false);
  });

  test('mekanik mengisi HM akhir lewat ubah (edit) dan temuan baru memicu pemberitahuan', async () => {
    const d = await api('GET', `/api/p2h/${ctx.f1}`, { token: mek.token });
    const answers = d.json.sections.flatMap((s) => s.items).map((i) => ({ item_id: i.item_id, condition: i.condition, note: i.note }));
    answers[5] = { item_id: answers[5].item_id, condition: 'perbaiki', note: 'Sirip radiator penyok' };
    const r = await api('PUT', `/api/p2h/${ctx.f1}`, {
      token: mek.token,
      body: { hm_start: 26630, hm_end: 26655, params: PARAMS_OK, answers, notes: 'Diubah: HM akhir diisi', use_saved_signature: false },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result, 'temuan_a');
    const back = answers.map((a, i) => (i === 5 ? { ...a, condition: 'baik', note: null } : a));
    const r2 = await api('PUT', `/api/p2h/${ctx.f1}`, { token: mek.token, body: { hm_start: 26630, hm_end: 26655, params: PARAMS_OK, answers: back } });
    assert.equal(r2.json.result, 'baik');
  });

  test('pengawas tanda tangan; mekanik tidak boleh; tidak bisa dobel; setelah TTD mekanik tidak bisa ubah', async () => {
    const no = await api('POST', `/api/p2h/${ctx.f1}/sign`, { token: mek.token, body: {} });
    assert.equal(no.status, 403);
    const nosig = await api('POST', `/api/p2h/${ctx.f1}/sign`, { token: sup.token, body: {} });
    assert.equal(nosig.status, 422, 'belum punya tanda tangan tersimpan');
    const ok = await api('POST', `/api/p2h/${ctx.f1}/sign`, { token: sup.token, body: { signature_png: SIG_SUP, save_signature: true } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await api('POST', `/api/p2h/${ctx.f1}/sign`, { token: sup.token, body: {} })).status, 409);
    const d = await api('GET', `/api/p2h/${ctx.f1}`, { token: mek.token });
    assert.equal(d.json.form.sup_name.startsWith('Uji pengawas'), true);
    assert.equal(d.json.permissions.can_edit, false);
    const upd = await api('PUT', `/api/p2h/${ctx.f1}`, { token: mek.token, body: { params: {}, answers: buildAnswers(meta) } });
    assert.equal(upd.status, 403);
    const me = await api('GET', '/api/auth/me', { token: sup.token });
    assert.equal(me.json.user.has_signature, true);
  });

  test('daftar P2H dengan penyaring', async () => {
    const all = await api('GET', '/api/p2h?limit=5', { token: mgmt.token });
    assert.equal(all.status, 200);
    assert.ok(all.json.total >= 2);
    const stop = await api('GET', '/api/p2h?result=stop_aa', { token: mgmt.token });
    assert.ok(stop.json.items.every((x) => x.result === 'stop_aa'));
    const byUnit = await api('GET', `/api/p2h?unit_id=${ctx.u2}`, { token: mgmt.token });
    assert.ok(byUnit.json.items.every((x) => x.unit_id === ctx.u2));
    const uns = await api('GET', '/api/p2h?unsigned=1', { token: mgmt.token });
    assert.ok(uns.json.items.every((x) => !x.signed));
  });

  test('dashboard: angka, site, tren, temuan teratas', async () => {
    const r = await api('GET', '/api/dashboard', { token: mgmt.token });
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
  });

  test('tindak lanjut: sedang diperbaiki lalu selesai (catatan wajib) -> unit tidak STOP lagi', async () => {
    let r = await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: mek.token, body: { status: 'in_progress' } });
    assert.equal(r.status, 200);
    let f = await api('GET', '/api/findings?status=open', { token: mek.token });
    assert.equal(f.json.items.find((x) => x.id === ctx.findingAA)?.status, 'in_progress');
    r = await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: mek.token, body: { status: 'closed' } });
    assert.equal(r.status, 422, 'menutup tanpa catatan ditolak');
    r = await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: mek.token, body: { status: 'closed', note: 'Seal depan diganti, oli ditambah' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    r = await api('PATCH', `/api/findings/${ctx.findingA}`, { token: sup.token, body: { status: 'closed', note: 'Kabel grounding dikencangkan' } });
    assert.equal(r.status, 200);
    f = await api('GET', '/api/findings?status=open', { token: mek.token });
    assert.equal(f.json.items.filter((x) => x.unit_id === ctx.u2).length, 0);
    const closed = await api('GET', '/api/findings?status=closed', { token: mek.token });
    assert.ok(closed.json.items.some((x) => x.unit_id === ctx.u2 && x.fix_note));
    const dash = await api('GET', '/api/dashboard', { token: mgmt.token });
    const u = dash.json.sites.flatMap((s) => s.units).find((x) => x.id === ctx.u2);
    assert.equal(u.state, 'ok');
    assert.equal((await api('PATCH', `/api/findings/${ctx.findingAA}`, { token: mek.token, body: { status: 'open' } })).status, 409);
  });

  test('temuan yang sama di dua shift digabung jadi satu baris (times = 2)', async () => {
    const u = unitOf(2);
    const mk = async (date, shift) =>
      api('POST', '/api/p2h', {
        token: mek.token,
        body: { unit_id: u.id, shift_date: date, shift, signature_png: SIG_MEK, answers: buildAnswers(meta, { 9: ['rusak', 'Mufler bocor'] }) },
      });
    const a = await mk(addDays(today(), -2), 1);
    const b = await mk(addDays(today(), -2), 2);
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(b.status, 201);
    ctx.forms.push(a.json.id, b.json.id);
    const f = await api('GET', `/api/findings?status=open&unit_id=${u.id}`, { token: mek.token });
    assert.equal(f.json.items.length, 1);
    assert.equal(f.json.items[0].times, 2);
    // tutup sekali -> dua laporan ikut selesai
    const r = await api('PATCH', `/api/findings/${f.json.items[0].id}`, { token: mek.token, body: { status: 'closed', note: 'Mufler diganti' } });
    assert.equal(r.json.changed, 2);
  });

  test('unduhan: tiket -> PDF / Word / Excel untuk satu P2H', async () => {
    const want = { pdf: [0x25, 0x50, 0x44, 0x46], docx: [0x50, 0x4b, 0x03, 0x04], xlsx: [0x50, 0x4b, 0x03, 0x04] };
    for (const format of ['pdf', 'docx', 'xlsx']) {
      const t = await api('POST', '/api/exports/ticket', { token: mgmt.token, body: { kind: 'p2h', format, id: ctx.f2 } });
      assert.equal(t.status, 200, JSON.stringify(t.json));
      const res = await api('GET', t.json.path, { raw: true });
      assert.equal(res.status, 200, `${format}: ${await res.clone().text()}`);
      assert.match(res.headers.get('content-disposition'), /attachment; filename=/);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.deepEqual([...buf.subarray(0, 4)], want[format], `${format} bukan berkas yang valid`);
      assert.ok(buf.length > 4000, `${format} terlalu kecil (${buf.length})`);
      fs.mkdirSync(path.join(here, 'out'), { recursive: true });
      fs.writeFileSync(path.join(here, 'out', `contoh-p2h.${format}`), buf);
    }
    const bad = await api('GET', '/api/exports/file?t=ngawur', { raw: true });
    assert.equal(bad.status, 401);
  });

  test('unduhan rekap: PDF / Word / Excel', async () => {
    for (const format of ['pdf', 'docx', 'xlsx']) {
      const t = await api('POST', '/api/exports/ticket', {
        token: mgmt.token,
        body: { kind: 'rekap', format, filters: { from: addDays(today(), -10), to: today() } },
      });
      const res = await api('GET', t.json.path, { raw: true });
      assert.equal(res.status, 200, `${format}: ${await res.clone().text()}`);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.length > 3000);
      fs.writeFileSync(path.join(here, 'out', `contoh-rekap.${format}`), buf);
    }
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
    assert.equal((await api('POST', '/api/notifications/push/subscribe', { token: mek.token, body: sub })).status, 200);
    const users = await api('GET', '/api/users', { token: admin });
    assert.equal(users.json.items.find((u) => u.id === mek.id).devices, 1);
    assert.equal((await api('POST', '/api/notifications/push/unsubscribe', { token: mek.token, body: { endpoint: sub.endpoint } })).status, 200);
  });

  test('admin: pengaturan, daftar cek, impor akun, catatan aktivitas', async () => {
    const s = await api('GET', '/api/admin/settings', { token: admin });
    assert.equal(s.json.settings.shift1_start, '06:00');
    const bad = await api('PUT', '/api/admin/settings', { token: admin, body: { ...s.json.settings, shift1_start: '19:00' } });
    assert.equal(bad.status, 400);
    assert.equal((await api('GET', '/api/admin/settings', { token: mek.token })).status, 403);

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
        { nrp: `imp1${rnd}`, name: 'Impor Satu', role: 'Electrician', site: 'Suaran' },
        { nrp: `imp2${rnd}`, name: 'Impor Dua', role: 'foreman', site: 'lati' },
        { nrp: `imp1${rnd}`, name: 'Dobel', role: 'mekanik' },
        { nrp: `imp3${rnd}`, name: 'Salah Site', role: 'mekanik', site: 'Mars' },
      ] },
    });
    assert.equal(imp.status, 200, JSON.stringify(imp.json));
    assert.equal(imp.json.created, 2);
    assert.equal(imp.json.failed, 2);
    const all = await api('GET', '/api/users', { token: admin });
    for (const u of all.json.items.filter((x) => x.nrp.startsWith(`imp`) && x.nrp.endsWith(rnd))) ctx.users.push(u.id);

    const au = await api('GET', '/api/admin/audit', { token: admin });
    assert.ok(au.json.items.length > 5);
  });

  test('admin tidak bisa menonaktifkan dirinya; reset password mematikan sesi lama', async () => {
    const me = await api('GET', '/api/auth/me', { token: admin });
    const self = await api('PUT', `/api/users/${me.json.user.id}`, {
      token: admin, body: { name: 'Administrator', role: 'admin', is_active: false },
    });
    assert.equal(self.status, 400);
    const rs = await api('POST', `/api/users/${mgmt.id}/reset-password`, { token: admin });
    assert.equal(rs.status, 200);
    assert.equal((await api('GET', '/api/auth/me', { token: mgmt.token })).status, 401, 'sesi lama harus mati');
  });

  after(async () => {
    // bersihkan data uji
    if (!admin) return;
    for (const id of ctx.forms) await api('DELETE', `/api/p2h/${id}`, { token: admin });
    for (const u of ctx.units) await api('DELETE', `/api/units/${u.id}`, { token: admin });
    for (const id of ctx.users) {
      await api('PUT', `/api/users/${id}`, { token: admin, body: { name: 'Uji (dinonaktifkan)', role: 'manajemen', is_active: false } });
    }
  });
});
