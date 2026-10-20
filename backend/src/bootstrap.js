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

// Kolom tambahan data unit dari Excel PMMR (nama kolom sama dengan kunci di seed/pmmr.json)
const PMMR_COLS = [
  'made_in', 'weight_kg', 'engine_serial_no', 'engine_hp', 'engine_rpm',
  'alt_brand', 'alt_made_in', 'alt_type', 'alt_serial_no', 'alt_phase', 'alt_freq', 'alt_base_kva', 'alt_base_kw',
  'alt_voltage', 'alt_ampere', 'alt_cos_phi', 'alt_rpm', 'alt_avr',
  'purchase_year', 'po_number', 'recommendation', 'remark', 'goh_total', 'goh_po_pi',
  'issue', 'sko_expiry', 'sko_note', 'bib_location',
];

/** Unit arsip yang kolom site-nya kosong di Excel: tebak dari tulisan lokasi (Lati bila tidak jelas). */
function siteFromLocation(loc) {
  const t = String(loc || '').toUpperCase();
  if (/BINUNGAN|BIB TO BIN/.test(t)) return 'BMO';
  if (/SUARAN/.test(t)) return 'SRN';
  if (/SAMBARATA/.test(t)) return 'SMO';
  if (/GURIMBANG/.test(t)) return 'GMO';
  return 'LMO';
}

/**
 * Data awal dari Excel PMMR (sekali saja): melengkapi 25 unit produksi, menambah unit arsip
 * (daftar "Breakdown & GOH", tidak ikut P2H), dan memasukkan HM bulanan yang sudah ada.
 * Berkasnya dibuat dari Excel PMMR dengan:  node scripts/make-pmmr-seed.mjs "<berkas.xlsx>"
 */
async function seedPmmr(log) {
  if (await flagDone('_seeded_pmmr')) return;
  if (!fs.existsSync(path.join(config.root, 'seed', 'pmmr.json'))) return;
  const data = readJson('pmmr.json');
  const { rows: sites } = await query('SELECT id, code FROM sites');
  const byCode = Object.fromEntries(sites.map((s) => [s.code, s.id]));
  await tx(async (c) => {
    let updated = 0;
    let added = 0;
    const idByCode = new Map();
    for (const u of data.units) {
      const found = (await c.query('SELECT id FROM units WHERE lower(code) = lower($1)', [u.code])).rows[0];
      const vals = PMMR_COLS.map((k) => u[k] ?? null);
      const goh = JSON.stringify(u.goh_history || []);
      if (found) {
        const n = PMMR_COLS.length;
        const sets = PMMR_COLS.map((k, i) => `${k} = $${i + 2}`).join(', ');
        await c.query(
          `UPDATE units SET ${sets}, goh_history = $${n + 2}::jsonb, pmmr_group = $${n + 3}, pmmr_sort = $${n + 4}, updated_at = now() WHERE id = $1`,
          [found.id, ...vals, goh, u.group, u.sort ?? null],
        );
        idByCode.set(u.code.toLowerCase(), found.id);
        updated += 1;
      } else if (u.group === 'arsip') {
        const cols = [
          'code', 'old_code', 'site_id', 'location', 'brand', 'model', 'serial_no', 'engine_model', 'capacity_kva', 'rated_kw',
          'rated_voltage', 'rated_rpm', 'status', 'hm_master', 'pmmr_group', 'pmmr_status', 'pmmr_sort', ...PMMR_COLS,
        ];
        const base = [
          u.code, u.old_code, byCode[u.site_code || siteFromLocation(u.location)], u.location, u.brand, u.model, u.serial_no, u.engine_model,
          u.capacity_kva, u.alt_base_kw, u.alt_voltage, u.engine_rpm ?? u.alt_rpm, 'inactive', u.hm, 'arsip', u.pmmr_status, u.sort ?? null,
        ];
        const all = [...base, ...vals];
        const ph = all.map((_, i) => `$${i + 1}`).join(',');
        const ins = await c.query(
          `INSERT INTO units (${cols.join(',')}, goh_history) VALUES (${ph}, $${all.length + 1}::jsonb) ON CONFLICT (lower(code)) DO NOTHING RETURNING id`,
          [...all, goh],
        );
        if (ins.rowCount) {
          idByCode.set(u.code.toLowerCase(), ins.rows[0].id);
          added += 1;
        }
      }
    }
    let hmN = 0;
    for (const h of data.hm_monthly || []) {
      let id = idByCode.get(h.code.toLowerCase());
      if (!id) id = (await c.query('SELECT id FROM units WHERE lower(code) = lower($1)', [h.code])).rows[0]?.id;
      if (!id) continue;
      const r = await c.query(
        `INSERT INTO unit_hm_monthly (unit_id, year, month, hm_start, hm_end, source) VALUES ($1,$2,$3,$4,$5,'import') ON CONFLICT DO NOTHING`,
        [id, h.year, h.month, h.hm_start, h.hm_end],
      );
      hmN += r.rowCount;
    }
    await setFlag(c, '_seeded_pmmr');
    log(`[seed] data PMMR: ${updated} unit dilengkapi, ${added} unit arsip ditambah, ${hmN} baris HM bulanan`);
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
  await seedPmmr(log);
  await seedAdmin(log);
}
