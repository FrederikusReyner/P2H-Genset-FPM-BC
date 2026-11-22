import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { CAN_FILL, CAN_FIX, CAN_SIGN, canUseForm, requireAuth, requireRole, scopeOf } from '../middleware/auth.js';
import { MAX_PHOTOS_PER_ITEM, assertPngDataUrl, decodePhoto, idParam, parse } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { notifyFixed, notifyRecord, notifyShiftActivity, notifyVerified } from '../services/form-notify.js';
import { getSettings } from '../services/settings.js';
import { listGroups } from '../services/wa-gateway.js';
import { formStats } from '../forms/stats.js';
import { plain } from '../text.js';
import { addDays, currentShift, daysBetween, periodRange, shiftLabel, wita } from '../time.js';

/*
 * Form digital serbaguna: tools & equipment, arus motor, safety device, metal catcher, grounding, panel, dll.
 * Alurnya sama dengan P2H Genset: teknisi mengisi -> pengawas memverifikasi -> temuan dipantau sampai ditutup.
 * Semua alamat di bawah /api/forms. Jenis form dipilih lewat kodenya (mis. /api/forms/safety_device/records).
 */

const r = Router();
// dapat diganti saat uji (tanpa WhatsApp sungguhan)
let waGroups = listGroups;
export const __setWaGroupsForTest = (fn) => {
  waGroups = fn ?? listGroups;
};
const MAX_NEW_PHOTO_BYTES = 12_000_000;
const MAX_BACKDATE_DAYS = 31;

/* ---------- foto (dipasang sebelum requireAuth umum karena butuh cek site sendiri) ---------- */

r.get('/photos/:id', requireAuth, async (req, res) => {
  const id = idParam(req);
  const { rows } = await query(
    'SELECT p.mime, p.data, f.site_id, t.code FROM form_photos p JOIN form_records f ON f.id = p.record_id JOIN form_types t ON t.id = f.form_type_id WHERE p.id = $1',
    [id],
  );
  const p = rows[0];
  const scope = scopeOf(req.user);
  if (!p || (scope != null && p.site_id !== scope) || !canUseForm(req.user, p.code)) throw notFound('Foto tidak ditemukan.');
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Content-Length', p.data.length);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(p.data);
});

r.use(requireAuth);

// hak akses per akun: hanya form yang diizinkan admin (admin sendiri boleh semua)
r.param('code', (req, _res, next, code) => {
  if (!canUseForm(req.user, String(code))) return next(forbidden('Akun Anda tidak diberi akses ke form ini. Hubungi admin.'));
  next();
});

/* ---------- bantuan ---------- */

const inScope = (user, siteId) => {
  const s = scopeOf(user);
  return s == null || s === siteId;
};

const TYPE_COLS = `id, code, name, short_name, description, icon, period, subject_label, header_fields, fix_hours, photo_required,
  filler_label, verifier_label, doc_no, is_active, sort_order, wa_findings, wa_verify, wa_group_id, wa_group_name`;

async function getType(code, db = { query }) {
  const { rows } = await db.query(`SELECT ${TYPE_COLS} FROM form_types WHERE code = $1`, [String(code)]);
  if (!rows[0]) throw notFound('Jenis form tidak ditemukan.');
  return rows[0];
}

/** Rentang periode yang sedang berjalan (untuk "sudah diisi periode ini?"). null = tidak dipantau. */
function currentPeriod(period, settings) {
  const now = new Date();
  if (period === 'shift') {
    const s = currentShift(now, settings.shift1_start, settings.shift2_start);
    return { from: s.shift_date, to: s.shift_date, shift: s.shift, label: `Shift ${shiftLabel(s.shift)}` };
  }
  const today = wita(now).date;
  if (period === 'day') return { from: today, to: today, shift: 0, label: 'Hari ini' };
  if (period === 'week') return { ...periodRange('week', today), shift: 0, label: 'Minggu ini' };
  if (period === 'biweek') return { ...periodRange('biweek', today), shift: 0, label: '2 minggu ini' };
  if (period === 'month') return { ...periodRange('month', today), shift: 0, label: 'Bulan ini' };
  if (period === 'quarter') return { ...periodRange('quarter', today), shift: 0, label: 'Kuartal ini' };
  if (period === 'half') return { ...periodRange('half', today), shift: 0, label: 'Semester ini' };
  return null;
}

const ITEM_COLS = `id, section_id, sort_order, label, text, spec, kind, severity, good_label, bad_label, input_type, fields, unit,
  min_value, max_value, required, needs_photo, is_active`;

