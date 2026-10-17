// Mengisi database UJI COBA di komputer sendiri dengan contoh akun dan P2H 7 hari terakhir,
// supaya dashboard langsung terlihat ramai. Jalankan:  npm run demo
// (server API dan "npm run dev:db" harus sedang hidup). TIDAK akan jalan di database selain localhost.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, '..', '.env'));
} catch {
  /* tidak ada .env */
}

const dbUrl = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error('Berhenti: skrip contoh data hanya boleh dipakai di database localhost.');
  process.exit(1);
}

const BASE = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const SIG = fs.readFileSync(path.join(here, '..', 'tests', 'fixtures', 'signature-mekanik.txt'), 'utf8');
const SIG2 = fs.readFileSync(path.join(here, '..', 'tests', 'fixtures', 'signature-pengawas.txt'), 'utf8');
// foto contoh untuk butir rusak / perlu diperbaiki (foto kini wajib)
const PHOTOS = ['foto-a.jpg', 'foto-b.jpg'].map((n) => `data:image/jpeg;base64,${fs.readFileSync(path.join(here, '..', 'tests', 'fixtures', n)).toString('base64')}`);
const DEMO_PW = 'Demo12345';

async function api(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* */
  }
  return { status: res.status, json };
}

let seed = 20261017;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const NOTES = {
  AA: ['Oli rembes dari seal depan', 'Level oli di bawah minimum', 'Selang bahan bakar bocor di sambungan', 'Air radiator berkurang, ada rembesan', 'V-belt retak', 'Air cleaner tersumbat berat', 'Mufler berlubang, asap bocor'],
  A: ['Sirip radiator penyok', 'Baut mounting kendor', 'Terminal battery kotor / berkarat', 'Kabel grounding longgar', 'Lampu alarm redup', 'Sekring panel longgar', 'Lampu ruang genset mati', 'APAR tekanan kurang', 'Guarding fan radiator lepas', 'Oil trap penuh'],
};

const MTL = 'PT Mutiara Tanjung Lestari';
const BC = 'PT Berau Coal';
// admin dibuat otomatis dari .env. Tiga akun utama untuk mencoba tiap peran: admin, pengawas, teknisi.
const PEOPLE = [
  { nrp: 'teknisi', name: 'Teknisi Contoh', company: MTL, role: 'teknisi', site: 'Suaran', job_title: 'Electrician' },
  { nrp: 'pengawas', name: 'Pengawas Contoh', company: BC, role: 'pengawas', site: 'Suaran', job_title: 'Foreman' },
  { nrp: 'andi', name: 'Andi Prasetyo', company: MTL, role: 'teknisi', site: 'Suaran', job_title: 'Electrician' },
  { nrp: 'budi', name: 'Budi Santoso', company: MTL, role: 'teknisi', site: 'Binungan', job_title: 'Mekanik' },
  { nrp: 'citra', name: 'Citra Wulandari', company: MTL, role: 'teknisi', site: 'Gurimbang', job_title: 'Electrician' },
  { nrp: 'dedi', name: 'Dedi Kurniawan', company: MTL, role: 'teknisi', site: 'Lati', job_title: 'Mekanik' },
  { nrp: 'eko', name: 'Eko Setiawan', company: MTL, role: 'teknisi', site: 'Sambarata', job_title: 'Electrician' },
  { nrp: 'fajar', name: 'Fajar Nugroho', company: MTL, role: 'teknisi', site: 'Suaran', job_title: 'Mekanik' },
  { nrp: 'hendra', name: 'Hendra Gunawan', company: BC, role: 'pengawas', site: 'Binungan', job_title: 'Foreman' },
  { nrp: 'rina', name: 'Rina Marlina', company: BC, role: 'pengawas', site: 'Suaran', job_title: 'Supervisor' },
  { nrp: 'gunawan', name: 'Gunawan Hidayat', company: BC, role: 'pengawas', site: 'Gurimbang', job_title: 'Foreman' },
  { nrp: 'lukman', name: 'Lukman Hakim', company: BC, role: 'pengawas', site: 'Lati', job_title: 'Foreman' },
  { nrp: 'sari', name: 'Sari Wahyuni', company: BC, role: 'pengawas', site: 'Sambarata', job_title: 'Supervisor' },
];

