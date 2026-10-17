import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { CAN_FILL, CAN_SIGN, requireAuth, requireRole, scopeOf } from '../middleware/auth.js';
import { MAX_PHOTOS_PER_ITEM, assertPngDataUrl, decodePhoto, idParam, numOrNull, parse } from '../middleware/validate.js';
import { cleanParams, PARAMS } from '../params.js';
import { audit } from '../services/audit.js';
import { notifyEvent } from '../services/push.js';
import { getSettings } from '../services/settings.js';
import { plain } from '../text.js';
import { daysBetween, shiftLabel, wita } from '../time.js';
import { loadChecklist } from './meta.js';

const r = Router();
r.use(requireAuth);

const MAX_NEW_PHOTO_BYTES_PER_FORM = 12_000_000;

/* ---------- aturan isian ---------- */

const AnswerIn = z.object({
  item_id: z.number().int(),
  condition: z.enum(['baik', 'rusak', 'perbaiki']),
  note: z.string().trim().max(500).nullable().optional(),
  // foto baru (data URL). WAJIB minimal satu bila butir rusak / perlu diperbaiki
  photos: z.array(z.string()).max(MAX_PHOTOS_PER_ITEM).optional(),
  // saat mengubah P2H: foto lama yang tetap dipakai
  keep_photo_ids: z.array(z.number().int()).max(MAX_PHOTOS_PER_ITEM).optional(),
});

const FormBase = {
  location: z.string().trim().max(80).nullable().optional(),
  job_site: z.string().trim().max(60).nullable().optional(),
  hm_start: numOrNull.optional(),
  hm_end: numOrNull.optional(),
  params: z
    .record(z.string(), z.object({ idle: numOrNull.optional(), load: numOrNull.optional() }))
    .default({}),
  answers: z.array(AnswerIn).min(1).max(100),
  notes: z.string().trim().max(1500).nullable().optional(),
  signature_png: z.string().nullable().optional(),
  use_saved_signature: z.boolean().optional(),
  save_signature: z.boolean().optional(),
};