/** Daftar cek untuk satu objek: bagian umum + bagian khusus objek itu. */
async function loadChecklist(db, typeId, subjectId, { all = false } = {}) {
  const secs = (
    await db.query(
      `SELECT id, subject_id, title, note, sort_order FROM form_sections
        WHERE form_type_id = $1 AND (subject_id IS NULL OR subject_id = $2)
        ORDER BY (subject_id IS NOT NULL), sort_order, id`,
      [typeId, subjectId ?? null],
    )
  ).rows;
  if (!secs.length) return [];
  const items = (
    await db.query(
      `SELECT ${ITEM_COLS} FROM form_items WHERE section_id = ANY($1::int[]) ${all ? '' : 'AND is_active'} ORDER BY sort_order, id`,
      [secs.map((s) => s.id)],
    )
  ).rows;
  return secs.map((s) => ({ ...s, items: items.filter((i) => i.section_id === s.id) }));
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
const outOfRange = (n, it) => n != null && ((it.min_value != null && n < it.min_value) || (it.max_value != null && n > it.max_value));

/** Isian kepala form: hanya kunci yang dikenal, dicek jenisnya. */
function cleanHeader(type, input) {
  const out = {};
  for (const f of type.header_fields || []) {
    const raw = input?.[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const v = String(raw).trim().slice(0, f.type === 'textarea' ? 1500 : 200);
    if (f.type === 'date' && !isDate(v)) throw unprocessable(`${f.label}: tanggal tidak valid.`);
    if (f.type === 'number') {
      const n = toNum(v);
      if (Number.isNaN(n)) throw unprocessable(`${f.label}: isi dengan angka.`);
      out[f.key] = n;
      continue;
    }
    if (f.type === 'select' && Array.isArray(f.options) && !f.options.includes(v)) throw unprocessable(`${f.label}: pilihan tidak dikenal.`);
    out[f.key] = v;
  }
  return out;
}

const AnswerIn = z.object({
  item_id: z.number().int(),
  condition: z.enum(['good', 'bad']).nullable().optional(),
  values: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
  value: z.string().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  plan_date: z.string().nullable().optional(),
  photos: z.array(z.string()).max(MAX_PHOTOS_PER_ITEM).optional(),
  keep_photo_ids: z.array(z.number().int()).max(MAX_PHOTOS_PER_ITEM).optional(),
});

const RecordBase = {
  header: z.record(z.string(), z.union([z.string().max(1500), z.number(), z.null()])).default({}),
  answers: z.array(AnswerIn).max(500),
  notes: z.string().trim().max(1500).nullable().optional(),
  signature_png: z.string().nullable().optional(),
  use_saved_signature: z.boolean().optional(),
  save_signature: z.boolean().optional(),
};
const RecordCreate = z.object({
  client_uuid: z.string().uuid().optional(),
  subject_id: z.number().int(),
  record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.number().int().min(0).max(2).default(0),
  filled_at: z.string().datetime().optional(),
  ...RecordBase,
});
const RecordUpdate = z.object(RecordBase);

/**
 * Cocokkan jawaban dari HP dengan daftar cek objek itu. Mengembalikan baris siap simpan.
 * existing: Map item_id -> Set id foto lama (saat mengubah).
 */
async function prepareAnswers(db, type, subjectId, answersIn, existing = new Map()) {
  const sections = await loadChecklist(db, type.id, subjectId);
  const flat = [];
  sections.forEach((s, si) => s.items.forEach((it) => flat.push({ ...it, section_title: s.title, section_order: si + 1 })));
  const byId = new Map(flat.map((i) => [i.id, i]));
  const seen = new Set();
  const out = [];
  let newBytes = 0;
  const missing = [];
  for (const a of answersIn) {
    const it = byId.get(a.item_id);
    if (!it) throw unprocessable('Daftar cek sudah berubah. Tutup lalu buka lagi form ini.');
    if (seen.has(a.item_id)) throw unprocessable('Ada butir yang terisi dua kali.');
    seen.add(a.item_id);
    const name = plain(it.text);
    const note = (a.note || '').trim() || null;
    let condition = null;
    let values = null;
    let isFinding = false;
    if (it.kind === 'check') {
      condition = a.condition ?? null;
      if (!condition && it.required) missing.push(it);
      if (condition === 'bad') {
        if (!note || note.length < 3) throw unprocessable(`Butir "${name}" ditandai ${it.bad_label}: catatan wajib diisi.`);
        isFinding = it.severity !== 'note';
      }
    } else if (it.kind === 'measure') {
      const fields = Array.isArray(it.fields) && it.fields.length ? it.fields : [{ key: 'v', label: 'Hasil' }];
      const v = {};
      let any = false;
      let out_ = false;
      for (const f of fields) {
        const n = toNum(a.values?.[f.key]);
        if (Number.isNaN(n)) throw unprocessable(`Butir "${name}" (${f.label}): isi dengan angka.`);
        v[f.key] = n;
        if (n != null) any = true;
        if (outOfRange(n, it)) out_ = true;
      }
      if (it.required && fields.some((f) => v[f.key] == null)) missing.push(it);
      if (any) {
        values = v;
        condition = out_ ? 'bad' : 'good';
        isFinding = out_ && it.severity !== 'note';
      }
    } else {
      const s = (a.value ?? '').trim();
      if (s) {
        if (it.input_type === 'date' && !isDate(s)) throw unprocessable(`Butir "${name}": tanggal tidak valid.`);
        if (it.input_type === 'number' && Number.isNaN(toNum(s))) throw unprocessable(`Butir "${name}": isi dengan angka.`);
        values = { value: s };
      } else if (it.required) missing.push(it);
    }
    let files = [];
    let keepIds = [];
    if (condition === 'bad') {
      const mine = existing.get(it.id) ?? new Set();
      keepIds = [...new Set(a.keep_photo_ids ?? [])].filter((id) => mine.has(id));
      files = (a.photos ?? []).map((p) => decodePhoto(p, `Foto butir "${name}"`));
      if (it.kind === 'check' && it.needs_photo && keepIds.length + files.length < 1) {
        throw new AppError(422, 'photo_required', `Butir "${name}" ditandai ${it.bad_label}: foto wajib dilampirkan.`, { item_id: it.id });
      }
      if (keepIds.length + files.length > MAX_PHOTOS_PER_ITEM) throw unprocessable(`Butir "${name}": maksimal ${MAX_PHOTOS_PER_ITEM} foto.`);
      newBytes += files.reduce((n, f) => n + f.buffer.length, 0);
    }
    const plan = a.plan_date && isDate(a.plan_date) && isFinding ? a.plan_date : null;
    out.push({ ...it, condition, values, note, isFinding, plan, files, keepIds });
  }
  if (newBytes > MAX_NEW_PHOTO_BYTES) throw unprocessable('Foto terlalu besar secara keseluruhan. Kurangi jumlah foto.');
  if (flat.length && !out.some((a) => a.condition || a.values)) throw unprocessable('Isi minimal satu butir.');
  for (const it of flat) if (it.required && !seen.has(it.id)) missing.push(it);
  if (missing.length) {
    throw new AppError(422, 'incomplete', `Masih ada ${missing.length} butir wajib yang belum diisi (mis. "${plain(missing[0].text)}").`, {
      item_ids: missing.map((m) => m.id),
    });
  }
  return out;
}

function summarize(answers) {
  let n_stop = 0;
  let n_fix = 0;
  for (const a of answers) {
    if (!a.isFinding) continue;
    if (a.severity === 'stop') n_stop += 1;
    else n_fix += 1;
  }
  return { n_stop, n_fix, result: n_stop ? 'stop' : n_fix ? 'finding' : 'ok' };
}

async function insertAnswer(c, recordId, a) {
  const { rows } = await c.query(
    `INSERT INTO form_answers (record_id, item_id, section_title, section_order, item_order, item_label, item_text, item_spec, kind, severity,
                               good_label, bad_label, unit, min_value, max_value, condition, values, note, is_finding, fix_status, fix_plan_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21) RETURNING id`,
    [
      recordId, a.id, a.section_title, a.section_order, a.sort_order, a.label, a.text, a.spec, a.kind, a.severity,
      a.good_label, a.bad_label, a.unit, a.min_value, a.max_value, a.condition, a.values ? JSON.stringify(a.values) : null,
      a.note, a.isFinding, a.isFinding ? 'open' : null, a.plan,
    ],
  );
  return rows[0].id;
}

async function insertPhotos(c, recordId, answerId, files, userId) {
  for (const f of files) {
    await c.query('INSERT INTO form_photos (answer_id, record_id, mime, data, size, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
      answerId, recordId, f.mime, f.buffer, f.buffer.length, userId,
    ]);
  }
}

async function resolveSignature(c, req, b, settings, current = null) {
  const me = (await c.query('SELECT name, nrp, signature_png FROM users WHERE id = $1', [req.user.id])).rows[0];
  let sig = b.signature_png || current;
  if (!sig && b.use_saved_signature) sig = me.signature_png || null;
  if (!sig && settings.require_signature) throw unprocessable('Tanda tangan wajib diisi.');
  if (sig) assertPngDataUrl(sig);
  if (b.save_signature && b.signature_png) await c.query('UPDATE users SET signature_png = $1, updated_at = now() WHERE id = $2', [b.signature_png, req.user.id]);
  return { me, sig };
}

const findingsOf = (answers) =>
  answers.filter((a) => a.isFinding).map((a) => ({ item_text: a.text, kind: a.kind, severity: a.severity, bad_label: a.bad_label, note: a.note }));

/* =====================================================================
   Daftar jenis form (layar pilih form sesudah masuk)
   ===================================================================== */

r.get('/', async (req, res) => {
  const scope = scopeOf(req.user);
  const settings = await getSettings();
  const types = (await query(`SELECT ${TYPE_COLS} FROM form_types WHERE is_active ORDER BY sort_order, id`)).rows.filter((t) => canUseForm(req.user, t.code));
  const items = [];
  for (const t of types) {
    const per = currentPeriod(t.period, settings);
    const p = [t.id];
    const siteCond = scope != null ? (p.push(scope), `AND s.site_id = $${p.length}`) : '';
    const stats = (
      await query(
        `SELECT count(*)::int AS subjects,
                COALESCE(sum(oc.open_stop),0)::int AS open_stop, COALESCE(sum(oc.open_fix),0)::int AS open_fix
           FROM form_subjects s
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE a.severity = 'stop') AS open_stop, count(*) FILTER (WHERE a.severity <> 'stop') AS open_fix
               FROM form_answers a JOIN form_records rr ON rr.id = a.record_id
              WHERE rr.subject_id = s.id AND a.is_finding AND a.fix_status <> 'closed'
           ) oc ON true
          WHERE s.form_type_id = $1 AND s.is_active ${siteCond}`,
        p,
      )
    ).rows[0];
    const rp = [t.id];
    const rSite = scope != null ? (rp.push(scope), `AND site_id = $${rp.length}`) : '';
    const unverified = (await query(`SELECT count(*)::int AS n FROM form_records WHERE form_type_id = $1 AND sup_signed_at IS NULL ${rSite}`, rp)).rows[0].n;
    let done = null;
    if (per) {
      const dp = [t.id, per.from, per.to, per.shift];
      const dSite = scope != null ? (dp.push(scope), `AND s.site_id = $${dp.length}`) : '';
      done = (
        await query(
          `SELECT count(DISTINCT rr.subject_id)::int AS n FROM form_records rr JOIN form_subjects s ON s.id = rr.subject_id
            WHERE rr.form_type_id = $1 AND rr.record_date BETWEEN $2 AND $3 AND ($4::int = 0 OR rr.shift = $4) AND s.is_active ${dSite}`,
          dp,
        )
      ).rows[0].n;
    }
    items.push({
      code: t.code,
      name: t.name,
      short_name: t.short_name,
      description: t.description,
      icon: t.icon,
      period: t.period,
      subject_label: t.subject_label,
      subjects: stats.subjects,
      open_stop: stats.open_stop,
      open_fix: stats.open_fix,
      unverified,
      period_label: per?.label ?? null,
      done_this_period: done,
    });
  }
  res.json({ items });
});

/* =====================================================================
   Satu jenis form: pengaturan + daftar objek beserta keadaannya
   ===================================================================== */

r.get('/:code', async (req, res) => {
  const t = await getType(req.params.code);
  const isAdmin = req.user.role === 'admin';
  if (!t.is_active && !isAdmin) throw notFound('Jenis form tidak ditemukan.');
  const settings = await getSettings();
  const per = currentPeriod(t.period, settings);
  const scope = scopeOf(req.user);
  const all = isAdmin && String(req.query.all) === '1';
  const p = [t.id, per?.from ?? null, per?.to ?? null, per?.shift ?? 0];
  const where = [`s.form_type_id = $1`];
  if (scope != null) {
    p.push(scope);
    where.push(`s.site_id = $${p.length}`);
  }
  if (!all) where.push('s.is_active');
  const subjects = (
    await query(
      `SELECT s.id, s.name, s.detail, s.site_id, si.name AS site_name, s.is_active, s.sort_order,
              lr.id AS last_id, lr.record_date AS last_date, lr.shift AS last_shift, lr.result AS last_result,
              (lr.sup_signed_at IS NOT NULL) AS last_verified,
              COALESCE(oc.open_stop, 0)::int AS open_stop, COALESCE(oc.open_fix, 0)::int AS open_fix,
              CASE WHEN $2::date IS NULL THEN NULL ELSE EXISTS (
                SELECT 1 FROM form_records r2 WHERE r2.subject_id = s.id AND r2.record_date BETWEEN $2::date AND $3::date AND ($4::int = 0 OR r2.shift = $4)
              ) END AS done_now,
              (SELECT count(*)::int FROM form_sections fs JOIN form_items fi ON fi.section_id = fs.id WHERE fs.subject_id = s.id AND fi.is_active) AS own_items
         FROM form_subjects s
         JOIN sites si ON si.id = s.site_id
         LEFT JOIN LATERAL (
           SELECT id, record_date, shift, result, sup_signed_at FROM form_records WHERE subject_id = s.id
            ORDER BY record_date DESC, shift DESC, id DESC LIMIT 1
         ) lr ON true
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE a.severity = 'stop') AS open_stop, count(*) FILTER (WHERE a.severity <> 'stop') AS open_fix
             FROM form_answers a JOIN form_records rr ON rr.id = a.record_id
            WHERE rr.subject_id = s.id AND a.is_finding AND a.fix_status <> 'closed'
         ) oc ON true
        WHERE ${where.join(' AND ')}
        ORDER BY si.sort_order, s.sort_order, s.name`,
      p,
    )
  ).rows;
  const shared = (
    await query(
      `SELECT count(*)::int AS n FROM form_sections fs JOIN form_items fi ON fi.section_id = fs.id WHERE fs.form_type_id = $1 AND fs.subject_id IS NULL AND fi.is_active`,
      [t.id],
    )
  ).rows[0].n;
  res.json({
    type: t,
    period: per,
    shift: currentShift(new Date(), settings.shift1_start, settings.shift2_start),
    settings: { shift1_start: settings.shift1_start, shift2_start: settings.shift2_start, require_signature: settings.require_signature },
    shared_items: shared,
    subjects,
  });
});

/** Daftar cek untuk satu objek (atau hanya bagian umum bila subject_id kosong). */
/* =====================================================================
   Rekap / dashboard satu jenis form: tren, kepatuhan, temuan terbanyak, per objek, per site
   ===================================================================== */

r.get('/:code/stats', async (req, res) => {
  res.json(await formStats(await getType(req.params.code), req.query, req.user));
});

/** Tiket unduhan rekap (PDF / Excel / Word) dengan penyaring yang sama seperti layar Rekap. */
const ExportIn = z.object({
  format: z.enum(['pdf', 'docx', 'xlsx']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  site_id: z.number().int().positive().nullish(),
});
r.post('/:code/export', async (req, res) => {
  const t = await getType(req.params.code);
  const b = parse(ExportIn, req.body);
  const filters = { from: b.from, to: b.to, site_id: b.site_id ?? undefined };
  const token = jwt.sign({ typ: 'export', kind: 'form_rekap', code: t.code, format: b.format, filters, uid: req.user.id }, config.jwtSecret, { expiresIn: '3m' });
  res.json({ path: `/api/exports/file?t=${encodeURIComponent(token)}` });
});

r.get('/:code/checklist', async (req, res) => {
  const t = await getType(req.params.code);
  const sid = Number(req.query.subject_id) || null;
  if (sid) {
    const s = (await query('SELECT site_id FROM form_subjects WHERE id = $1 AND form_type_id = $2', [sid, t.id])).rows[0];
    if (!s || !inScope(req.user, s.site_id)) throw notFound('Objek tidak ditemukan.');
  }
  const all = req.user.role === 'admin' && String(req.query.all) === '1';
  // last: isian kepala form terakhir untuk objek ini (mis. data generator) supaya tidak mengetik ulang
  let last_header = null;
  if (sid) {
    last_header = (await query('SELECT header FROM form_records WHERE subject_id = $1 ORDER BY record_date DESC, id DESC LIMIT 1', [sid])).rows[0]?.header ?? null;
  }
  res.json({ sections: await loadChecklist({ query }, t.id, sid, { all }), last_header });
});

/* =====================================================================
   Riwayat
   ===================================================================== */

const LIST_COLS = `r.id, r.form_type_id, r.subject_id, r.subject_name, r.subject_detail, r.site_id, r.site_name, r.record_date, r.shift,
  r.filler_name, r.result, r.n_stop, r.n_fix, COALESCE(r.filled_at, r.submitted_at) AS filled_at, r.submitted_at,
  (r.sup_signed_at IS NOT NULL) AS verified, r.sup_name, r.sup_signed_at`;

r.get('/:code/records', async (req, res) => {
  const t = await getType(req.params.code);
  const p = [t.id];
  const where = ['r.form_type_id = $1'];
  const add = (sql, v) => {
    p.push(v);
    where.push(sql.replace('?', `$${p.length}`));
  };
  const scope = scopeOf(req.user);
  if (scope != null) add('r.site_id = ?', scope);
  else if (Number(req.query.site_id)) add('r.site_id = ?', Number(req.query.site_id));
  if (Number(req.query.subject_id)) add('r.subject_id = ?', Number(req.query.subject_id));
  if (isDate(req.query.from)) add('r.record_date >= ?', req.query.from);
  if (isDate(req.query.to)) add('r.record_date <= ?', req.query.to);
  if (['ok', 'finding', 'stop'].includes(req.query.result)) add('r.result = ?', req.query.result);
  if (String(req.query.unverified) === '1') where.push('r.sup_signed_at IS NULL');
  if (String(req.query.mine) === '1') add('r.user_id = ?', req.user.id);
  if (req.query.q) {
    p.push(`%${String(req.query.q).toLowerCase().slice(0, 60)}%`);
    where.push(`(lower(r.subject_name) LIKE $${p.length} OR lower(r.filler_name) LIKE $${p.length})`);
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const w = `WHERE ${where.join(' AND ')}`;
  const [rows, total] = await Promise.all([
    query(`SELECT ${LIST_COLS} FROM form_records r ${w} ORDER BY r.record_date DESC, r.shift DESC, r.id DESC LIMIT ${limit} OFFSET ${offset}`, p),
    query(`SELECT count(*)::int AS n FROM form_records r ${w}`, p),
  ]);
  res.json({ items: rows.rows, total: total.rows[0].n, limit, offset });
});

function permissionsFor(user, rec) {
  const isAdmin = user.role === 'admin';
  const mine = inScope(user, rec.site_id);
  return {
    can_edit: mine && (isAdmin || (CAN_FILL.includes(user.role) && rec.user_id === user.id && !rec.sup_signed_at)),
    can_sign: mine && CAN_SIGN.includes(user.role) && !rec.sup_signed_at && (isAdmin || rec.user_id !== user.id),
    can_unsign: isAdmin && !!rec.sup_signed_at,
    can_delete: isAdmin,
    can_fix: mine && CAN_FIX.includes(user.role),
  };
}

async function loadRecord(t, id) {
  const rec = (await query('SELECT * FROM form_records WHERE id = $1 AND form_type_id = $2', [id, t.id])).rows[0];
  if (!rec) return null;
  const ans = (await query('SELECT * FROM form_answers WHERE record_id = $1 ORDER BY section_order, item_order, id', [id])).rows;
  const photos = (await query('SELECT id, answer_id FROM form_photos WHERE record_id = $1 ORDER BY id', [id])).rows;
  const start = new Date(rec.filled_at || rec.submitted_at).getTime();
  const sections = [];
  for (const a of ans) {
    let s = sections.find((x) => x.title === a.section_title && x.order === a.section_order);
    if (!s) {
      s = { title: a.section_title, order: a.section_order, items: [] };
      sections.push(s);
    }
    s.items.push({
      ...a,
      photos: photos.filter((p) => p.answer_id === a.id).map((p) => p.id),
      due_at: a.is_finding && a.severity === 'fix' && a.fix_status !== 'closed' ? new Date(start + t.fix_hours * 3600_000).toISOString() : null,
    });
  }
  return { record: rec, sections };
}

r.get('/:code/records/:id', async (req, res) => {
  const t = await getType(req.params.code);
  const d = await loadRecord(t, idParam(req));
  if (!d || !inScope(req.user, d.record.site_id)) throw notFound('Data tidak ditemukan.');
  res.json({ type: t, ...d, permissions: permissionsFor(req.user, d.record) });
});

/* =====================================================================
   Isi form baru
   ===================================================================== */

function checkDate(date, isAdmin) {
  if (!isDate(date)) throw unprocessable('Tanggal tidak valid.');
  const today = wita().date;
  if (date > today) throw unprocessable('Tanggal tidak boleh di masa depan.');
  if (!isAdmin && daysBetween(date, today) > MAX_BACKDATE_DAYS) throw unprocessable(`Tanggal terlalu lama (maksimal ${MAX_BACKDATE_DAYS} hari ke belakang).`);
}

r.post('/:code/records', requireRole(...CAN_FILL), async (req, res) => {
  const t = await getType(req.params.code);
  if (!t.is_active) throw notFound('Jenis form ini sudah tidak dipakai.');
  const b = parse(RecordCreate, req.body);
  checkDate(b.record_date, req.user.role === 'admin');
  const shift = t.period === 'shift' ? b.shift : 0;
  if (t.period === 'shift' && ![1, 2].includes(shift)) throw unprocessable('Pilih shift.');
  const settings = await getSettings();
  let filledAt = null;
  if (b.filled_at) {
    const ms = new Date(b.filled_at).getTime();
    if (ms <= Date.now() + 10 * 60_000 && ms >= Date.now() - (MAX_BACKDATE_DAYS + 1) * 86400_000) filledAt = new Date(ms).toISOString();
  }

  const out = await tx(async (c) => {
    if (b.client_uuid) {
      const ex = await c.query('SELECT id, result, n_stop, n_fix FROM form_records WHERE client_uuid = $1', [b.client_uuid]);
      if (ex.rowCount) return { ...ex.rows[0], duplicate: true };
    }
    const s = (
      await c.query('SELECT s.*, si.name AS site_name FROM form_subjects s JOIN sites si ON si.id = s.site_id WHERE s.id = $1 AND s.form_type_id = $2', [
        b.subject_id, t.id,
      ])
    ).rows[0];
    if (!s) throw notFound(`${t.subject_label} tidak ditemukan.`);
    if (!inScope(req.user, s.site_id)) throw forbidden(`${t.subject_label} ini bukan di site Anda.`);
    if (!s.is_active) throw unprocessable(`${t.subject_label} ini sudah tidak aktif.`);

    const answers = await prepareAnswers(c, t, s.id, b.answers);
    const sum = summarize(answers);
    const header = cleanHeader(t, b.header);
    const { me, sig } = await resolveSignature(c, req, b, settings);

    const ins = await c.query(
      `INSERT INTO form_records (client_uuid, form_type_id, subject_id, site_id, record_date, shift, user_id, filler_name, filler_nrp,
                                 subject_name, subject_detail, site_name, header, notes, signature_png, result, n_stop, n_fix, filled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        b.client_uuid ?? null, t.id, s.id, s.site_id, b.record_date, shift, req.user.id, me.name, me.nrp, s.name, s.detail, s.site_name,
        JSON.stringify(header), b.notes || null, sig, sum.result, sum.n_stop, sum.n_fix, filledAt,
      ],
    );
    if (!ins.rowCount) {
      const e = (
        await c.query('SELECT id, filler_name FROM form_records WHERE form_type_id = $1 AND subject_id = $2 AND record_date = $3 AND shift = $4', [
          t.id, s.id, b.record_date, shift,
        ])
      ).rows[0];
      throw conflict(
        e
          ? `${s.name} sudah diisi untuk ${b.record_date}${shift ? ` Shift ${shiftLabel(shift)}` : ''} oleh ${e.filler_name}. Buka lalu ubah bila perlu.`
          : 'Form ini sudah pernah dikirim.',
        { existing_id: e?.id ?? null },
      );
    }
    const id = ins.rows[0].id;
    for (const a of answers) {
      const aid = await insertAnswer(c, id, a);
      if (a.files.length) await insertPhotos(c, id, aid, a.files, req.user.id);
    }
    await audit(c, req.user, 'form.create', t.code, id, { subject: s.name, result: sum.result });
    return {
      id,
      ...sum,
      duplicate: false,
      _notice: { rec: { id, record_date: b.record_date, shift, site_id: s.site_id, site_name: s.site_name, subject_name: s.name, filler_name: me.name }, findings: findingsOf(answers) },
    };
  });

  if (out._notice) {
    notifyRecord(t, out._notice.rec, out._notice.findings, req.user.id);
    // form per shift: rekap shift sebelumnya di site ini yang sudah terverifikasi tapi belum terkirim
    void notifyShiftActivity(t, out._notice.rec.site_id);
    delete out._notice;
  }
  res.status(out.duplicate ? 200 : 201).json(out);
});

/* =====================================================================
   Ubah form (pengisi sebelum diverifikasi, atau admin)
   ===================================================================== */

r.put('/:code/records/:id', requireRole(...CAN_FILL), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const b = parse(RecordUpdate, req.body);
  const settings = await getSettings();

  const out = await tx(async (c) => {
    const rec = (await c.query('SELECT * FROM form_records WHERE id = $1 AND form_type_id = $2 FOR UPDATE', [id, t.id])).rows[0];
    if (!rec || !inScope(req.user, rec.site_id)) throw notFound('Data tidak ditemukan.');
    if (req.user.role !== 'admin') {
      if (rec.user_id !== req.user.id) throw forbidden('Hanya pengisi (atau admin) yang boleh mengubahnya.');
      if (rec.sup_signed_at) throw forbidden('Sudah diverifikasi pengawas, jadi tidak bisa diubah. Hubungi admin.');
    }
    const prev = (await c.query('SELECT id, item_id, is_finding FROM form_answers WHERE record_id = $1', [id])).rows;
    const prevPhotos = (await c.query('SELECT id, answer_id FROM form_photos WHERE record_id = $1', [id])).rows;
    const ansByItem = new Map(prev.filter((x) => x.item_id != null).map((x) => [x.item_id, x]));
    const existing = new Map();
    for (const [itemId, a] of ansByItem) existing.set(itemId, new Set(prevPhotos.filter((p) => p.answer_id === a.id).map((p) => p.id)));

    const answers = await prepareAnswers(c, t, rec.subject_id, b.answers, existing);
    const fresh = [];
    for (const a of answers) {
      const old = ansByItem.get(a.id);
      let aid;
      if (old) {
        aid = old.id;
        await c.query(
          `UPDATE form_answers SET condition = $2, values = $3::jsonb, note = $4, is_finding = $5,
             fix_status = CASE WHEN NOT $5 THEN NULL WHEN is_finding THEN fix_status ELSE 'open' END,
             fix_plan_date = CASE WHEN NOT $5 THEN NULL ELSE COALESCE($6::date, fix_plan_date) END,
             fix_note = CASE WHEN NOT $5 OR NOT is_finding THEN NULL ELSE fix_note END,
             fix_by = CASE WHEN NOT $5 OR NOT is_finding THEN NULL ELSE fix_by END,
             fix_by_name = CASE WHEN NOT $5 OR NOT is_finding THEN NULL ELSE fix_by_name END,
             fix_at = CASE WHEN NOT $5 OR NOT is_finding THEN NULL ELSE fix_at END
           WHERE id = $1`,
          [aid, a.condition, a.values ? JSON.stringify(a.values) : null, a.note, a.isFinding, a.plan],
        );
        if (a.isFinding && !old.is_finding) fresh.push(a);
      } else {
        aid = await insertAnswer(c, id, a);
        if (a.isFinding) fresh.push(a);
      }
      await c.query('DELETE FROM form_photos WHERE answer_id = $1 AND NOT (id = ANY($2::bigint[]))', [aid, a.keepIds]);
      if (a.files.length) await insertPhotos(c, id, aid, a.files, req.user.id);
    }
    const tot = (
      await c.query(
        `SELECT count(*) FILTER (WHERE is_finding AND severity = 'stop')::int AS n_stop,
                count(*) FILTER (WHERE is_finding AND severity <> 'stop')::int AS n_fix
           FROM form_answers WHERE record_id = $1`,
        [id],
      )
    ).rows[0];
    const result = tot.n_stop ? 'stop' : tot.n_fix ? 'finding' : 'ok';
    const header = cleanHeader(t, b.header);
    const { sig } = await resolveSignature(c, req, b, settings, rec.signature_png);
    await c.query(
      `UPDATE form_records SET header = $2::jsonb, notes = $3, signature_png = $4, result = $5, n_stop = $6, n_fix = $7,
              edited_at = now(), edited_by_name = $8 WHERE id = $1`,
      [id, JSON.stringify(header), b.notes || null, sig, result, tot.n_stop, tot.n_fix, req.user.name],
    );
    await audit(c, req.user, 'form.update', t.code, id, { result });
    return { id, result, ...tot, rec, fresh: findingsOf(fresh) };
  });
  if (out.fresh.length) notifyRecord(t, out.rec, out.fresh, req.user.id);
  res.json({ id: out.id, result: out.result, n_stop: out.n_stop, n_fix: out.n_fix });
});

/* =====================================================================
   Verifikasi pengawas
   ===================================================================== */

const SignIn = z.object({
  signature_png: z.string().nullable().optional(),
  save_signature: z.boolean().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

r.post('/:code/records/:id/verify', requireRole(...CAN_SIGN), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const b = parse(SignIn, req.body);
  await tx(async (c) => {
    const f = (await c.query('SELECT id, user_id, site_id, sup_signed_at FROM form_records WHERE id = $1 AND form_type_id = $2 FOR UPDATE', [id, t.id])).rows[0];
    if (!f || !inScope(req.user, f.site_id)) throw notFound('Data tidak ditemukan.');
    if (f.sup_signed_at) throw conflict('Sudah diverifikasi.');
    if (f.user_id === req.user.id && req.user.role !== 'admin') throw forbidden('Anda tidak bisa memverifikasi form yang Anda isi sendiri. Minta pengawas lain.');
    const me = (await c.query('SELECT name, nrp, signature_png FROM users WHERE id = $1', [req.user.id])).rows[0];
    const sig = b.signature_png || me.signature_png;
    if (!sig) throw unprocessable('Gambar tanda tangan Anda dulu.');
    assertPngDataUrl(sig);
    if (b.save_signature && b.signature_png) await c.query('UPDATE users SET signature_png = $1, updated_at = now() WHERE id = $2', [sig, req.user.id]);
    await c.query(
      `UPDATE form_records SET sup_user_id = $1, sup_name = $2, sup_nrp = $3, sup_signature_png = $4, sup_note = $5, sup_signed_at = now() WHERE id = $6`,
      [req.user.id, me.name, me.nrp, sig, b.note || null, id],
    );
    await audit(c, req.user, 'form.verify', t.code, id);
  });
  void notifyVerified(t, id);
  res.json({ ok: true });
});

r.delete('/:code/records/:id/verify', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const u = await query(
    `UPDATE form_records SET sup_user_id = NULL, sup_name = NULL, sup_nrp = NULL, sup_signature_png = NULL, sup_note = NULL, sup_signed_at = NULL
      WHERE id = $1 AND form_type_id = $2 RETURNING id`,
    [id, t.id],
  );
  if (!u.rowCount) throw notFound('Data tidak ditemukan.');
  await audit(null, req.user, 'form.unverify', t.code, id);
  res.json({ ok: true });
});

r.delete('/:code/records/:id', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const d = await query('DELETE FROM form_records WHERE id = $1 AND form_type_id = $2 RETURNING subject_name, record_date', [id, t.id]);
  if (!d.rowCount) throw notFound('Data tidak ditemukan.');
  await audit(null, req.user, 'form.delete', t.code, id, d.rows[0]);
  res.json({ ok: true });
});

/* =====================================================================
   Temuan
   ===================================================================== */

r.get('/:code/findings', async (req, res) => {
  const t = await getType(req.params.code);
  const status = req.query.status === 'closed' ? 'closed' : 'open';
  const p = [t.id];
  const where = ['r.form_type_id = $1', 'a.is_finding', status === 'open' ? "a.fix_status <> 'closed'" : "a.fix_status = 'closed'"];
  const scope = scopeOf(req.user);
  if (scope != null) {
    p.push(scope);
    where.push(`r.site_id = $${p.length}`);
  } else if (Number(req.query.site_id)) {
    p.push(Number(req.query.site_id));
    where.push(`r.site_id = $${p.length}`);
  }
  if (Number(req.query.subject_id)) {
    p.push(Number(req.query.subject_id));
    where.push(`r.subject_id = $${p.length}`);
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  const rows = (
    await query(
      `SELECT a.id, a.record_id, a.item_label, a.item_text, a.item_spec, a.section_title, a.kind, a.severity, a.bad_label, a.unit,
              a.min_value, a.max_value, a.values, a.note, a.fix_status, a.fix_plan_date, a.fix_note, a.fix_by_name, a.fix_at,
              r.subject_id, r.subject_name, r.site_id, r.site_name, r.record_date, r.shift, r.filler_name,
              COALESCE(r.filled_at, r.submitted_at) AS seen_at,
              (SELECT COALESCE(array_agg(ph.id::int ORDER BY ph.id), '{}'::int[]) FROM form_photos ph WHERE ph.answer_id = a.id) AS photo_ids
         FROM form_answers a JOIN form_records r ON r.id = a.record_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${status === 'open' ? "(a.severity = 'stop') DESC, r.record_date ASC, a.id ASC" : 'a.fix_at DESC NULLS LAST'}
        LIMIT ${limit}`,
      p,
    )
  ).rows;
  const now = Date.now();
  res.json({
    items: rows.map((x) => {
      const due = x.severity === 'fix' && status === 'open' ? new Date(new Date(x.seen_at).getTime() + t.fix_hours * 3600_000) : null;
      return { ...x, due_at: due?.toISOString() ?? null, overdue: !!(due && due.getTime() < now) };
    }),
  });
});

const PatchIn = z.object({
  status: z.enum(['open', 'in_progress', 'closed']).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  plan_date: z.string().nullable().optional(),
});

r.patch('/:code/findings/:id', requireRole(...CAN_FIX), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const b = parse(PatchIn, req.body);
  const note = (b.note || '').trim() || null;
  if (b.status === 'closed' && (!note || note.length < 3)) throw unprocessable('Tulis singkat apa yang sudah diperbaiki (minimal 3 huruf).');
  if (b.plan_date && !isDate(b.plan_date)) throw unprocessable('Tanggal rencana tidak valid.');

  const info = await tx(async (c) => {
    const a = (
      await c.query(
        `SELECT a.id, a.item_text, a.severity, a.fix_status, a.is_finding, r.id AS record_id, r.subject_id, r.subject_name, r.site_id, r.site_name
           FROM form_answers a JOIN form_records r ON r.id = a.record_id WHERE a.id = $1 AND r.form_type_id = $2 FOR UPDATE OF a`,
        [id, t.id],
      )
    ).rows[0];
    if (!a || !a.is_finding || !inScope(req.user, a.site_id)) throw notFound('Temuan tidak ditemukan.');
    if (a.fix_status === 'closed') throw conflict('Temuan ini sudah ditandai selesai.');
    const status = b.status ?? a.fix_status;
    await c.query(
      `UPDATE form_answers SET fix_status = $2,
              fix_note = COALESCE($3, fix_note),
              fix_plan_date = CASE WHEN $4::text IS NULL THEN fix_plan_date ELSE $4::date END,
              fix_by = $5, fix_by_name = $6,
              fix_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END
        WHERE id = $1`,
      [id, status, note, b.plan_date ?? null, req.user.id, req.user.name],
    );
    await audit(c, req.user, `form_finding.${status}`, t.code, id, { subject: a.subject_name, item: plain(a.item_text) });
    let unitFree = false;
    if (status === 'closed' && a.severity === 'stop') {
      const still = await c.query(
        `SELECT 1 FROM form_answers x JOIN form_records rr ON rr.id = x.record_id
          WHERE rr.subject_id = $1 AND x.is_finding AND x.severity = 'stop' AND x.fix_status <> 'closed' LIMIT 1`,
        [a.subject_id],
      );
      unitFree = !still.rowCount;
    }
    return { a, status, unitFree };
  });
  if (info.status === 'closed') {
    notifyFixed(t, { ...info.a, fix_note: note, by_name: req.user.name, unit_free: info.unitFree }, req.user.id);
  }
  res.json({ ok: true });
});

/* =====================================================================
   Kelola (admin): pengaturan jenis form, objek, bagian, butir
   ===================================================================== */

const TypeIn = z.object({
  name: z.string().trim().min(3).max(200).optional(),
  short_name: z.string().trim().min(2).max(40).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  period: z.enum(['shift', 'day', 'week', 'biweek', 'month', 'quarter', 'half', 'none']).optional(),
  subject_label: z.string().trim().min(2).max(40).optional(),
  fix_hours: z.number().int().min(1).max(24 * 60).optional(),
  photo_required: z.boolean().optional(),
  filler_label: z.string().trim().min(2).max(60).optional(),
  verifier_label: z.string().trim().min(2).max(60).optional(),
  doc_no: z.string().trim().max(60).nullable().optional(),
  is_active: z.boolean().optional(),
  wa_findings: z.boolean().optional(),
  wa_verify: z.boolean().optional(),
});

r.put('/:code', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const b = parse(TypeIn, req.body);
  const sets = [];
  const p = [t.id];
  for (const [k, v] of Object.entries(b)) {
    p.push(v);
    sets.push(`${k} = $${p.length}`);
  }
  if (sets.length) await query(`UPDATE form_types SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, p);
  await audit(null, req.user, 'form_type.update', t.code, t.id, b);
  res.json({ type: await getType(t.code) });
});

/**
 * Grup WhatsApp khusus form ini (id kosong = pakai grup utama di Pengaturan).
 * Nomor WhatsApp yang ditautkan tetap satu; nomor itu harus anggota grup yang dipilih.
 * Nama grup diambil dari WhatsApp, bukan dari kiriman tampilan.
 */
r.put('/:code/wa-group', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const { id } = parse(z.object({ id: z.string().trim().regex(/^[0-9-]+@g\.us$/, 'ID grup tidak dikenal.').nullable() }), req.body);
  let name = null;
  if (id) {
    let groups;
    try {
      groups = await waGroups();
    } catch (err) {
      throw unprocessable(`Gagal mengambil daftar grup WhatsApp: ${err.message}`);
    }
    const g = groups.find((x) => x.id === id);
    if (!g) throw unprocessable('Nomor WhatsApp yang ditautkan bukan anggota grup itu.');
    name = g.name;
  }
  await query('UPDATE form_types SET wa_group_id = $2, wa_group_name = $3, updated_at = now() WHERE id = $1', [t.id, id, name]);
  await audit(null, req.user, 'form_type.wa_group', t.code, t.id, { group: name });
  res.json({ type: await getType(t.code) });
});

const SubjectIn = z.object({
  site_id: z.number().int(),
  name: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(160).nullable().optional(),
  is_active: z.boolean().optional(),
  copy_from: z.number().int().nullable().optional(), // salin daftar butir khusus dari objek lain
});

r.post('/:code/subjects', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const b = parse(SubjectIn, req.body);
  const out = await tx(async (c) => {
    const site = (await c.query('SELECT id FROM sites WHERE id = $1', [b.site_id])).rows[0];
    if (!site) throw unprocessable('Site tidak dikenal.');
    const ins = await c.query(
      `INSERT INTO form_subjects (form_type_id, site_id, name, detail, sort_order)
       VALUES ($1,$2,$3,$4, (SELECT COALESCE(max(sort_order),0) + 1 FROM form_subjects WHERE form_type_id = $1))
       ON CONFLICT DO NOTHING RETURNING id`,
      [t.id, b.site_id, b.name, b.detail || null],
    );
    if (!ins.rowCount) throw conflict(`${t.subject_label} "${b.name}" sudah ada di site itu.`);
    const sid = ins.rows[0].id;
    if (b.copy_from) {
      const secs = (await c.query('SELECT * FROM form_sections WHERE form_type_id = $1 AND subject_id = $2 ORDER BY sort_order, id', [t.id, b.copy_from])).rows;
      for (const s of secs) {
        const ns = await c.query('INSERT INTO form_sections (form_type_id, subject_id, title, note, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
          t.id, sid, s.title, s.note, s.sort_order,
        ]);
        await c.query(
          `INSERT INTO form_items (form_type_id, section_id, sort_order, label, text, spec, kind, severity, good_label, bad_label, input_type, fields,
                                   unit, min_value, max_value, required, needs_photo, is_active)
           SELECT form_type_id, $2, sort_order, label, text, spec, kind, severity, good_label, bad_label, input_type, fields,
                  unit, min_value, max_value, required, needs_photo, is_active
             FROM form_items WHERE section_id = $1`,
          [s.id, ns.rows[0].id],
        );
      }
    }
    await audit(c, req.user, 'form_subject.create', t.code, sid, { name: b.name });
    return sid;
  });
  res.status(201).json({ id: out });
});

r.put('/:code/subjects/:id', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const b = parse(SubjectIn.omit({ copy_from: true }), req.body);
  try {
    const u = await query(
      `UPDATE form_subjects SET site_id = $3, name = $4, detail = $5, is_active = COALESCE($6, is_active), updated_at = now()
        WHERE id = $1 AND form_type_id = $2 RETURNING id`,
      [id, t.id, b.site_id, b.name, b.detail || null, b.is_active ?? null],
    );
    if (!u.rowCount) throw notFound('Objek tidak ditemukan.');
  } catch (e) {
    if (e.code === '23505') throw conflict(`${t.subject_label} "${b.name}" sudah ada di site itu.`);
    throw e;
  }
  await audit(null, req.user, 'form_subject.update', t.code, id, b);
  res.json({ ok: true });
});

const SectionIn = z.object({
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(300).nullable().optional(),
  subject_id: z.number().int().nullable().optional(),
});

r.post('/:code/sections', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const b = parse(SectionIn, req.body);
  if (b.subject_id) {
    const s = await query('SELECT 1 FROM form_subjects WHERE id = $1 AND form_type_id = $2', [b.subject_id, t.id]);
    if (!s.rowCount) throw unprocessable('Objek tidak dikenal.');
  }
  const { rows } = await query(
    `INSERT INTO form_sections (form_type_id, subject_id, title, note, sort_order)
     VALUES ($1,$2,$3,$4, (SELECT COALESCE(max(sort_order),0) + 1 FROM form_sections WHERE form_type_id = $1 AND subject_id IS NOT DISTINCT FROM $2))
     RETURNING id`,
    [t.id, b.subject_id ?? null, b.title, b.note || null],
  );
  await audit(null, req.user, 'form_section.create', t.code, rows[0].id, b);
  res.status(201).json({ id: rows[0].id });
});