// batas server: 15 percobaan masuk per menit -> kalau kena batas, tunggu lalu ulangi
async function login(nrp, password) {
  for (let i = 0; i < 6; i += 1) {
    const r = await api('POST', '/api/auth/login', null, { nrp, password });
    if (r.status !== 429) return r;
    console.log('  menunggu batas percobaan masuk (20 detik)…');
    await new Promise((res) => setTimeout(res, 20_000));
  }
  throw new Error('terlalu sering ditolak');
}

const admin = (await login(process.env.ADMIN_NRP || 'admin', process.env.ADMIN_PASSWORD || 'Admin12345')).json;
if (!admin?.token) {
  console.error('Tidak bisa masuk sebagai admin. Periksa ADMIN_NRP / ADMIN_PASSWORD di .env.');
  process.exit(1);
}
const meta = (await api('GET', '/api/meta', admin.token)).json;
const siteId = Object.fromEntries(meta.sites.map((s) => [s.name, s.id]));
const items = meta.checklist.flatMap((s) => s.items);

// ---- akun contoh ----
const tokens = {};
for (const p of PEOPLE) {
  let r = await login(p.nrp, DEMO_PW);
  if (r.status !== 200) {
    const c = await api('POST', '/api/users', admin.token, { nrp: p.nrp, name: p.name, role: p.role, site_id: p.site ? siteId[p.site] : null, company: p.company, job_title: p.job_title });
    if (c.status === 409) {
      const list = (await api('GET', '/api/users', admin.token)).json.items;
      const u = list.find((x) => x.nrp.toLowerCase() === p.nrp);
      const rs = await api('POST', `/api/users/${u.id}/reset-password`, admin.token);
      r = await login(p.nrp, rs.json.initial_password);
      await api('POST', '/api/auth/password', r.json.token, { current_password: rs.json.initial_password, new_password: DEMO_PW });
    } else {
      r = await login(p.nrp, c.json.initial_password);
      await api('POST', '/api/auth/password', r.json.token, { current_password: c.json.initial_password, new_password: DEMO_PW });
    }
    r = await login(p.nrp, DEMO_PW);
  }
  tokens[p.nrp] = r.json.token;
  await api('PUT', '/api/auth/signature', r.json.token, { signature_png: p.role === 'pengawas' ? SIG2 : SIG });
}
console.log('akun contoh siap (password semua: ' + DEMO_PW + ')');

// ---- P2H 7 hari ----
const units = (await api('GET', '/api/units', admin.token)).json;
const cur = units.shift;
const mechBySite = {};
for (const p of PEOPLE.filter((x) => x.role === 'teknisi')) (mechBySite[siteId[p.site]] ||= []).push(p);
const supBySite = {};
for (const p of PEOPLE.filter((x) => x.role === 'pengawas')) (supBySite[siteId[p.site]] ||= []).push(p);
const running = units.items.filter((u) => u.status === 'running');
const hm = Object.fromEntries(running.map((u) => [u.id, u.last_hm ?? 1000]));
let made = 0;
let dup = 0;
const formsOld = [];