const FormCreate = z.object({
  client_uuid: z.string().uuid().optional(),
  unit_id: z.number().int(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.number().int().min(1).max(2),
  filled_at: z.string().datetime().optional(),
  ...FormBase,
});

const FormUpdate = z.object(FormBase);

function assertShiftDate(shiftDate) {
  const d = new Date(`${shiftDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== shiftDate) {
    throw unprocessable('Tanggal tidak valid.');
  }
  const today = wita().date;
  if (shiftDate > today) throw unprocessable('Tanggal shift tidak boleh di masa depan.');
  if (daysBetween(shiftDate, today) > 7) throw unprocessable('Tanggal shift terlalu lama (maksimal 7 hari ke belakang).');
}

function checkHm(b) {
  if (b.hm_start != null && b.hm_end != null && b.hm_end < b.hm_start) {
    throw unprocessable('HM akhir tidak boleh lebih kecil dari HM awal.');
  }
  for (const k of ['hm_start', 'hm_end']) {
    if (b[k] != null && (b[k] < 0 || b[k] > 9_999_999)) throw unprocessable('Angka HM tidak masuk akal.');
  }
}

function safeParams(input) {
  try {
    return cleanParams(input);
  } catch (e) {
    if (e instanceof RangeError) throw unprocessable(e.message);
    throw e;
  }
}

/**
 * Cocokkan jawaban dari HP dengan daftar cek yang aktif: harus lengkap, tanpa dobel,
 * catatan DAN foto wajib bila ada temuan.
 * existing: Map item_id -> Set id foto lama (hanya saat mengubah P2H).
 */
async function prepareAnswers(c, answersIn, existing = new Map()) {
  const checklist = await loadChecklist(c);
  const flat = [];
  for (const sec of checklist) {
    for (const it of sec.items) {
      if (it.is_active) flat.push({ ...it, section_code: sec.code, section_title: sec.title, section_order: sec.sort_order });
    }
  }
  const byId = new Map(flat.map((i) => [i.id, i]));
  const seen = new Set();
  const out = [];
  let newBytes = 0;
  for (const a of answersIn) {
    const it = byId.get(a.item_id);
    if (!it) throw unprocessable('Daftar cek sudah berubah. Tutup lalu buka lagi form P2H ini.');
    if (seen.has(a.item_id)) throw unprocessable('Ada butir cek yang terisi dua kali.');
    seen.add(a.item_id);
    const note = (a.note || '').trim() || null;
    let files = [];
    let keepIds = [];
    if (a.condition !== 'baik') {
      if (!note || note.length < 3) {
        throw unprocessable(`Butir "${plain(it.text)}" ditandai ${a.condition}: catatan wajib diisi.`);
      }
      const mine = existing.get(a.item_id) ?? new Set();
      keepIds = [...new Set(a.keep_photo_ids ?? [])].filter((id) => mine.has(id));
      files = (a.photos ?? []).map((p) => decodePhoto(p, `Foto butir "${plain(it.text)}"`));
      if (keepIds.length + files.length < 1) {
        throw new AppError(422, 'photo_required', `Butir "${plain(it.text)}" ditandai ${a.condition}: foto wajib dilampirkan.`, { item_id: a.item_id });
      }
      if (keepIds.length + files.length > MAX_PHOTOS_PER_ITEM) {
        throw unprocessable(`Butir "${plain(it.text)}": maksimal ${MAX_PHOTOS_PER_ITEM} foto.`);
      }
      newBytes += files.reduce((n, f) => n + f.buffer.length, 0);
    }
    out.push({ ...it, condition: a.condition, note: a.condition === 'baik' ? null : note, files, keepIds });
  }
  if (newBytes > MAX_NEW_PHOTO_BYTES_PER_FORM) throw unprocessable('Foto terlalu besar secara keseluruhan. Kurangi jumlah foto atau ambil ulang dengan ukuran lebih kecil.');
  const missing = flat.filter((i) => !seen.has(i.id));
  if (missing.length) throw unprocessable(`Masih ada ${missing.length} butir cek yang belum diisi.`);
  return out;
}

function summarize(answers) {
  let n_aa = 0;
  let n_a = 0;
  for (const a of answers) {
    if (a.condition === 'baik') continue;
    if (a.danger_code === 'AA') n_aa += 1;
    else n_a += 1;
  }
  const result = n_aa > 0 ? 'stop_aa' : n_a > 0 ? 'temuan_a' : 'baik';
  return { n_aa, n_a, result };
}

/** Simpan jawaban; mengembalikan Map item_id -> id jawaban (untuk menautkan foto). */
async function insertAnswers(c, formId, answers) {
  const cols = [
    'form_id', 'item_id', 'section_code', 'section_title', 'section_order', 'item_no', 'item_text', 'hint',
    'danger_code', 'condition', 'note', 'fix_status',
  ];
  const vals = [];
  const ph = [];
  answers.forEach((a, i) => {
    const base = i * cols.length;
    ph.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(',')})`);
    vals.push(
      formId, a.id, a.section_code, a.section_title, a.section_order, a.no, a.text, a.hint ?? null,
      a.danger_code, a.condition, a.note, a.condition === 'baik' ? null : 'open',
    );
  });
  const ids = new Map();
  if (answers.length) {
    const ins = await c.query(`INSERT INTO p2h_answers (${cols.join(',')}) VALUES ${ph.join(',')} RETURNING id, item_id`, vals);
    for (const row of ins.rows) ids.set(row.item_id, row.id);
  }
  return ids;
}

