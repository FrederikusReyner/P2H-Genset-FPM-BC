import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { query, tx } from './db.js';
import { migrate } from './migrate.js';
import { DEFAULT_SETTINGS } from './services/settings.js';

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(config.root, 'seed', name), 'utf8'));

// Urutan site sesuai permintaan: Binungan, Suaran, Gurimbang, Lati, Sambarata
const SITES = [
  { code: 'BMO', name: 'Binungan', job_site: 'BMO 1', sort_order: 1 },
  { code: 'SRN', name: 'Suaran', job_site: 'BMO 1', sort_order: 2 },
  { code: 'GMO', name: 'Gurimbang', job_site: 'GMO', sort_order: 3 },
  { code: 'LMO', name: 'Lati', job_site: 'LMO', sort_order: 4 },
  { code: 'SMO', name: 'Sambarata', job_site: 'SMO', sort_order: 5 },
];

async function flagDone(key) {
  const r = await query('SELECT 1 FROM settings WHERE key = $1', [key]);
  return r.rowCount > 0;
}
async function setFlag(client, key) {
  await client.query(
    `INSERT INTO settings (key, value) VALUES ($1, 'true'::jsonb) ON CONFLICT (key) DO NOTHING`,
    [key],
  );
}

async function seedSites(log) {
  for (const s of SITES) {
    await query(
      `INSERT INTO sites (code, name, job_site, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO NOTHING`,
      [s.code, s.name, s.job_site, s.sort_order],
    );
  }
  log('[seed] site siap');
}

async function seedChecklist(log) {
  if (await flagDone('_seeded_checklist')) return;
  const data = readJson('checklist.json');
  await tx(async (c) => {
    let sOrder = 0;
    for (const sec of data.sections) {
      sOrder += 1;
      const { rows } = await c.query(
        `INSERT INTO checklist_sections (code, title, sort_order) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
        [sec.code, sec.title, sOrder],
      );
      let iOrder = 0;
      for (const it of sec.items) {
        iOrder += 1;
        await c.query(
          `INSERT INTO checklist_items (section_id, sort_order, text, hint, danger_code) VALUES ($1,$2,$3,$4,$5)`,
          [rows[0].id, iOrder, it.text, it.hint || null, it.danger_code],
        );
      }
    }
    await setFlag(c, '_seeded_checklist');
  });
  log('[seed] daftar cek (30 butir) dimasukkan');
}

async function seedUnits(log) {
  if (await flagDone('_seeded_units')) return;
  const units = readJson('units.json');
  const { rows: sites } = await query('SELECT id, code FROM sites');
  const byCode = Object.fromEntries(sites.map((s) => [s.code, s.id]));
  await tx(async (c) => {
    let n = 0;
    for (const u of units) {
      const r = await c.query(
        `INSERT INTO units (code, old_code, site_id, location, brand, model, serial_no, engine_model,
                            capacity_kva, rated_kw, rated_voltage, rated_rpm, status, hm_master, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (lower(code)) DO NOTHING`,
        [
          u.code, u.old_code, byCode[u.site_code], u.location, u.brand, u.model, u.serial_no, u.engine_model,
          u.capacity_kva, u.rated_kw, u.rated_voltage, u.rated_rpm, u.status, u.hm_master, u.notes,
        ],
      );
      n += r.rowCount;
    }
    await setFlag(c, '_seeded_units');
    log(`[seed] ${n} unit genset dimasukkan`);
  });
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [
      key,
      JSON.stringify(value),
    ]);
  }
}

async function seedAdmin(log) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active`);
  if (rows[0].n > 0) return;
  const { nrp, password, name } = config.admin;
  if (!nrp || !password) {
    log('[seed] PERINGATAN: belum ada admin. Isi ADMIN_NRP dan ADMIN_PASSWORD di Environment Variables lalu restart.');
    return;
  }
  if (password.length < 8) {
    log('[seed] PERINGATAN: ADMIN_PASSWORD minimal 8 karakter. Admin belum dibuat.');
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (nrp, name, password_hash, role, must_change_password)
     VALUES ($1,$2,$3,'admin', false)
     ON CONFLICT (lower(nrp)) DO UPDATE SET role = 'admin', is_active = true, password_hash = EXCLUDED.password_hash`,
    [nrp, name, hash],
  );
  log(`[seed] akun admin "${nrp}" dibuat`);
}

export async function bootstrap(log = console.log) {
  await migrate(log);
  await seedSites(log);
  await seedSettings();
  await seedChecklist(log);
  await seedUnits(log);
  await seedAdmin(log);
}
