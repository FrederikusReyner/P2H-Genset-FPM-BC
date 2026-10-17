import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { CAN_FIX, requireAuth, requireRole, scopeOf } from '../middleware/auth.js';
import { idParam, parse } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { notifyEvent } from '../services/push.js';
import { getSettings } from '../services/settings.js';
import { plain } from '../text.js';

const r = Router();
r.use(requireAuth);

const KEY = `COALESCE(a.item_id::text, a.section_code || ':' || a.item_no::text)`;

/**
 * Temuan = butir cek yang rusak / perlu diperbaiki. Temuan yang sama di beberapa shift
 * digabung jadi satu baris ("times" = berapa kali dilaporkan).
 * Mengembalikan temuan yang MASIH TERBUKA (open / in_progress), terurut: STOP (AA) dulu, lalu yang paling lama.
 */
export const OPEN_FINDINGS_SQL = `
  WITH base AS (
    SELECT a.id, a.form_id, a.item_id, a.section_code, a.section_title, a.item_no, a.item_text, a.danger_code,
           a.condition, a.note, a.fix_status, a.fix_note,
           f.unit_id, f.unit_code, f.unit_brand, f.unit_model, f.site_id, f.site_name,
           f.shift_date, f.shift, f.inspector_name,
           COALESCE(f.filled_at, f.submitted_at) AS seen_at,
           ${KEY} AS item_key
      FROM p2h_answers a
      JOIN p2h_forms f ON f.id = a.form_id
     WHERE a.condition <> 'baik' AND a.fix_status <> 'closed'
  ),
  grp AS (
    SELECT DISTINCT ON (unit_id, item_key)
           base.*,
           count(*) OVER w AS times,
           min(seen_at) OVER w AS first_seen_at,
           bool_or(fix_status = 'in_progress') OVER w AS in_progress
      FROM base
    WINDOW w AS (PARTITION BY unit_id, item_key)
     ORDER BY unit_id, item_key, shift_date DESC, shift DESC, id DESC
  )
  SELECT g.id, g.form_id, g.item_id, g.section_code, g.section_title, g.item_no, g.item_text, g.danger_code,
         g.condition, g.note, g.unit_id, g.unit_code, g.unit_brand, g.unit_model, g.site_id, g.site_name,
         g.shift_date, g.shift, g.inspector_name, g.seen_at AS last_seen_at, g.first_seen_at,
         g.times::int AS times,
         CASE WHEN g.in_progress THEN 'in_progress' ELSE 'open' END AS status,
         EXISTS (
           SELECT 1 FROM p2h_answers a2 JOIN p2h_forms f2 ON f2.id = a2.form_id
            WHERE f2.unit_id = g.unit_id
              AND a2.condition = 'baik'
              AND (a2.item_id IS NOT DISTINCT FROM g.item_id)
              AND (a2.section_code = g.section_code AND a2.item_no = g.item_no OR g.item_id IS NOT NULL)
              AND (f2.shift_date, f2.shift) > (g.shift_date, g.shift)
         ) AS maybe_fixed,
         (SELECT COALESCE(array_agg(p.id::int ORDER BY p.id DESC), '{}'::int[])
            FROM p2h_photos p JOIN base b2 ON b2.id = p.answer_id
           WHERE b2.unit_id = g.unit_id AND b2.item_key = g.item_key) AS photo_ids
    FROM grp g`;

r.get('/', async (req, res) => {
  const status = ['open', 'closed'].includes(req.query.status) ? req.query.status : 'open';
  const scope = scopeOf(req.user); // teknisi / pengawas: hanya site-nya
  const siteId = scope != null ? scope : Number(req.query.site_id) || null;
  const unitId = Number(req.query.unit_id) || null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
  const settings = await getSettings();

  let rows;
  if (status === 'open') {
    const p = [];
    const f = [];
    if (siteId) { p.push(siteId); f.push(`site_id = $${p.length}`); }
    if (unitId) { p.push(unitId); f.push(`unit_id = $${p.length}`); }
    rows = (
      await query(
        `SELECT * FROM (${OPEN_FINDINGS_SQL}) x ${f.length ? `WHERE ${f.join(' AND ')}` : ''}
          ORDER BY (danger_code = 'AA') DESC, first_seen_at ASC LIMIT ${limit}`,
        p,
      )
    ).rows;
  } else {
    const p = [];
    const f = [];
    if (siteId) { p.push(siteId); f.push(`f.site_id = $${p.length}`); }
    if (unitId) { p.push(unitId); f.push(`f.unit_id = $${p.length}`); }
    rows = (
      await query(
        `SELECT * FROM (
           SELECT DISTINCT ON (f.unit_id, ${KEY}, a.fix_at)
                  a.id, a.form_id, a.item_id, a.section_code, a.section_title, a.item_no, a.item_text, a.danger_code,
                  a.condition, a.note, a.fix_note, a.fix_by_name, a.fix_at,
                  f.unit_id, f.unit_code, f.unit_brand, f.unit_model, f.site_id, f.site_name, f.shift_date, f.shift,
                  f.inspector_name, COALESCE(f.filled_at, f.submitted_at) AS last_seen_at,
                  'closed' AS status, 1 AS times, false AS maybe_fixed
             FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
            WHERE a.condition <> 'baik' AND a.fix_status = 'closed' ${f.length ? `AND ${f.join(' AND ')}` : ''}
            ORDER BY f.unit_id, ${KEY}, a.fix_at, f.shift_date DESC, f.shift DESC, a.id DESC
         ) x ORDER BY fix_at DESC NULLS LAST LIMIT ${limit}`,
        p,
      )
    ).rows;
  }

  const now = Date.now();
  const items = rows.map((x) => {
    const base = new Date(x.first_seen_at || x.last_seen_at).getTime();
    const dueAt = x.danger_code === 'A' ? new Date(base + settings.a_deadline_hours * 3600_000) : null;
    return {
      ...x,
      due_at: dueAt && x.status !== 'closed' ? dueAt.toISOString() : null,
      hours_open: x.status === 'closed' ? null : Math.max(0, Math.round(((now - base) / 3600_000) * 10) / 10),
      overdue: !!(dueAt && x.status !== 'closed' && dueAt.getTime() < now),
    };
  });
  res.json({ items });
});

