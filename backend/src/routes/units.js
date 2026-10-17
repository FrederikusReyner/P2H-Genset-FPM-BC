import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { requireAuth, requireRole, scopeOf } from '../middleware/auth.js';
import { idParam, numOrNull, parse } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { currentShift } from '../time.js';

const r = Router();
r.use(requireAuth);

/** Kunci butir cek yang sama walau daftar cek diubah nomornya. */
export const ITEM_KEY = `COALESCE(a.item_id::text, a.section_code || ':' || a.item_no::text)`;

const LIST_SQL = `
  SELECT u.*, s.code AS site_code, s.name AS site_name, s.job_site AS site_job_site,
         lf.id AS last_form_id, lf.shift_date AS last_shift_date, lf.shift AS last_shift,
         lf.hm_start AS last_hm_start, lf.hm_end AS last_hm_end, lf.result AS last_result,
         cf.id AS current_form_id, cf.result AS current_result,
         COALESCE(oc.open_aa, 0)::int AS open_aa, COALESCE(oc.open_a, 0)::int AS open_a
    FROM units u
    JOIN sites s ON s.id = u.site_id
    LEFT JOIN LATERAL (
      SELECT id, shift_date, shift, hm_start, hm_end, result
        FROM p2h_forms f WHERE f.unit_id = u.id
       ORDER BY f.shift_date DESC, f.shift DESC, f.id DESC LIMIT 1
    ) lf ON true
    LEFT JOIN p2h_forms cf ON cf.unit_id = u.id AND cf.shift_date = $1 AND cf.shift = $2
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT ${ITEM_KEY}) FILTER (WHERE a.danger_code = 'AA') AS open_aa,
             count(DISTINCT ${ITEM_KEY}) FILTER (WHERE a.danger_code = 'A') AS open_a
        FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
       WHERE f.unit_id = u.id AND a.condition <> 'baik' AND a.fix_status <> 'closed'
    ) oc ON true`;

r.get('/', async (req, res) => {
  const settings = await getSettings();
  const cur = currentShift(new Date(), settings.shift1_start, settings.shift2_start);
  // teknisi / pengawas hanya melihat genset di site-nya
  const scope = scopeOf(req.user);
  const rows = (
    await query(
      `${LIST_SQL} ${scope != null ? 'WHERE u.site_id = $3' : ''} ORDER BY s.sort_order, u.code`,
      scope != null ? [cur.shift_date, cur.shift, scope] : [cur.shift_date, cur.shift],
    )
  ).rows;
  const items = rows.map((u) => ({
    ...u,
    // hour meter terakhir yang diketahui: HM akhir / awal form terakhir, kalau belum ada pakai data PMMR
    last_hm: u.last_hm_end ?? u.last_hm_start ?? u.hm_master ?? null,
  }));
  res.json({ items, shift: cur });
});

const UnitIn = z.object({
  code: z.string().trim().min(2).max(40),
  old_code: z.string().trim().max(40).nullable().optional(),
  site_id: z.number().int(),
  location: z.string().trim().max(80).nullable().optional(),
  job_site: z.string().trim().max(60).nullable().optional(),
  brand: z.string().trim().max(60).nullable().optional(),
  model: z.string().trim().max(60).nullable().optional(),
  serial_no: z.string().trim().max(60).nullable().optional(),
  engine_model: z.string().trim().max(60).nullable().optional(),
  capacity_kva: numOrNull.optional(),
  rated_kw: numOrNull.optional(),
  rated_voltage: numOrNull.optional(),
  rated_rpm: numOrNull.optional(),
  status: z.enum(['running', 'standby', 'breakdown', 'inactive']),
  hm_master: numOrNull.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const blank = (v) => (v === undefined || v === '' ? null : v);
const COLS = [
  'code', 'old_code', 'site_id', 'location', 'job_site', 'brand', 'model', 'serial_no', 'engine_model',
  'capacity_kva', 'rated_kw', 'rated_voltage', 'rated_rpm', 'status', 'hm_master', 'notes',
];

r.post('/', requireRole('admin'), async (req, res) => {
  const b = parse(UnitIn, req.body);
  const dup = await query('SELECT id FROM units WHERE lower(code) = lower($1)', [b.code]);
  if (dup.rowCount) throw conflict(`Kode unit "${b.code}" sudah dipakai.`);
  const vals = COLS.map((c) => blank(b[c]));
  const ph = COLS.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(`INSERT INTO units (${COLS.join(',')}) VALUES (${ph}) RETURNING *`, vals);
  await audit(null, req.user, 'unit.create', 'unit', rows[0].id, { code: b.code });
  res.status(201).json({ item: rows[0] });
});

r.put('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req);
  const b = parse(UnitIn, req.body);
  const dup = await query('SELECT id FROM units WHERE lower(code) = lower($1) AND id <> $2', [b.code, id]);
  if (dup.rowCount) throw conflict(`Kode unit "${b.code}" sudah dipakai unit lain.`);
  const sets = COLS.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const { rows } = await query(
    `UPDATE units SET ${sets}, updated_at = now() WHERE id = $${COLS.length + 1} RETURNING *`,
    [...COLS.map((c) => blank(b[c])), id],
  );
  if (!rows[0]) throw notFound('Unit tidak ditemukan.');
  await audit(null, req.user, 'unit.update', 'unit', id, { code: b.code, status: b.status });
  res.json({ item: rows[0] });
});

r.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req);
  const used = await query('SELECT 1 FROM p2h_forms WHERE unit_id = $1 LIMIT 1', [id]);
  if (used.rowCount) {
    throw conflict('Unit ini sudah punya riwayat P2H, jadi tidak bisa dihapus. Ubah statusnya menjadi "Tidak aktif" saja.');
  }
  const del = await query('DELETE FROM units WHERE id = $1 RETURNING code', [id]);
  if (!del.rowCount) throw notFound('Unit tidak ditemukan.');
  await audit(null, req.user, 'unit.delete', 'unit', id, { code: del.rows[0].code });
  res.json({ ok: true });
});

export default r;