async function insertPhotos(c, formId, answerId, files, userId) {
  for (const f of files) {
    await c.query(
      `INSERT INTO p2h_photos (answer_id, form_id, mime, data, size, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [answerId, formId, f.mime, f.buffer, f.buffer.length, userId],
    );
  }
}

/* ---------- teks pemberitahuan ---------- */

function listItems(items, max = 2) {
  const names = items.map((a) => plain(a.item_text ?? a.text));
  const shown = names.slice(0, max).join('; ');
  return names.length > max ? `${shown}; +${names.length - max} lainnya` : shown;
}

function buildNotice(form, findings) {
  const where = `${form.site_name} · Shift ${shiftLabel(form.shift)}`;
  const aa = findings.filter((a) => a.danger_code === 'AA');
  const a = findings.filter((x) => x.danger_code === 'A');
  if (aa.length) {
    return {
      kind: 'p2h_stop',
      severity: 'danger',
      isFinding: true,
      title: `STOP OPERASI · ${form.unit_code}`,
      body: `${where} · ${listItems(aa)}. Jangan jalankan unit sebelum diperbaiki.`,
    };
  }
  if (a.length) {
    return {
      kind: 'p2h_finding',
      severity: 'warn',
      isFinding: true,
      title: `Ada temuan · ${form.unit_code}`,
      body: `${where} · ${a.length} temuan, perbaiki dalam 12 jam: ${listItems(a)}.`,
    };
  }
  return {
    kind: 'p2h_ok',
    severity: 'ok',
    isFinding: false,
    title: `P2H selesai · ${form.unit_code}`,
    body: `${where} · oleh ${form.inspector_name} · semua baik.`,
  };
}

function fireNotice(form, findings, actorUserId) {
  const n = buildNotice(form, findings);
  notifyEvent({
    ...n,
    siteId: form.site_id,
    unitId: form.unit_id,
    formId: form.id,
    actorUserId,
    path: `/p2h/${form.id}`,
  }).catch((err) => console.error('[notif] gagal:', err.message));
}

/* ---------- ambil satu form lengkap ---------- */

export async function loadForm(id) {
  const { rows } = await query(
    `SELECT f.*, u.rated_kw, u.rated_voltage, u.rated_rpm, u.capacity_kva
       FROM p2h_forms f LEFT JOIN units u ON u.id = f.unit_id WHERE f.id = $1`,
    [id],
  );
  const f = rows[0];
  if (!f) return null;
  const ans = (await query('SELECT * FROM p2h_answers WHERE form_id = $1 ORDER BY section_order, item_no', [id])).rows;
  const photos = (await query('SELECT id, answer_id, mime, size FROM p2h_photos WHERE form_id = $1 ORDER BY id', [id])).rows;
  const settings = await getSettings();
  const start = new Date(f.filled_at || f.submitted_at).getTime();
  const sections = [];
  for (const a of ans) {
    let s = sections.find((x) => x.code === a.section_code);
    if (!s) {
      s = { code: a.section_code, title: a.section_title, order: a.section_order, items: [] };
      sections.push(s);
    }
    s.items.push({
      ...a,
      photos: photos.filter((p) => p.answer_id === a.id).map(({ id: pid, mime, size }) => ({ id: pid, mime, size })),
      due_at:
        a.condition !== 'baik' && a.danger_code === 'A' && a.fix_status !== 'closed'
          ? new Date(start + settings.a_deadline_hours * 3600_000).toISOString()
          : null,
    });
  }
  const params = PARAMS.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    idle: f.params?.[p.key]?.idle ?? null,
    load: f.params?.[p.key]?.load ?? null,
  }));
  return { form: f, sections, params };
}

/** Isi foto (bytes) untuk PDF / Word / Excel: Map answer_id -> [{ id, mime, buffer }]. */
export async function loadFormPhotoFiles(formId) {
  const { rows } = await query('SELECT id, answer_id, mime, data FROM p2h_photos WHERE form_id = $1 ORDER BY id', [formId]);
  const map = new Map();
  for (const p of rows) {
    if (!map.has(p.answer_id)) map.set(p.answer_id, []);
    map.get(p.answer_id).push({ id: p.id, mime: p.mime, buffer: p.data });
  }
  return map;
}

const inScope = (user, siteId) => {
  const s = scopeOf(user);
  return s == null || s === siteId;
};

function permissionsFor(user, f) {
  const isAdmin = user.role === 'admin';
  const mine = inScope(user, f.site_id);
  return {
    can_edit: mine && (isAdmin || (CAN_FILL.includes(user.role) && f.user_id === user.id && !f.sup_signed_at)),
    can_sign: mine && CAN_SIGN.includes(user.role) && !f.sup_signed_at && (isAdmin || f.user_id !== user.id),
    can_unsign: isAdmin && !!f.sup_signed_at,
    can_delete: isAdmin,
  };
}

/* ---------- daftar (dipakai juga untuk unduhan rekap) ---------- */

const RESULTS = new Set(['baik', 'temuan_a', 'stop_aa']);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

export function buildListFilter(q, user) {
  const where = [];
  const p = [];
  const add = (sql, v) => {
    p.push(v);
    where.push(sql.replace('?', `$${p.length}`));
  };
  const int = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  // teknisi / pengawas: selalu terkunci ke site-nya, apa pun yang diminta
  const scope = user ? scopeOf(user) : null;
  if (scope != null) add('f.site_id = ?', scope);
  else if (q.site_id && int(q.site_id)) add('f.site_id = ?', int(q.site_id));
  if (q.unit_id && int(q.unit_id)) add('f.unit_id = ?', int(q.unit_id));
  if (q.from && isDate(q.from)) add('f.shift_date >= ?', String(q.from));
  if (q.to && isDate(q.to)) add('f.shift_date <= ?', String(q.to));
  if (q.shift && [1, 2].includes(Number(q.shift))) add('f.shift = ?', Number(q.shift));
  if (q.result && RESULTS.has(String(q.result))) add('f.result = ?', String(q.result));
  if (String(q.mine) === '1' && user) add('f.user_id = ?', user.id);
  if (String(q.unverified) === '1' || String(q.unsigned) === '1') where.push('f.sup_signed_at IS NULL');
  if (q.q) {
    p.push(`%${String(q.q).toLowerCase().slice(0, 60)}%`);
    const n = p.length;
    where.push(
      `(lower(f.unit_code) LIKE $${n} OR lower(coalesce(f.unit_old_code,'')) LIKE $${n} OR lower(f.inspector_name) LIKE $${n})`,
    );
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params: p };
}

export const LIST_COLS = `f.id, f.shift_date, f.shift, f.unit_id, f.unit_code, f.unit_old_code, f.unit_brand, f.unit_model,
  f.site_id, f.site_name, f.job_site, f.location, f.inspector_name, f.inspector_nrp, f.inspector_company, f.result, f.n_aa, f.n_a,
  f.hm_start, f.hm_end, COALESCE(f.filled_at, f.submitted_at) AS filled_at, f.submitted_at,
  (f.sup_signed_at IS NOT NULL) AS signed, (f.sup_signed_at IS NOT NULL) AS verified, f.sup_name, f.sup_signed_at, f.notes,
  (SELECT count(*)::int FROM p2h_photos ph WHERE ph.form_id = f.id) AS n_photos`;

r.get('/', async (req, res) => {
  const f = buildListFilter(req.query, req.user);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const [rows, total] = await Promise.all([
    query(
      `SELECT ${LIST_COLS} FROM p2h_forms f ${f.sql}
        ORDER BY f.shift_date DESC, f.shift DESC, f.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      f.params,
    ),
    query(`SELECT count(*)::int AS n FROM p2h_forms f ${f.sql}`, f.params),
  ]);
  res.json({ items: rows.rows, total: total.rows[0].n, limit, offset });
});

