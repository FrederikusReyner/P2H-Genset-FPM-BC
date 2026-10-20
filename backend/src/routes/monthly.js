import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { notFound, unprocessable } from '../errors.js';
import { CAN_SIGN, requireAuth, requireRole, scopeOf } from '../middleware/auth.js';
import { numOrNull, parse } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { loadPmmrData } from '../services/pmmr/data.js';

const r = Router();
// halaman "Data bulanan" untuk pengawas, teknisi & pengawas, dan admin (hanya site-nya; admin semua site)
r.use(requireAuth, requireRole(...CAN_SIGN));

const Period = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/** HM awal / akhir (dari P2H atau data impor, hanya dibaca) dan kWh (bisa diisi) per unit untuk satu bulan. */
r.get('/', async (req, res) => {
  const { year, month } = parse(Period, req.query);
  const d = await loadPmmrData(req.user, year, month);
  const items = d.units
    .filter((u) => u.pmmr_group === 'produksi')
    .map((u) => ({
      id: u.id,
      code: u.code,
      old_code: u.old_code,
      site_id: u.site_id,
      site_code: u.site_code,
      site_name: u.site_name,
      brand: u.brand,
      model: u.model,
      status: u.status,
      hm_start: u.hm_month.start,
      hm_end: u.hm_month.end,
      hm_source: u.hm_month.source,
      kwh: u.kwh,
    }));
  res.json({ year, month, items });
});

const SaveIn = Period.extend({
  items: z.array(z.object({ unit_id: z.number().int(), kwh: numOrNull })).min(1).max(200),
});

/** Simpan kWh bulanan. kWh kosong = hapus isian bulan itu. */
r.put('/kwh', async (req, res) => {
  const b = parse(SaveIn, req.body);
  for (const it of b.items) {
    if (it.kwh !== null && (Number.isNaN(it.kwh) || it.kwh < 0 || it.kwh > 1e10)) throw unprocessable('kWh harus berupa angka nol atau lebih.');
  }
  const scope = scopeOf(req.user);
  const ids = [...new Set(b.items.map((i) => i.unit_id))];
  const found = (
    await query(
      `SELECT id FROM units WHERE id = ANY($1::int[]) AND pmmr_group = 'produksi'${scope != null ? ' AND site_id = $2' : ''}`,
      scope != null ? [ids, scope] : [ids],
    )
  ).rows.map((x) => x.id);
  if (found.length !== ids.length) throw notFound('Ada unit yang tidak ditemukan di site Anda.');

  await tx(async (c) => {
    for (const it of b.items) {
      if (it.kwh === null) {
        await c.query('DELETE FROM unit_kwh_monthly WHERE unit_id = $1 AND year = $2 AND month = $3', [it.unit_id, b.year, b.month]);
      } else {
        await c.query(
          `INSERT INTO unit_kwh_monthly (unit_id, year, month, kwh, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT (unit_id, year, month) DO UPDATE SET kwh = EXCLUDED.kwh, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [it.unit_id, b.year, b.month, it.kwh, req.user.id],
        );
      }
    }
    await audit(c, req.user, 'kwh.save', 'unit_kwh_monthly', `${b.year}-${b.month}`, { n: b.items.length });
  });
  res.json({ ok: true, saved: b.items.length });
});

export default r;