for (let d = -6; d <= 0; d += 1) {
  const date = addDays(cur.shift_date, d);
  for (const shift of [1, 2]) {
    if (d === 0 && shift > cur.shift) continue;
    for (const u of running) {
      const isNow = d === 0 && shift === cur.shift;
      if (rnd() > (isNow ? 0.78 : 0.93)) continue; // sebagian belum / terlewat
      const who = pick(mechBySite[u.site_id] || mechBySite[siteId.Suaran]);
      const aaChance = 0.035;
      const aChance = 0.09;
      const answers = items.map((it) => {
        const r = rnd();
        if (it.danger_code === 'AA' && r < aaChance / 8) return { item_id: it.id, condition: rnd() < 0.7 ? 'rusak' : 'perbaiki', note: pick(NOTES.AA), photos: [pick(PHOTOS)] };
        if (it.danger_code === 'A' && r < aChance / 20) return { item_id: it.id, condition: rnd() < 0.6 ? 'rusak' : 'perbaiki', note: pick(NOTES.A), photos: [pick(PHOTOS)] };
        return { item_id: it.id, condition: 'baik', note: null };
      });
      const start = hm[u.id];
      const end = Math.round((start + 5 + rnd() * 7) * 10) / 10;
      hm[u.id] = end;
      const temp = 74 + Math.round(rnd() * 10);
      const body = {
        client_uuid: crypto.randomUUID(), unit_id: u.id, shift_date: date, shift,
        location: u.location, hm_start: Math.round(start * 10) / 10, hm_end: isNow ? null : end,
        params: {
          temp: { idle: 60 + Math.round(rnd() * 6), load: temp }, oil: { idle: 52 + Math.round(rnd() * 5), load: 60 + Math.round(rnd() * 6) },
          rpm: { idle: 1500, load: 1496 + Math.round(rnd() * 5) }, load: { idle: 0, load: Math.round((u.rated_kw ?? 800) * (0.3 + rnd() * 0.4)) },
          volt: { idle: u.rated_voltage ?? 400, load: (u.rated_voltage ?? 400) + Math.round(rnd() * 6 - 3) }, batt: { idle: 27 + Math.round(rnd() * 8) / 10, load: 28 + Math.round(rnd() * 6) / 10 },
        },
        answers, signature_png: SIG, notes: rnd() < 0.12 ? 'Kondisi normal, tidak ada kendala.' : null,
        filled_at: new Date(Date.now() - (-d * 24 + (cur.shift - shift) * 12 + rnd() * 2) * 3600_000).toISOString(),
      };
      const r = await api('POST', '/api/p2h', tokens[who.nrp], body);
      if (r.status === 201) {
        made += 1;
        if (!isNow) formsOld.push({ id: r.json.id, result: r.json.result, date, site_id: u.site_id });
      } else if (r.status === 409) dup += 1;
      else if (r.status !== 200) console.log('gagal', r.status, r.json?.error?.message);
    }
  }
}
console.log(`P2H dibuat: ${made} (sudah ada: ${dup})`);

// ---- tanda tangan pengawas (sekitar 70% P2H lama) & penutupan temuan lama ----
let signed = 0;
for (const f of formsOld) {
  if (rnd() < 0.7) {
    const sups = supBySite[f.site_id] || [];
    if (!sups.length) continue;
    const sup = sups[Math.floor(rnd() * sups.length)].nrp; // pengawas di site yang sama
    const r = await api('POST', `/api/p2h/${f.id}/verify`, tokens[sup], {});
    if (r.status === 200) signed += 1;
  }
}
const open = (await api('GET', '/api/findings?status=open&limit=300', admin.token)).json.items;
let closed = 0;
for (const f of open) {
  const ageDays = (Date.now() - new Date(f.first_seen_at || f.last_seen_at).getTime()) / 86400000;
  const fixer = tokens[(mechBySite[f.site_id] || [])[0]?.nrp] || tokens.budi; // teknisi di site temuan itu
  if (ageDays > 1.2 && rnd() < 0.8) {
    const r = await api('PATCH', `/api/findings/${f.id}`, fixer, { status: 'closed', note: pick(['Sudah diganti dan dites jalan', 'Dikencangkan, kondisi normal', 'Dibersihkan dan diperiksa ulang', 'Komponen diganti baru']) });
    if (r.status === 200) closed += 1;
  } else if (ageDays > 0.4 && rnd() < 0.35) {
    await api('PATCH', `/api/findings/${f.id}`, fixer, { status: 'in_progress', note: 'Sedang ditangani teknisi' });
  }
}
console.log(`ditandatangani pengawas: ${signed} · temuan lama ditutup: ${closed} · temuan masih terbuka: ${open.length - closed}`);
console.log('\nTiga akun untuk mencoba tiap peran: admin (semua site) / pengawas (site Suaran) / teknisi (site Suaran).');
console.log('Akun lain: andi, budi, citra, dedi, eko, fajar (teknisi); hendra, rina, gunawan, lukman, sari (pengawas, tiap site).');
console.log('Password contoh: ' + DEMO_PW + '   (admin: sesuai .env)');
