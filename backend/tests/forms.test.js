// Uji form digital serbaguna (contoh form per shift, tools, arus motor, safety device, metal catcher, grounding, jembatan timbang, trafo, oil trap, panel, terminal motor) lewat API sungguhan.
// Database PostgreSQL dinyalakan sementara (embedded-postgres) lalu dihapus. Jalankan:  npm run test:forms
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5400 + Math.floor(Math.random() * 90);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2h-forms-'));
process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/p2h`;
process.env.JWT_SECRET ||= 'x'.repeat(40);
process.env.APP_URL = 'https://p2h.example.test';

const PHOTO = `data:image/jpeg;base64,${fs.readFileSync(path.join(here, 'fixtures', 'foto-a.jpg')).toString('base64')}`;
const SIG = fs.readFileSync(path.join(here, 'fixtures', 'signature-mekanik.txt'), 'utf8').trim();

describe('Form digital serbaguna', () => {
  let pg;
  let db;
  let server;
  let base;
  const tok = {};
  const site = {};
  let today;

  async function api(method, url, { as = 'admin', body } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${tok[as]}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  before(async () => {
    const EmbeddedPostgres = (await import('embedded-postgres')).default;
    pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('p2h');
    db = await import('../src/db.js');
    await (await import('../src/bootstrap.js')).bootstrap(() => {});
    // contoh form per shift (isi P2H LV lama) untuk menguji form per shift & rekap WhatsApp per shift
    const { SHIFT_FORM } = await import('./fixtures/shift-form.js');
    await (await import('../src/forms/bootstrap.js')).seedForms(() => {}, [SHIFT_FORM]);
    const { signToken } = await import('../src/middleware/auth.js');
    const { state } = await import('../src/state.js');
    const { createApp } = await import('../src/app.js');
    const { wita } = await import('../src/time.js');
    today = wita().date;
    for (const s of (await db.query('SELECT id, code FROM sites')).rows) site[s.code] = s.id;
    const mk = async (nrp, role, siteId) => {
      const u = (await db.query(`INSERT INTO users (nrp, name, password_hash, role, site_id) VALUES ($1,$2,'x',$3,$4) RETURNING id, token_version`, [nrp, `Uji ${nrp}`, role, siteId])).rows[0];
      tok[nrp] = signToken(u);
    };
    await mk('admin', 'admin', null);
    await mk('tek', 'teknisi', site.SRN);
    await mk('tek2', 'teknisi', site.BMO);
    await mk('sup', 'pengawas', site.SRN);
    state.ready = true;
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await db?.pool.end().catch(() => {});
    await pg?.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** jawaban: semua butir "baik"/terisi, kecuali yang diubah lewat fn */
  function fill(sections, fn = () => null) {
    const answers = [];
    for (const s of sections) {
      for (const it of s.items) {
        const o = fn(it);
        if (o === 'skip') continue;
        if (o) answers.push({ item_id: it.id, ...o });
        else if (it.kind === 'check') answers.push({ item_id: it.id, condition: 'good' });
        else if (it.kind === 'measure') answers.push({ item_id: it.id, values: Object.fromEntries(it.fields.map((f) => [f.key, it.min_value != null ? it.min_value + 1 : 1])) });
        else answers.push({ item_id: it.id, value: it.input_type === 'date' ? '2027-06-30' : 'ok' });
      }
    }
    return answers;
  }

  test('layar pilih form: 10 jenis form dari form kertas (+ contoh form per shift untuk uji), periode sesuai jadwal', async () => {
    const r = await api('GET', '/api/forms');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map((t) => t.code), [
      'p2h_lv', 'tools_monthly', 'ampere', 'safety_device', 'metal_catcher', 'grounding', 'weighbridge', 'trafo', 'oil_trap', 'panel', 'motor_terminal',
    ]);
    const period = Object.fromEntries(r.json.items.map((t) => [t.code, t.period]));
    assert.deepEqual(
      { ...period },
      {
        p2h_lv: 'shift', tools_monthly: 'quarter', ampere: 'month', safety_device: 'week', metal_catcher: 'week', grounding: 'half',
        weighbridge: 'week', trafo: 'month', oil_trap: 'week', panel: 'biweek', motor_terminal: 'quarter',
      },
    );
    const by = Object.fromEntries(r.json.items.map((t) => [t.code, t]));
    assert.equal(by.tools_monthly.subjects, 1);
    assert.equal(by.safety_device.subjects, 8);
    assert.equal(by.safety_device.period_label, 'Minggu ini');
    // teknisi site lain tidak melihat objek Suaran
    const r2 = await api('GET', '/api/forms', { as: 'tek2' });
    assert.equal(r2.json.items.find((t) => t.code === 'safety_device').subjects, 0);
  });

  test('isi awal sesuai form kertas: butir per conveyor, 72 tools, 40 motor, P2H LV', async () => {
    const sd = await api('GET', '/api/forms/safety_device', { as: 'tek' });
    const names = sd.json.subjects.map((s) => s.name);
    assert.deepEqual(names.sort(), ['CV-10', 'CV-11', 'CV-12', 'CV-13', 'CV-14', 'CV-15', 'CV-18', 'CV-19']);
    const counts = Object.fromEntries(sd.json.subjects.map((s) => [s.name, s.own_items]));
    assert.equal(counts['CV-11'], 11);
    assert.equal(counts['CV-18'], 28);
    assert.equal(counts['CV-10'], 27);
    const tools = await api('GET', '/api/forms/tools_monthly', { as: 'tek' });
    // 75 baris di kertas = 72 alat + 3 judul kelompok (Screwdriver, Reversible gear spanner, Double open ended spanner)
    assert.equal(tools.json.subjects[0].own_items, 72);
    const amp = await api('GET', '/api/forms/ampere', { as: 'tek' });
    assert.equal(amp.json.subjects[0].own_items, 40); // termasuk Motor 1 / Motor 2 CV-10, CV-18, KM-23
    const lv = await api('GET', '/api/forms/p2h_lv/checklist');
    assert.equal(lv.json.sections.length, 3);
    assert.equal(lv.json.sections.flatMap((s) => s.items).length, 8 + 22 + 10);
  });

  test('form tambahan: grounding, jembatan timbang, trafo (bulanan + butir tahunan)', async () => {
    const own = async (code) => (await api('GET', `/api/forms/${code}`)).json;
    const g = await own('grounding');
    assert.equal(g.subjects[0].name, 'Suaran - BMO 1');
    assert.equal(g.subjects[0].own_items, 21);
    assert.equal((await own('weighbridge')).shared_items, 3 + 7 * 3 + 5);
    const tw = await own('trafo');
    assert.deepEqual(tw.subjects.map((s) => s.name).sort(), ['KM-28', 'KM-30']);
    assert.equal(tw.shared_items, 6 + 3 + 1 + 3 + 3 + 3 + 6);
    // tahanan grounding di atas 5 Ohm jadi temuan
    const cl = (await api('GET', `/api/forms/grounding/checklist?subject_id=${g.subjects[0].id}`, { as: 'tek' })).json.sections;
    const r = await api('POST', '/api/forms/grounding/records', {
      as: 'tek',
      body: { subject_id: g.subjects[0].id, record_date: today, signature_png: SIG, answers: fill(cl, (it) => (it.text === 'CV-12' ? { values: { v: 7.2 } } : { values: { v: 1.4 } })) },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.n_fix, 1);
  });

  test('form baru: oil trap power house, panel / MCC (tiap 2 minggu), koneksi terminal motor (kuartal)', async () => {
    const ot = (await api('GET', '/api/forms/oil_trap')).json;
    assert.deepEqual(ot.subjects.map((x) => x.name), ['Power House']);
    assert.equal(ot.type.doc_no, 'DOKIV-ALL-28-3.7.5');
    const otCl = (await api('GET', `/api/forms/oil_trap/checklist?subject_id=${ot.subjects[0].id}`)).json.sections;
    assert.deepEqual(otCl.map((x) => x.items.length), [4, 3]);
    assert.equal(otCl[0].items[0].good_label, 'Y');

    const pn = (await api('GET', '/api/forms/panel')).json;
    assert.deepEqual(pn.subjects.map((x) => x.name), ['MCC 1', 'MCC 2', 'MCC 4', 'MCC 5', 'Panel Metal Catcher CV-14', 'Panel Metal Catcher CV-15']);
    assert.equal(pn.period.label, '2 minggu ini');
    const { periodRange } = await import('../src/time.js');
    assert.equal(pn.period.from, periodRange('biweek', today).from);
    assert.deepEqual(periodRange('biweek', '2026-11-21'), { from: '2026-11-16', to: '2026-11-29' });
    assert.deepEqual(periodRange('biweek', '2026-11-30'), { from: '2026-11-30', to: '2026-12-13' });
    const mcc = (await api('GET', `/api/forms/panel/checklist?subject_id=${pn.subjects[0].id}`)).json.sections;
    const mc = (await api('GET', `/api/forms/panel/checklist?subject_id=${pn.subjects[4].id}`)).json.sections;
    assert.equal(mcc.flatMap((x) => x.items).length, 12);
    assert.equal(mc.flatMap((x) => x.items).length, 14, 'panel metal catcher: + metering & lampu indikasi');
    assert.equal(mcc[0].items[0].required, false, 'butir 1-3 hanya untuk panel dalam ruangan');
    // isi panel: kepatuhan dihitung per 2 minggu
    const ok = await api('POST', '/api/forms/panel/records', {
      as: 'tek',
      body: { subject_id: pn.subjects[0].id, record_date: today, signature_png: SIG, answers: fill(mcc, (it) => (it.required ? null : 'skip')) },
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    const st = (await api('GET', '/api/forms/panel/stats')).json;
    assert.equal(st.compliance.kind, 'biweek');
    const last = st.compliance.items[st.compliance.items.length - 1];
    assert.equal(last.start, periodRange('biweek', today).from);
    assert.equal(last.done, 1);
    assert.equal(last.expected, 6);

    const mt = (await api('GET', '/api/forms/motor_terminal')).json;
    assert.equal(mt.subjects.length, 20);
    assert.ok(mt.subjects.some((x) => x.name === 'CV-12' && x.detail === 'Inloading 1 · 132 kW'));
    const mtCl = (await api('GET', `/api/forms/motor_terminal/checklist?subject_id=${mt.subjects[0].id}`)).json.sections;
    assert.deepEqual(mtCl.map((x) => x.title), ['Koneksi terminal', 'Pemeriksaan fisik', 'Uji tahanan isolasi', 'Uji tahanan belitan', 'Uji tanpa beban']);
    // tahanan isolasi di bawah 1 MOhm jadi temuan; uji lain boleh dilewati
    const r = await api('POST', '/api/forms/motor_terminal/records', {
      as: 'tek',
      body: {
        subject_id: mt.subjects[0].id,
        record_date: today,
        signature_png: SIG,
        answers: fill(mtCl, (it) => (it.text === 'Tahanan isolasi' ? { values: { uv: 50, uw: 50, vw: 50, ug: 0.4, vg: 30, wg: 30 } } : it.required ? null : 'skip')),
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.n_fix, 1);
  });

  let lvSubject;
  let lvRecord;
  test('admin menambah unit LV; teknisi mengisi P2H LV dengan temuan STOP', async () => {
    const add = await api('POST', '/api/forms/p2h_lv/subjects', { body: { site_id: site.SRN, name: 'LV-012', detail: 'Toyota Hilux' } });
    assert.equal(add.status, 201);
    lvSubject = add.json.id;
    const dup = await api('POST', '/api/forms/p2h_lv/subjects', { body: { site_id: site.SRN, name: 'lv-012' } });
    assert.equal(dup.status, 409);

    const cl = (await api('GET', `/api/forms/p2h_lv/checklist?subject_id=${lvSubject}`, { as: 'tek' })).json.sections;
    const rem = cl[1].items.find((i) => i.text.startsWith('Semua rem'));
    const palu = cl[2].items.find((i) => i.text.startsWith('Palu'));
    const base_ = { subject_id: lvSubject, record_date: today, shift: 1, header: { job_site: 'BMO 1', hm_awal: '1200,5' }, signature_png: SIG };

    // butir wajib terlewat
    const inc = await api('POST', '/api/forms/p2h_lv/records', { as: 'tek', body: { ...base_, answers: fill(cl, (it) => (it.id === rem.id ? 'skip' : null)) } });
    assert.equal(inc.status, 422);
    assert.match(inc.json.error.message, /1 butir wajib/);
    // rusak tanpa foto ditolak
    const nophoto = await api('POST', '/api/forms/p2h_lv/records', {
      as: 'tek',
      body: { ...base_, answers: fill(cl, (it) => (it.id === rem.id ? { condition: 'bad', note: 'rem blong' } : it.id === palu.id ? 'skip' : null)) },
    });
    assert.equal(nophoto.status, 422);
    assert.equal(nophoto.json.error.code, 'photo_required');
    // lengkap: palu (khusus bus) boleh dilewati
    const ok = await api('POST', '/api/forms/p2h_lv/records', {
      as: 'tek',
      body: { ...base_, answers: fill(cl, (it) => (it.id === rem.id ? { condition: 'bad', note: 'rem blong', photos: [PHOTO] } : it.id === palu.id ? 'skip' : null)) },
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.result, 'stop');
    assert.equal(ok.json.n_stop, 1);
    lvRecord = ok.json.id;
    // satu unit satu shift
    const again = await api('POST', '/api/forms/p2h_lv/records', { as: 'tek', body: { ...base_, answers: fill(cl, (it) => (it.id === palu.id ? 'skip' : null)) } });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.details.existing_id, lvRecord);
  });

  test('detail: kepala form, foto, hak akses per site; pemberitahuan membawa alamat halaman', async () => {
    const d = await api('GET', `/api/forms/p2h_lv/records/${lvRecord}`, { as: 'tek' });
    assert.equal(d.status, 200);
    assert.equal(d.json.record.header.hm_awal, 1200.5);
    const bad = d.json.sections.flatMap((s) => s.items).find((i) => i.condition === 'bad');
    assert.equal(bad.is_finding, true);
    assert.equal(bad.photos.length, 1);
    assert.equal(d.json.permissions.can_edit, true);
    const photo = await fetch(`${base}/api/forms/photos/${bad.photos[0]}`, { headers: { Authorization: `Bearer ${tok.tek}` } });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.equal((await api('GET', `/api/forms/p2h_lv/records/${lvRecord}`, { as: 'tek2' })).status, 404);
    const n = (await db.query(`SELECT kind, path FROM notifications WHERE path LIKE '/f/p2h_lv/%' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.deepEqual(n, { kind: 'form_stop', path: `/f/p2h_lv/r/${lvRecord}` });
  });

  test('pengawas memverifikasi; sesudahnya teknisi tidak bisa mengubah', async () => {
    const v = await api('POST', `/api/forms/p2h_lv/records/${lvRecord}/verify`, { as: 'sup', body: { signature_png: SIG, note: 'Unit STOP, rem diganti dulu' } });
    assert.equal(v.status, 200);
    const d = await api('GET', `/api/forms/p2h_lv/records/${lvRecord}`, { as: 'tek' });
    assert.equal(d.json.record.sup_note, 'Unit STOP, rem diganti dulu');
    assert.equal(d.json.permissions.can_edit, false);
    const cl = (await api('GET', `/api/forms/p2h_lv/checklist?subject_id=${lvSubject}`, { as: 'tek' })).json.sections;
    const put = await api('PUT', `/api/forms/p2h_lv/records/${lvRecord}`, { as: 'tek', body: { answers: fill(cl), signature_png: SIG } });
    assert.equal(put.status, 403);
  });

  test('temuan: dipantau, rencana penyelesaian, ditutup dengan catatan', async () => {
    const open = await api('GET', '/api/forms/p2h_lv/findings', { as: 'sup' });
    assert.equal(open.json.items.length, 1);
    const f = open.json.items[0];
    assert.equal(f.severity, 'stop');
    // admin bisa menyaring per site; teknisi / pengawas selalu terkunci ke site-nya
    assert.equal((await api('GET', `/api/forms/p2h_lv/findings?site_id=${site.SRN}`)).json.items.length, 1);
    assert.equal((await api('GET', `/api/forms/p2h_lv/findings?site_id=${site.BMO}`)).json.items.length, 0);
    assert.equal((await api('GET', `/api/forms/p2h_lv/findings?site_id=${site.BMO}`, { as: 'sup' })).json.items.length, 1);
    const plan = await api('PATCH', `/api/forms/p2h_lv/findings/${f.id}`, { as: 'tek', body: { status: 'in_progress', plan_date: today } });
    assert.equal(plan.status, 200);
    const noNote = await api('PATCH', `/api/forms/p2h_lv/findings/${f.id}`, { as: 'tek', body: { status: 'closed' } });
    assert.equal(noNote.status, 422);
    const close = await api('PATCH', `/api/forms/p2h_lv/findings/${f.id}`, { as: 'tek', body: { status: 'closed', note: 'kampas rem diganti' } });
    assert.equal(close.status, 200);
    assert.equal((await api('GET', '/api/forms/p2h_lv/findings', { as: 'sup' })).json.items.length, 0);
    const closed = (await api('GET', '/api/forms/p2h_lv/findings?status=closed', { as: 'sup' })).json.items;
    assert.equal(closed[0].fix_note, 'kampas rem diganti');
    assert.equal(closed[0].fix_plan_date, today);
    const subj = (await api('GET', '/api/forms/p2h_lv', { as: 'tek' })).json.subjects.find((s) => s.id === lvSubject);
    assert.equal(subj.open_stop, 0);
    assert.equal(subj.done_now, true);
  });

  test('grup WhatsApp: semua temuan, temuan selesai, verifikasi, rekap per shift P2H LV (sekali saja)', async () => {
    const fn = await import('../src/services/form-notify.js');
    const sent = [];
    fn.__setDepsForTest({ ready: () => true, send: async (t) => void sent.push(t) });
    const lv = (await api('GET', '/api/forms/p2h_lv')).json.type;
    const sd = (await api('GET', '/api/forms/safety_device')).json.type;
    assert.equal(lv.wa_findings, true);
    assert.equal(lv.wa_verify, true);

    // pesan temuan: STOP dan perbaiki dalam satu pesan
    const msg = fn.buildFindingMessage(lv, { id: 9, record_date: today, shift: 1, site_name: 'Suaran', subject_name: 'LV-012', filler_name: 'Budi' }, [
      { item_text: 'Semua rem / brake', kind: 'check', severity: 'stop', bad_label: 'Rusak', note: 'rem blong' },
      { item_text: 'Wiper & air wiper', kind: 'check', severity: 'fix', bad_label: 'Rusak', note: null },
    ]);
    assert.match(msg, /^🛑 \*STOP · P2H LV · LV-012\*/);
    assert.match(msg, /\*Temuan STOP \(1\):\*\n1\. Semua rem \/ brake \(Rusak\)\n {3}Catatan: rem blong/);
    assert.match(msg, /\*Perlu diperbaiki dalam 24 jam \(1\):\*\n1\. Wiper & air wiper \(Rusak\)/);
    assert.match(fn.buildFindingMessage(sd, { id: 1, record_date: today, shift: 0, site_name: 'Suaran', subject_name: 'CV-11', filler_name: 'Budi' }, [{ item_text: 'Rotation Detector', kind: 'check', severity: 'fix', bad_label: 'Tidak' }]), /^⚠️ \*Ada temuan · Safety Device · CV-11\*/);
    assert.match(fn.buildFixedMessage(sd, { subject_name: 'CV-11', site_name: 'Suaran', item_text: 'Rotation Detector', severity: 'fix', fix_note: 'diganti', by_name: 'Andi' }), /^✅ \*Temuan selesai · CV-11\*\n\nSafety Device · Suaran/);

    // P2H LV (per shift): satu rekap per site per shift, tidak dobel
    assert.equal((await fn.notifyVerified(lv, lvRecord)).ok, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^📋 \*Rekap P2H LV Suaran · Shift I\*/);
    assert.match(sent[0], /✅ 1 dari 1 unit LV diperiksa dan diverifikasi/);
    assert.match(sent[0], /🛑 LV-012 · STOP \(1\)/);
    assert.match(sent[0], /Rekomendasi:\*\nLV-012: Unit STOP, rem diganti dulu/);
    assert.deepEqual(await fn.notifyVerified(lv, lvRecord), { ok: false, skipped: 'sudah dikirim' });
    assert.equal(sent.length, 1);

    // grup WhatsApp per form: tanpa pilihan = grup utama; dengan pilihan = grup itu (nama dari WhatsApp)
    const routes = await import('../src/routes/forms.js');
    routes.__setWaGroupsForTest(async () => [{ id: '120363000000000111@g.us', name: 'Grup Safety Device', size: 5 }]);
    const jids = [];
    fn.__setDepsForTest({ ready: () => true, send: async (t, jid) => void (sent.push(t), jids.push(jid ?? null)) });
    assert.equal((await api('PUT', '/api/forms/safety_device/wa-group', { body: { id: '120363000000000999@g.us' } })).status, 422);
    assert.equal((await api('PUT', '/api/forms/safety_device/wa-group', { as: 'tek', body: { id: null } })).status, 403);
    const pickG = await api('PUT', '/api/forms/safety_device/wa-group', { body: { id: '120363000000000111@g.us' } });
    assert.equal(pickG.status, 200, JSON.stringify(pickG.json));
    assert.equal(pickG.json.type.wa_group_name, 'Grup Safety Device');
    const sdT = (await api('GET', '/api/forms/safety_device')).json.type;
    fn.notifyFixed(sdT, { subject_name: 'CV-11', site_name: 'Suaran', item_text: 'Pull cord', severity: 'fix', fix_note: 'ok', by_name: 'Andi' });
    fn.notifyFixed(lv, { subject_name: 'LV-012', site_name: 'Suaran', item_text: 'Wiper', severity: 'fix', fix_note: 'ok', by_name: 'Andi' });
    await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(jids.slice(-2), ['120363000000000111@g.us', null]);
    sent.splice(1);
    await api('PUT', '/api/forms/safety_device/wa-group', { body: { id: null } });
    assert.equal((await api('GET', '/api/forms/safety_device')).json.type.wa_group_id, null);
    routes.__setWaGroupsForTest(null);

    // form lain: satu pesan per isian yang diverifikasi
    const add = await api('POST', '/api/forms/safety_device/subjects', { body: { site_id: site.SRN, name: 'CV-77', copy_from: (await api('GET', '/api/forms/safety_device')).json.subjects[0].id } });
    const cl = (await api('GET', `/api/forms/safety_device/checklist?subject_id=${add.json.id}`, { as: 'tek' })).json.sections;
    const rec = await api('POST', '/api/forms/safety_device/records', { as: 'tek', body: { subject_id: add.json.id, record_date: today, signature_png: SIG, answers: fill(cl) } });
    await api('POST', `/api/forms/safety_device/records/${rec.json.id}/verify`, { as: 'sup', body: { signature_png: SIG, note: 'OK' } });
    await new Promise((r) => setTimeout(r, 300));
    const v = sent.find((t) => t.includes('Safety Device terverifikasi · CV-77'));
    assert.ok(v, sent.join('\n---\n'));
    assert.match(v, /Hasil: Semua baik\nDiperiksa oleh: Uji tek\nDiverifikasi oleh: Uji sup\nCatatan \/ rekomendasi: OK/);

    // saklar mati: tidak ada pesan verifikasi
    await api('PUT', '/api/forms/safety_device', { body: { wa_verify: false } });
    const sd2 = (await api('GET', '/api/forms/safety_device')).json.type;
    assert.deepEqual(await fn.notifyVerified(sd2, rec.json.id), { ok: false, skipped: true });
    await api('PUT', '/api/forms/safety_device', { body: { wa_verify: true } });
  });

  test('arus motor: angka di atas arus maks jadi temuan, motor yang mati boleh kosong', async () => {
    const subj = (await api('GET', '/api/forms/ampere', { as: 'tek' })).json.subjects[0];
    const cl = (await api('GET', `/api/forms/ampere/checklist?subject_id=${subj.id}`, { as: 'tek' })).json.sections;
    const cv11 = cl[0].items.find((i) => i.text === 'CV-11');
    assert.equal(cv11.max_value, 81);
    const r = await api('POST', '/api/forms/ampere/records', {
      as: 'tek',
      body: {
        subject_id: subj.id,
        record_date: today,
        signature_png: SIG,
        answers: [
          { item_id: cv11.id, values: { k_r: 20, k_s: 21, k_t: 20, m_r: 95.5, m_s: '70,2', m_t: 71 } },
          { item_id: cl[0].items[1].id, values: { k_r: 50 } },
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.result, 'finding');
    assert.equal(r.json.n_fix, 1);
    const bad = await api('POST', '/api/forms/ampere/records', {
      as: 'tek',
      body: { subject_id: subj.id, record_date: today, signature_png: SIG, answers: [{ item_id: cv11.id, values: { k_r: 'abc' } }] },
    });
    assert.equal(bad.status, 422);
  });

  test('trafo: butir mingguan wajib, butir tahunan boleh dilewati, pilihan cuaca, grounding tahunan di atas batas', async () => {
    const subj = (await api('GET', '/api/forms/trafo', { as: 'tek' })).json.subjects.find((s) => s.name === 'KM-30');
    const cl = (await api('GET', `/api/forms/trafo/checklist?subject_id=${subj.id}`, { as: 'tek' })).json.sections;
    assert.equal(cl.length, 7);
    const yearly = cl.filter((s) => s.title.startsWith('Tahunan')).flatMap((s) => s.items);
    assert.ok(yearly.length === 9 && yearly.every((i) => !i.required));
    const body = (answers, header = { cuaca: 'Cerah' }) => ({ subject_id: subj.id, record_date: today, signature_png: SIG, header, answers });
    const weeklyOnly = (it) => (yearly.some((y) => y.id === it.id) ? 'skip' : null);
    const missing = await api('POST', '/api/forms/trafo/records', { as: 'tek', body: body(fill(cl, (it) => (it.text === 'Tegangan primer' ? { values: {} } : weeklyOnly(it)))) });
    assert.equal(missing.status, 422);
    const badWeather = await api('POST', '/api/forms/trafo/records', { as: 'tek', body: body(fill(cl, weeklyOnly), { cuaca: 'Badai' }) });
    assert.equal(badWeather.status, 422);
    const ok = await api('POST', '/api/forms/trafo/records', { as: 'tek', body: body(fill(cl, weeklyOnly)) });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.result, 'ok');
    const km28 = (await api('GET', '/api/forms/trafo', { as: 'tek' })).json.subjects.find((s) => s.name === 'KM-28');
    const year = await api('POST', '/api/forms/trafo/records', {
      as: 'tek',
      body: { ...body(fill(cl, (it) => (it.text === 'Resistance grounding' ? { values: { v: 7 } } : null)), { cuaca: 'Hujan' }), subject_id: km28.id },
    });
    assert.equal(year.status, 201, JSON.stringify(year.json));
    assert.equal(year.json.n_fix, 1);
    assert.equal((await api('GET', `/api/forms/trafo/checklist?subject_id=${km28.id}`, { as: 'tek' })).json.last_header.cuaca, 'Hujan');
  });

  test('hak akses form per akun: hanya form yang diizinkan, P2H Genset ikut dijaga', async () => {
    const me = (await db.query(`SELECT id, name, role, site_id FROM users WHERE nrp = 'tek'`)).rows[0];
    const put = (form_access) => api('PUT', `/api/users/${me.id}`, { body: { name: me.name, role: me.role, site_id: me.site_id, is_active: true, form_access } });
    assert.equal((await put(['p2h_lv', 'tidak_ada'])).status, 422);
    const set = await put(['p2h_lv']);
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json.item.form_access, ['p2h_lv']);
    assert.deepEqual((await api('GET', '/api/forms', { as: 'tek' })).json.items.map((t) => t.code), ['p2h_lv']);
    assert.equal((await api('GET', '/api/forms/safety_device', { as: 'tek' })).status, 403);
    assert.equal((await api('GET', '/api/forms/safety_device/records', { as: 'tek' })).status, 403);
    assert.equal((await api('GET', '/api/forms/p2h_lv', { as: 'tek' })).status, 200);
    assert.equal((await api('GET', '/api/dashboard', { as: 'tek' })).status, 403);
    assert.equal((await api('GET', '/api/p2h', { as: 'tek' })).status, 403);
    assert.deepEqual((await api('GET', '/api/auth/me', { as: 'tek' })).json.user.form_access, ['p2h_lv']);
    // P2H Genset diizinkan lagi; null = semua form
    await put(['p2h_lv', 'p2h_genset']);
    assert.equal((await api('GET', '/api/dashboard', { as: 'tek' })).status, 200);
    await put(null);
    assert.equal((await api('GET', '/api/forms', { as: 'tek' })).json.items.length, 11);
    assert.equal((await api('GET', '/api/auth/me', { as: 'tek' })).json.user.form_access, null);
  });
  test('kelola: tambah bagian & butir, ubah urutan, nonaktifkan; objek baru menyalin daftar dari conveyor lain', async () => {
    const sec = await api('POST', '/api/forms/metal_catcher/sections', { body: { title: 'Tambahan', note: null } });
    assert.equal(sec.status, 201);
    const it1 = await api('POST', '/api/forms/metal_catcher/items', {
      body: { section_id: sec.json.id, text: 'Plate 3 mm x 100 mm x 100 mm', kind: 'check', severity: 'fix', good_label: 'Ketarik', bad_label: 'Tidak', needs_photo: false },
    });
    const it2 = await api('POST', '/api/forms/metal_catcher/items', {
      body: { section_id: sec.json.id, text: 'Suhu magnet', kind: 'measure', severity: 'fix', unit: 'C', max_value: 80, fields: [{ key: 'v', label: 'Hasil' }] },
    });
    assert.equal(it2.status, 201);
    const tooSimple = await api('POST', '/api/forms/metal_catcher/items', { as: 'tek', body: { section_id: sec.json.id, text: 'x', kind: 'check', severity: 'fix' } });
    assert.equal(tooSimple.status, 403);
    let cl = (await api('GET', '/api/forms/metal_catcher/checklist')).json.sections;
    assert.deepEqual(cl[1].items.map((i) => i.id), [it1.json.id, it2.json.id]);
    const moved = await api('PUT', `/api/forms/metal_catcher/items/${it2.json.id}`, {
      body: { section_id: sec.json.id, text: 'Suhu magnet', kind: 'measure', severity: 'fix', unit: 'C', max_value: 80, move: 'up' },
    });
    assert.equal(moved.status, 200);
    cl = (await api('GET', '/api/forms/metal_catcher/checklist')).json.sections;
    assert.deepEqual(cl[1].items.map((i) => i.id), [it2.json.id, it1.json.id]);
    await api('PUT', `/api/forms/metal_catcher/items/${it1.json.id}`, {
      body: { section_id: sec.json.id, text: 'Plate 3 mm x 100 mm x 100 mm', kind: 'check', severity: 'fix', is_active: false },
    });
    cl = (await api('GET', '/api/forms/metal_catcher/checklist')).json.sections;
    assert.equal(cl[1].items.length, 1);
    const all = (await api('GET', '/api/forms/metal_catcher/checklist?all=1')).json.sections;
    assert.equal(all[1].items.length, 2);
    assert.equal((await api('DELETE', `/api/forms/metal_catcher/sections/${sec.json.id}`)).status, 409);

    const cv11 = (await api('GET', '/api/forms/safety_device')).json.subjects.find((s) => s.name === 'CV-11');
    const copy = await api('POST', '/api/forms/safety_device/subjects', { body: { site_id: site.SRN, name: 'CV-99', detail: 'Uji', copy_from: cv11.id } });
    assert.equal(copy.status, 201);
    const cv99 = (await api('GET', '/api/forms/safety_device')).json.subjects.find((s) => s.name === 'CV-99');
    assert.equal(cv99.own_items, 11);
    const typ = await api('PUT', '/api/forms/safety_device', { body: { fix_hours: 48, period: 'week' } });
    assert.equal(typ.json.type.fix_hours, 48);
  });

  test('rekap / dashboard: tren, kepatuhan, temuan terbanyak, per objek, per site', async () => {
    const r = await api('GET', '/api/forms/p2h_lv/stats');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const s = r.json;
    assert.equal(s.range.bucket, 'day');
    assert.equal(s.trend.length, 30);
    const last = s.trend[s.trend.length - 1];
    assert.equal(last.start, today);
    assert.equal(last.stop, 1);
    assert.equal(s.summary.records, 1);
    assert.equal(s.summary.with_stop, 1);
    assert.equal(s.summary.verified, 1);
    assert.equal(s.summary.closed, 1);
    assert.equal(s.compliance.per, 'shift');
    assert.equal(s.compliance.items[s.compliance.items.length - 1].done, 1);
    assert.equal(s.top_items[0].item_text, 'Semua rem / brake');
    assert.equal(s.top_items[0].has_stop, true);
    assert.equal(s.subjects[0].name, 'LV-012');
    assert.equal(s.sites.length, 5);
    // 12 bulan -> per bulan; teknisi terkunci ke site-nya (tanpa daftar per site)
    const y = await api('GET', `/api/forms/safety_device/stats?from=${today.slice(0, 4) - 1}${today.slice(4)}`, { as: 'tek' });
    assert.equal(y.json.range.bucket, 'month');
    assert.equal(y.json.compliance.kind, 'week');
    assert.equal(y.json.sites.length, 0);
    // form "sesuai kebutuhan" tidak punya grafik kepatuhan
    await api('PUT', '/api/forms/oil_trap', { body: { period: 'none' } });
    assert.equal((await api('GET', '/api/forms/oil_trap/stats')).json.compliance, null);
    await api('PUT', '/api/forms/oil_trap', { body: { period: 'week' } });
    // arus motor & trafo bulanan, grounding per semester (semester berjalan dihitung utuh sejak awal semester)
    assert.equal((await api('GET', '/api/forms/ampere/stats')).json.compliance.kind, 'month');
    assert.equal((await api('GET', '/api/forms/trafo')).json.type.period, 'month');
    const gq = (await api('GET', '/api/forms/grounding/stats')).json.compliance;
    assert.equal(gq.kind, 'half');
    const { periodRange } = await import('../src/time.js');
    assert.equal(gq.items[gq.items.length - 1].start, periodRange('half', today).from);
    assert.deepEqual(periodRange('quarter', '2026-11-16'), { from: '2026-10-01', to: '2026-12-31' });
    assert.deepEqual(periodRange('half', '2026-05-02'), { from: '2026-01-01', to: '2026-06-30' });
    assert.equal((await api('GET', '/api/forms/grounding')).json.period.label, 'Semester ini');
  });

  test('kirim ulang dari antrean tanpa sinyal: uuid yang sama tidak tercatat dua kali', async () => {
    const ov = (await api('GET', '/api/forms/weighbridge', { as: 'tek' })).json;
    const sid = ov.subjects[0].id;
    const cl = (await api('GET', `/api/forms/weighbridge/checklist?subject_id=${sid}`, { as: 'tek' })).json.sections;
    const body = { client_uuid: '3f0e7a52-9c1d-4b6e-8f2a-5d7c9e1b0a44', subject_id: sid, record_date: today, signature_png: SIG, answers: fill(cl) };
    const a = await api('POST', '/api/forms/weighbridge/records', { as: 'tek', body });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    // HP mengirim lagi (jawaban pertama sempat masuk tapi sinyal putus sebelum balasan diterima)
    const b = await api('POST', '/api/forms/weighbridge/records', { as: 'tek', body });
    assert.ok([200, 201].includes(b.status), JSON.stringify(b.json));
    assert.equal(b.json.id, a.json.id);
    const n = (await db.query('SELECT count(*)::int AS n FROM form_records WHERE client_uuid = $1', [body.client_uuid])).rows[0].n;
    assert.equal(n, 1);
  });

  test('unduh rekap form: Excel / PDF / Word, hak akses dicek lagi saat diunduh', async () => {
    const get = async (path) => {
      const res = await fetch(base + path);
      return { status: res.status, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition'), buf: Buffer.from(await res.arrayBuffer()) };
    };
    const ExcelJS = (await import('exceljs')).default;
    for (const format of ['xlsx', 'pdf', 'docx']) {
      const t = await api('POST', '/api/forms/p2h_lv/export', { body: { format, from: (await import('../src/time.js')).addDays(today, -29), to: today } });
      assert.equal(t.status, 200, JSON.stringify(t.json));
      const f = await get(t.json.path);
      assert.equal(f.status, 200, f.buf.toString().slice(0, 200));
      assert.match(f.disp, new RegExp(`Rekap_.*\\.${format}`));
      assert.ok(f.buf.length > 1500);
      if (format === 'pdf') assert.equal(f.buf.subarray(0, 4).toString(), '%PDF');
      if (format === 'xlsx') {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(f.buf);
        assert.deepEqual(wb.worksheets.map((w) => w.name), ['Ringkasan', 'Isian', 'Temuan']);
        const isian = wb.getWorksheet('Isian');
        assert.equal(isian.getCell(5, 4).value, 'LV-012');
        const temuan = wb.getWorksheet('Temuan');
        const texts = [];
        temuan.eachRow((row) => texts.push(row.values.join('|')));
        assert.ok(texts.some((x) => x.includes('Semua rem / brake') && x.includes('STOP')), texts.join(' / '));
      }
    }
    // form tanpa isian tetap bisa diunduh (tabel kosong)
    const e = await api('POST', '/api/forms/oil_trap/export', { body: { format: 'pdf' } });
    assert.equal((await get(e.json.path)).status, 200);
    assert.equal((await api('POST', '/api/forms/p2h_lv/export', { body: { format: 'csv' } })).status, 422);
    // tiket dibuat, lalu akses dicabut sebelum diunduh -> ditolak
    const me = (await db.query(`SELECT id, name, role, site_id FROM users WHERE nrp = 'tek'`)).rows[0];
    const t2 = await api('POST', '/api/forms/p2h_lv/export', { as: 'tek', body: { format: 'xlsx' } });
    assert.equal(t2.status, 200);
    await db.query(`UPDATE users SET form_access = '{safety_device}' WHERE id = $1`, [me.id]);
    assert.equal((await get(t2.json.path)).status, 403);
    assert.equal((await api('POST', '/api/forms/p2h_lv/export', { as: 'tek', body: { format: 'xlsx' } })).status, 403);
    await db.query('UPDATE users SET form_access = NULL WHERE id = $1', [me.id]);
  });

  test('P2H Genset tetap utuh: tabel lama tidak tersentuh', async () => {
    const n = (await db.query('SELECT count(*)::int AS n FROM checklist_items')).rows[0].n;
    assert.equal(n, 30);
  });
});