r.put('/:code/sections/:id', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const b = parse(SectionIn.omit({ subject_id: true }).extend({ move: z.enum(['up', 'down']).optional() }), req.body);
  const sec = (await query('SELECT * FROM form_sections WHERE id = $1 AND form_type_id = $2', [id, t.id])).rows[0];
  if (!sec) throw notFound('Bagian tidak ditemukan.');
  await tx(async (c) => {
    await c.query('UPDATE form_sections SET title = $2, note = $3 WHERE id = $1', [id, b.title, b.note || null]);
    if (b.move) await moveRow(c, 'form_sections', sec, 'form_type_id = $1 AND subject_id IS NOT DISTINCT FROM $2', [t.id, sec.subject_id], b.move);
  });
  await audit(null, req.user, 'form_section.update', t.code, id, b);
  res.json({ ok: true });
});

r.delete('/:code/sections/:id', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const n = (await query('SELECT count(*)::int AS n FROM form_items WHERE section_id = $1', [id])).rows[0].n;
  if (n) throw conflict('Bagian ini masih berisi butir. Nonaktifkan butirnya, atau hapus bagian yang sudah kosong saja.');
  const d = await query('DELETE FROM form_sections WHERE id = $1 AND form_type_id = $2 RETURNING title', [id, t.id]);
  if (!d.rowCount) throw notFound('Bagian tidak ditemukan.');
  await audit(null, req.user, 'form_section.delete', t.code, id, d.rows[0]);
  res.json({ ok: true });
});