const PatchIn = z.object({
  status: z.enum(['open', 'in_progress', 'closed']),
  note: z.string().trim().max(500).nullable().optional(),
});

/** Ubah status satu temuan (berlaku untuk semua laporan temuan yang sama pada unit itu). */
r.patch('/:id', requireRole(...CAN_FIX), async (req, res) => {
  const id = idParam(req);
  const b = parse(PatchIn, req.body);
  const note = (b.note || '').trim() || null;
  if (b.status === 'closed' && (!note || note.length < 3)) {
    throw unprocessable('Tulis singkat apa yang sudah diperbaiki (minimal 3 huruf).');
  }

  const info = await tx(async (c) => {
    const a = (
      await c.query(
        `SELECT a.id, a.item_id, a.section_code, a.item_no, a.item_text, a.danger_code, a.fix_status, a.condition,
                f.unit_id, f.unit_code, f.site_id, f.site_name, f.id AS form_id
           FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id WHERE a.id = $1`,
        [id],
      )
    ).rows[0];
    const scope = scopeOf(req.user);
    if (!a || a.condition === 'baik' || (scope != null && a.site_id !== scope)) throw notFound('Temuan tidak ditemukan.');
    if (a.fix_status === 'closed') throw conflict('Temuan ini sudah ditandai selesai.');

    const upd = await c.query(
      `UPDATE p2h_answers x
          SET fix_status = $1,
              fix_note = COALESCE($2, x.fix_note),
              fix_by = $3, fix_by_name = $4,
              fix_at = CASE WHEN $1 = 'closed' THEN now() ELSE NULL END
         FROM p2h_forms f
        WHERE f.id = x.form_id AND f.unit_id = $5
          AND x.condition <> 'baik' AND x.fix_status <> 'closed'
          AND (CASE WHEN $6::int IS NOT NULL THEN x.item_id = $6 ELSE (x.section_code = $7 AND x.item_no = $8) END)`,
      [b.status, note, req.user.id, req.user.name, a.unit_id, a.item_id, a.section_code, a.item_no],
    );
    await audit(c, req.user, `finding.${b.status}`, 'answer', id, { unit: a.unit_code, item: plain(a.item_text), n: upd.rowCount });

    let unitFree = false;
    if (b.status === 'closed') {
      const still = await c.query(
        `SELECT 1 FROM p2h_answers x JOIN p2h_forms f ON f.id = x.form_id
          WHERE f.unit_id = $1 AND x.condition <> 'baik' AND x.fix_status <> 'closed' AND x.danger_code = 'AA' LIMIT 1`,
        [a.unit_id],
      );
      unitFree = a.danger_code === 'AA' && !still.rowCount;
    }
    return { a, unitFree, changed: upd.rowCount };
  });

  if (b.status === 'closed') {
    const { a, unitFree } = info;
    notifyEvent({
      kind: 'finding_closed',
      severity: 'ok',
      isFinding: true,
      title: unitFree ? `Boleh jalan lagi · ${a.unit_code}` : `Temuan selesai · ${a.unit_code}`,
      body: `${a.site_name} · ${plain(a.item_text)} sudah diperbaiki oleh ${req.user.name}.${unitFree ? ' Tidak ada lagi temuan STOP.' : ''}`,
      siteId: a.site_id,
      unitId: a.unit_id,
      formId: a.form_id,
      actorUserId: req.user.id,
      path: '/temuan',
    }).catch((err) => console.error('[notif] gagal:', err.message));
  }
  res.json({ ok: true, changed: info.changed });
});

export default r;
