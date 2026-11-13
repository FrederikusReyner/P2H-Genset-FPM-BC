import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { idParam, parse } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { getSettings, saveSettings } from '../services/settings.js';
import { cancelPairing, listGroups, logoutGateway, setTarget, startPairing } from '../services/wa-gateway.js';
import { sendTestToGroup, whatsappStatus } from '../services/whatsapp.js';
import { hhmmToMinutes } from '../time.js';
import { loadChecklist } from './meta.js';

const r = Router();
r.use(requireAuth, requireRole('admin'));

/* ---------------- pengaturan ---------------- */

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'format jam HH:MM');

const SettingsIn = z.object({
  shift1_start: HHMM,
  shift2_start: HHMM,
  require_signature: z.boolean(),
  a_deadline_hours: z.number().int().min(1).max(72),
});

r.get('/settings', async (_req, res) => {
  res.json({ settings: await getSettings(true) });
});

r.put('/settings', async (req, res) => {
  const b = parse(SettingsIn, req.body);
  if (hhmmToMinutes(b.shift1_start) >= hhmmToMinutes(b.shift2_start)) {
    throw badRequest('Jam mulai Shift 1 harus lebih awal dari jam mulai Shift 2.');
  }
  await saveSettings(b);
  await audit(null, req.user, 'settings.update', 'settings', null, b);
  res.json({ settings: await getSettings(true) });
});

/* ---------------- kabar temuan ke grup WhatsApp ---------------- */

r.get('/whatsapp', (_req, res) => {
  res.json(whatsappStatus());
});

/** Mulai menautkan nomor pengirim: server menyiapkan kode QR, tampilan mengambilnya lewat GET /whatsapp. */
r.post('/whatsapp/connect', async (req, res) => {
  try {
    await startPairing();
  } catch (err) {
    throw badRequest(`Gagal menyiapkan tautan WhatsApp: ${err.message}`);
  }
  await audit(null, req.user, 'whatsapp.connect', 'settings', null);
  res.json(whatsappStatus());
});

/** Batal menautkan (QR ditutup sebelum di-scan). */
r.post('/whatsapp/cancel', async (_req, res) => {
  await cancelPairing();
  res.json(whatsappStatus());
});

/** Putuskan tautan dan hapus sesi WhatsApp dari database. */
r.post('/whatsapp/logout', async (req, res) => {
  const out = await logoutGateway();
  await audit(null, req.user, 'whatsapp.logout', 'settings', null, out);
  res.json({ ...whatsappStatus(), clean: out.clean });
});

/** Daftar grup yang diikuti nomor pengirim, untuk memilih grup tujuan. */
r.get('/whatsapp/groups', async (_req, res) => {
  try {
    res.json({ items: await listGroups() });
  } catch (err) {
    throw badRequest(`Gagal mengambil daftar grup: ${err.message}`);
  }
});

/** Pilih grup tujuan (id kosong = kosongkan). */
r.put('/whatsapp/group', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().trim().regex(/^[0-9-]+@g\.us$/, 'ID grup tidak dikenal.').nullable() }), req.body);
  let group;
  try {
    group = await setTarget(id);
  } catch (err) {
    throw badRequest(`Gagal memilih grup: ${err.message}`);
  }
  await audit(null, req.user, 'whatsapp.group', 'settings', null, { group: group?.name ?? null });
  res.json(whatsappStatus());
});

/** Kirim pesan percobaan ke grup tujuan. */
r.post('/whatsapp/test', async (req, res) => {
  const out = await sendTestToGroup(req.user.name);
  await audit(null, req.user, 'whatsapp.test', 'settings', null, { ok: out.ok });
  res.json(out);
});

/* ---------------- daftar cek ---------------- */

r.get('/checklist', async (_req, res) => {
  res.json({ sections: await loadChecklist(null, { includeInactive: true }) });
});

const ItemIn = z.object({
  section_code: z.string().min(1).max(40),
  text: z.string().trim().min(3).max(300),
  hint: z.string().trim().max(120).nullable().optional(),
  danger_code: z.enum(['AA', 'A']),
  is_active: z.boolean().optional(),
});

async function sectionId(c, code) {
  const s = (await c.query('SELECT id FROM checklist_sections WHERE code = $1', [code])).rows[0];
  if (!s) throw notFound('Bagian daftar cek tidak ditemukan.');
  return s.id;
}

r.post('/checklist/items', async (req, res) => {
  const b = parse(ItemIn, req.body);
  const item = await tx(async (c) => {
    const sid = await sectionId(c, b.section_code);
    const max = (await c.query('SELECT COALESCE(max(sort_order),0) AS m FROM checklist_items WHERE section_id = $1', [sid])).rows[0].m;
    const ins = await c.query(
      `INSERT INTO checklist_items (section_id, sort_order, text, hint, danger_code, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [sid, max + 1, b.text, b.hint || null, b.danger_code, b.is_active ?? true],
    );
    await audit(c, req.user, 'checklist.create', 'checklist_item', ins.rows[0].id, { text: b.text });
    return ins.rows[0];
  });
  res.status(201).json({ id: item.id });
});

r.put('/checklist/items/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(ItemIn, req.body);
  await tx(async (c) => {
    const sid = await sectionId(c, b.section_code);
    const u = await c.query(
      `UPDATE checklist_items SET section_id = $2, text = $3, hint = $4, danger_code = $5,
              is_active = COALESCE($6, is_active), updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, sid, b.text, b.hint || null, b.danger_code, b.is_active ?? null],
    );
    if (!u.rowCount) throw notFound('Butir cek tidak ditemukan.');
    await audit(c, req.user, 'checklist.update', 'checklist_item', id, { text: b.text, active: b.is_active });
  });
  res.json({ ok: true });
});

/** Geser butir naik / turun dalam bagiannya (tukar urutan dengan tetangganya). */
r.post('/checklist/items/:id/move', async (req, res) => {
  const id = idParam(req);
  const { dir } = parse(z.object({ dir: z.enum(['up', 'down']) }), req.body);
  await tx(async (c) => {
    const me = (await c.query('SELECT id, section_id FROM checklist_items WHERE id = $1', [id])).rows[0];
    if (!me) throw notFound('Butir cek tidak ditemukan.');
    // rapikan dulu: urutan 1,2,3,... tanpa lubang / kembar
    await c.query(
      `UPDATE checklist_items t SET sort_order = n.rn
         FROM (SELECT id, row_number() OVER (ORDER BY sort_order, id) AS rn
                 FROM checklist_items WHERE section_id = $1) n
        WHERE t.id = n.id`,
      [me.section_id],
    );
    const cur = (await c.query('SELECT sort_order FROM checklist_items WHERE id = $1', [id])).rows[0].sort_order;
    const other = dir === 'up' ? cur - 1 : cur + 1;
    const nb = (
      await c.query('SELECT id FROM checklist_items WHERE section_id = $1 AND sort_order = $2', [me.section_id, other])
    ).rows[0];
    if (!nb) return;
    await c.query('UPDATE checklist_items SET sort_order = $2 WHERE id = $1', [me.id, other]);
    await c.query('UPDATE checklist_items SET sort_order = $2 WHERE id = $1', [nb.id, cur]);
  });
  res.json({ ok: true });
});

/* ---------------- catatan aktivitas ---------------- */

r.get('/audit', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const { rows } = await query(
    `SELECT id, user_name, action, entity, entity_id, detail, created_at FROM audit_log ORDER BY id DESC LIMIT ${limit}`,
  );
  res.json({ items: rows });
});

export default r;