const FieldIn = z.object({ key: z.string().trim().regex(/^[a-z0-9_]{1,20}$/), label: z.string().trim().min(1).max(30) });
const ItemIn = z.object({
  section_id: z.number().int(),
  label: z.string().trim().max(10).nullable().optional(),
  text: z.string().trim().min(2).max(300),
  spec: z.string().trim().max(200).nullable().optional(),
  kind: z.enum(['check', 'measure', 'input']),
  severity: z.enum(['stop', 'fix', 'note']),
  good_label: z.string().trim().min(1).max(20).default('Baik'),
  bad_label: z.string().trim().min(1).max(20).default('Rusak'),
  input_type: z.enum(['text', 'date', 'number']).default('text'),
  fields: z.array(FieldIn).max(12).default([]),
  unit: z.string().trim().max(12).nullable().optional(),
  min_value: z.number().finite().nullable().optional(),
  max_value: z.number().finite().nullable().optional(),
  required: z.boolean().default(true),
  needs_photo: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

function itemValues(b) {
  const fields = b.kind === 'measure' ? (b.fields.length ? b.fields : [{ key: 'v', label: 'Hasil' }]) : [];
  if (new Set(fields.map((f) => f.key)).size !== fields.length) throw unprocessable('Kode kolom ukur tidak boleh sama.');
  if (b.min_value != null && b.max_value != null && b.min_value > b.max_value) throw unprocessable('Batas minimum lebih besar dari batas maksimum.');
  return [
    b.label || null, b.text, b.spec || null, b.kind, b.kind === 'input' ? 'note' : b.severity, b.good_label, b.bad_label, b.input_type,
    JSON.stringify(fields), b.unit || null, b.kind === 'measure' ? b.min_value ?? null : null, b.kind === 'measure' ? b.max_value ?? null : null,
    b.required, b.needs_photo, b.is_active,
  ];
}

r.post('/:code/items', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const b = parse(ItemIn, req.body);
  const sec = (await query('SELECT id FROM form_sections WHERE id = $1 AND form_type_id = $2', [b.section_id, t.id])).rows[0];
  if (!sec) throw unprocessable('Bagian tidak dikenal.');
  const { rows } = await query(
    `INSERT INTO form_items (form_type_id, section_id, sort_order, label, text, spec, kind, severity, good_label, bad_label, input_type, fields,
                             unit, min_value, max_value, required, needs_photo, is_active)
     VALUES ($1,$2,(SELECT COALESCE(max(sort_order),0) + 1 FROM form_items WHERE section_id = $2),$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [t.id, b.section_id, ...itemValues(b)],
  );
  await audit(null, req.user, 'form_item.create', t.code, rows[0].id, { text: b.text });
  res.status(201).json({ id: rows[0].id });
});

r.put('/:code/items/:id', requireRole('admin'), async (req, res) => {
  const t = await getType(req.params.code);
  const id = idParam(req);
  const b = parse(ItemIn.extend({ move: z.enum(['up', 'down']).optional() }), req.body);
  const it = (await query('SELECT * FROM form_items WHERE id = $1 AND form_type_id = $2', [id, t.id])).rows[0];
  if (!it) throw notFound('Butir tidak ditemukan.');
  if (b.section_id !== it.section_id) {
    const sec = (await query('SELECT id FROM form_sections WHERE id = $1 AND form_type_id = $2', [b.section_id, t.id])).rows[0];
    if (!sec) throw unprocessable('Bagian tidak dikenal.');
  }
  await tx(async (c) => {
    await c.query(
      `UPDATE form_items SET section_id = $2, label = $3, text = $4, spec = $5, kind = $6, severity = $7, good_label = $8, bad_label = $9,
              input_type = $10, fields = $11::jsonb, unit = $12, min_value = $13, max_value = $14, required = $15, needs_photo = $16,
              is_active = $17, updated_at = now()
        WHERE id = $1`,
      [id, b.section_id, ...itemValues(b)],
    );
    if (b.move) await moveRow(c, 'form_items', { ...it, section_id: b.section_id }, 'section_id = $1', [b.section_id], b.move);
  });
  await audit(null, req.user, 'form_item.update', t.code, id, { text: b.text, is_active: b.is_active });
  res.json({ ok: true });
});

/** Geser urutan satu baris ke atas / bawah di dalam kelompoknya (tukar sort_order dengan tetangga). */
async function moveRow(c, table, row, groupWhere, groupParams, dir) {
  const all = (await c.query(`SELECT id, sort_order FROM ${table} WHERE ${groupWhere} ORDER BY sort_order, id`, groupParams)).rows;
  // rapikan nomor urut dulu supaya tidak ada yang kembar
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].sort_order !== i + 1) await c.query(`UPDATE ${table} SET sort_order = $2 WHERE id = $1`, [all[i].id, i + 1]);
    all[i].sort_order = i + 1;
  }
  const i = all.findIndex((x) => x.id === row.id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  await c.query(`UPDATE ${table} SET sort_order = $2 WHERE id = $1`, [all[i].id, all[j].sort_order]);
  await c.query(`UPDATE ${table} SET sort_order = $2 WHERE id = $1`, [all[j].id, all[i].sort_order]);
}

export default r;