r.get('/:id', async (req, res) => {
  const id = idParam(req);
  const d = await loadForm(id);
  if (!d || !inScope(req.user, d.form.site_id)) throw notFound('P2H tidak ditemukan.');
  res.json({ ...d, permissions: permissionsFor(req.user, d.form) });
});

/* ---------- buat P2H baru ---------- */

r.post('/', requireRole(...CAN_FILL), async (req, res) => {
  const b = parse(FormCreate, req.body);
  assertShiftDate(b.shift_date);
  checkHm(b);
  const params = safeParams(b.params);
  const settings = await getSettings();

  let filledAt = null;
  if (b.filled_at) {
    const t = new Date(b.filled_at).getTime();
    const now = Date.now();
    if (t <= now + 10 * 60_000 && t >= now - 8 * 86400_000) filledAt = new Date(t).toISOString();
  }

  const out = await tx(async (c) => {
    // kiriman ulang dari HP (sinyal putus-nyambung): kembalikan yang sudah ada, jangan buat dobel
    if (b.client_uuid) {
      const ex = await c.query('SELECT id, result, n_aa, n_a FROM p2h_forms WHERE client_uuid = $1', [b.client_uuid]);
      if (ex.rowCount) return { ...ex.rows[0], duplicate: true };
    }

    const u = (
      await c.query(
        `SELECT u.*, s.name AS site_name, s.job_site AS site_job_site
           FROM units u JOIN sites s ON s.id = u.site_id WHERE u.id = $1`,
        [b.unit_id],
      )
    ).rows[0];
    if (!u) throw notFound('Unit genset tidak ditemukan.');
    if (!inScope(req.user, u.site_id)) throw forbidden('Genset ini bukan di site Anda.');
    if (u.status === 'inactive') throw unprocessable('Unit ini berstatus tidak aktif.');

    const answers = await prepareAnswers(c, b.answers);
    const sum = summarize(answers);

    const me = (await c.query('SELECT name, nrp, company, signature_png FROM users WHERE id = $1', [req.user.id])).rows[0];
    let sig = b.signature_png || null;
    if (!sig && b.use_saved_signature) sig = me.signature_png || null;
    if (!sig && settings.require_signature) throw unprocessable('Tanda tangan wajib diisi.');
    if (sig) assertPngDataUrl(sig);
    if (b.save_signature && b.signature_png) {
      await c.query('UPDATE users SET signature_png = $1, updated_at = now() WHERE id = $2', [b.signature_png, req.user.id]);
    }

    const ins = await c.query(
      `INSERT INTO p2h_forms
         (client_uuid, unit_id, site_id, shift_date, shift, user_id, inspector_name, inspector_nrp, inspector_company,
          unit_code, unit_old_code, unit_brand, unit_model, site_name, job_site, location,
          hm_start, hm_end, params, notes, signature_png, result, n_aa, n_a, filled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        b.client_uuid ?? null, u.id, u.site_id, b.shift_date, b.shift, req.user.id, me.name, me.nrp, me.company,
        u.code, u.old_code, u.brand, u.model, u.site_name,
        (b.job_site || u.job_site || u.site_job_site || null),
        (b.location || u.location || null),
        b.hm_start ?? null, b.hm_end ?? null, JSON.stringify(params), b.notes || null, sig,
        sum.result, sum.n_aa, sum.n_a, filledAt,
      ],
    );
    if (!ins.rowCount) {
      const ex = await c.query(
        `SELECT f.id, f.inspector_name, f.shift_date, f.shift FROM p2h_forms f
          WHERE f.unit_id = $1 AND f.shift_date = $2 AND f.shift = $3`,
        [u.id, b.shift_date, b.shift],
      );
      const e = ex.rows[0];
      throw conflict(
        e
          ? `${u.code} sudah di-P2H untuk Shift ${shiftLabel(b.shift)} tanggal ${b.shift_date} oleh ${e.inspector_name}.`
          : 'P2H ini sudah pernah dikirim.',
        { existing_form_id: e?.id ?? null },
      );
    }
    const formId = ins.rows[0].id;
    const ids = await insertAnswers(c, formId, answers);
    for (const a of answers) if (a.files.length) await insertPhotos(c, formId, ids.get(a.id), a.files, req.user.id);
    await audit(c, req.user, 'p2h.create', 'p2h', formId, { unit: u.code, result: sum.result });

    return {
      id: formId,
      ...sum,
      duplicate: false,
      _notice: {
        form: {
          id: formId, unit_id: u.id, site_id: u.site_id, unit_code: u.code, site_name: u.site_name,
          shift: b.shift, inspector_name: me.name,
        },
        findings: answers.filter((a) => a.condition !== 'baik').map((a) => ({ danger_code: a.danger_code, item_text: a.text })),
      },
    };
  });

  if (out._notice) {
    fireNotice(out._notice.form, out._notice.findings, req.user.id);
    delete out._notice;
  }
  res.status(out.duplicate ? 200 : 201).json(out);
});

/* ---------- ubah P2H (mis. mengisi HM akhir, memperbaiki salah ketik) ---------- */

r.put('/:id', requireRole(...CAN_FILL), async (req, res) => {
  const id = idParam(req);
  const b = parse(FormUpdate, req.body);
  checkHm(b);
  const params = safeParams(b.params);
  const settings = await getSettings();

  const out = await tx(async (c) => {
    const f = (await c.query('SELECT * FROM p2h_forms WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!f || !inScope(req.user, f.site_id)) throw notFound('P2H tidak ditemukan.');
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (f.user_id !== req.user.id) throw forbidden('Hanya pembuat P2H (atau admin) yang boleh mengubahnya.');
      if (f.sup_signed_at) throw forbidden('P2H ini sudah terverifikasi pengawas, jadi tidak bisa diubah. Hubungi admin.');
    }

    // foto yang sudah ada, per butir (untuk dipertahankan / diganti)
    const prev = (await c.query('SELECT id, item_id, condition FROM p2h_answers WHERE form_id = $1', [id])).rows;
    const prevPhotos = (await c.query('SELECT id, answer_id FROM p2h_photos WHERE form_id = $1', [id])).rows;
    const answerIdByItem = new Map(prev.filter((x) => x.item_id != null).map((x) => [x.item_id, x.id]));
    const existing = new Map();
    for (const [itemId, ansId] of answerIdByItem) existing.set(itemId, new Set(prevPhotos.filter((p) => p.answer_id === ansId).map((p) => p.id)));

    const answers = await prepareAnswers(c, b.answers, existing);
    const prevCond = new Map(prev.filter((x) => x.item_id != null).map((x) => [x.item_id, x.condition]));

    for (const a of answers) {
      let ansId = answerIdByItem.get(a.id);
      if (ansId) {
        await c.query(
          `UPDATE p2h_answers SET condition = $3, note = $4,
             fix_status = CASE WHEN $3 = 'baik' THEN NULL WHEN condition = 'baik' THEN 'open' ELSE fix_status END,
             fix_note   = CASE WHEN $3 = 'baik' THEN NULL ELSE fix_note END,
             fix_by     = CASE WHEN $3 = 'baik' THEN NULL ELSE fix_by END,
             fix_by_name= CASE WHEN $3 = 'baik' THEN NULL ELSE fix_by_name END,
             fix_at     = CASE WHEN $3 = 'baik' THEN NULL ELSE fix_at END
           WHERE form_id = $1 AND item_id = $2`,
          [id, a.id, a.condition, a.note],
        );
      } else {
        ansId = (await insertAnswers(c, id, [a])).get(a.id);
      }
      // foto: buang yang tidak dipertahankan, lalu tambahkan yang baru
      await c.query('DELETE FROM p2h_photos WHERE answer_id = $1 AND NOT (id = ANY($2::bigint[]))', [ansId, a.keepIds]);
      if (a.files.length) await insertPhotos(c, id, ansId, a.files, req.user.id);
    }

    const tot = (
      await c.query(
        `SELECT count(*) FILTER (WHERE condition <> 'baik' AND danger_code = 'AA')::int AS n_aa,
                count(*) FILTER (WHERE condition <> 'baik' AND danger_code = 'A')::int AS n_a
           FROM p2h_answers WHERE form_id = $1`,
        [id],
      )
    ).rows[0];
    const result = tot.n_aa > 0 ? 'stop_aa' : tot.n_a > 0 ? 'temuan_a' : 'baik';

    let sig = f.signature_png;
    if (b.signature_png) {
      assertPngDataUrl(b.signature_png);
      sig = b.signature_png;
      if (b.save_signature) await c.query('UPDATE users SET signature_png = $1, updated_at = now() WHERE id = $2', [sig, req.user.id]);
    } else if (b.use_saved_signature && !sig) {
      sig = (await c.query('SELECT signature_png FROM users WHERE id = $1', [req.user.id])).rows[0]?.signature_png || null;
    }
    if (!sig && settings.require_signature) throw unprocessable('Tanda tangan wajib diisi.');

    await c.query(
      `UPDATE p2h_forms SET location = $2, job_site = $3, hm_start = $4, hm_end = $5, params = $6::jsonb, notes = $7,
              signature_png = $8, result = $9, n_aa = $10, n_a = $11, edited_at = now(), edited_by_name = $12
        WHERE id = $1`,
      [
        id, b.location || f.location, b.job_site || f.job_site, b.hm_start ?? null, b.hm_end ?? null,
        JSON.stringify(params), b.notes || null, sig, result, tot.n_aa, tot.n_a, req.user.name,
      ],
    );
    await audit(c, req.user, 'p2h.update', 'p2h', id, { result });

    // temuan baru (sebelumnya baik / belum ada) -> beri tahu
    const fresh = answers.filter((a) => a.condition !== 'baik' && (prevCond.get(a.id) ?? 'baik') === 'baik');
    return {
      id, result, n_aa: tot.n_aa, n_a: tot.n_a,
      _notice: fresh.length
        ? {
            form: { id, unit_id: f.unit_id, site_id: f.site_id, unit_code: f.unit_code, site_name: f.site_name, shift: f.shift, inspector_name: f.inspector_name },
            findings: fresh.map((a) => ({ danger_code: a.danger_code, item_text: a.text })),
          }
        : null,
    };
  });

  if (out._notice) fireNotice(out._notice.form, out._notice.findings, req.user.id);
  delete out._notice;
  res.json(out);
});

/* ---------- verifikasi pengawas (tanda tangan pengawas) ---------- */

const SignIn = z.object({
  signature_png: z.string().nullable().optional(),
  save_signature: z.boolean().optional(),
});

/**
 * Pengawas memeriksa P2H lalu menandatanganinya. Baru setelah itu P2H berstatus "Terverifikasi".
 * Hanya pengawas di site yang sama (atau admin). Tidak boleh memverifikasi P2H yang diisinya sendiri.
 */
async function verifyHandler(req, res) {
  const id = idParam(req);
  const b = parse(SignIn, req.body);
  await tx(async (c) => {
    const f = (await c.query('SELECT id, user_id, site_id, sup_signed_at FROM p2h_forms WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!f || !inScope(req.user, f.site_id)) throw notFound('P2H tidak ditemukan.');
    if (f.sup_signed_at) throw conflict('P2H ini sudah terverifikasi pengawas.');
    if (f.user_id === req.user.id && req.user.role !== 'admin') {
      throw forbidden('Anda tidak bisa memverifikasi P2H yang Anda isi sendiri. Minta pengawas lain.');
    }
    const me = (await c.query('SELECT name, nrp, company, signature_png FROM users WHERE id = $1', [req.user.id])).rows[0];
    const sig = b.signature_png || me.signature_png;
    if (!sig) throw unprocessable('Gambar tanda tangan Anda dulu.');
    assertPngDataUrl(sig);
    if (b.save_signature && b.signature_png) {
      await c.query('UPDATE users SET signature_png = $1, updated_at = now() WHERE id = $2', [sig, req.user.id]);
    }
    await c.query(
      `UPDATE p2h_forms SET sup_user_id = $1, sup_name = $2, sup_nrp = $3, sup_company = $4, sup_signature_png = $5, sup_signed_at = now()
        WHERE id = $6`,
      [req.user.id, me.name, me.nrp, me.company, sig, id],
    );
    await audit(c, req.user, 'p2h.verify', 'p2h', id);
  });
  res.json({ ok: true });
}
r.post('/:id/verify', requireRole(...CAN_SIGN), verifyHandler);
r.post('/:id/sign', requireRole(...CAN_SIGN), verifyHandler); // nama lama, tetap dilayani

async function unverifyHandler(req, res) {
  const id = idParam(req);
  const u = await query(
    `UPDATE p2h_forms SET sup_user_id = NULL, sup_name = NULL, sup_nrp = NULL, sup_company = NULL, sup_signature_png = NULL, sup_signed_at = NULL
      WHERE id = $1 RETURNING id`,
    [id],
  );
  if (!u.rowCount) throw notFound('P2H tidak ditemukan.');
  await audit(null, req.user, 'p2h.unverify', 'p2h', id);
  res.json({ ok: true });
}
r.delete('/:id/verify', requireRole('admin'), unverifyHandler);
r.delete('/:id/sign', requireRole('admin'), unverifyHandler);

/* ---------- hapus (hanya admin, mis. data uji coba) ---------- */

r.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = idParam(req);
  const d = await query('DELETE FROM p2h_forms WHERE id = $1 RETURNING unit_code, shift_date, shift', [id]);
  if (!d.rowCount) throw notFound('P2H tidak ditemukan.');
  await audit(null, req.user, 'p2h.delete', 'p2h', id, d.rows[0]);
  res.json({ ok: true });
});

export default r;
