import { query, tx } from '../db.js';
import { FORM_SEED } from './seed.js';

/** Masukkan butir-butir satu bagian. */
async function insertItems(c, typeId, sectionId, items, photoDefault) {
  let order = 0;
  for (const it of items) {
    order += 1;
    await c.query(
      `INSERT INTO form_items (form_type_id, section_id, sort_order, label, text, spec, kind, severity, good_label, bad_label,
                               input_type, fields, unit, min_value, max_value, required, needs_photo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17)`,
      [
        typeId, sectionId, order, it.label ?? null, it.text, it.spec ?? null, it.kind ?? 'check', it.severity ?? 'fix',
        it.good ?? 'Baik', it.bad ?? 'Rusak', it.input_type ?? 'text', JSON.stringify(it.fields ?? []), it.unit ?? null,
        it.min_value ?? null, it.max_value ?? null, it.required ?? true, it.needs_photo ?? photoDefault,
      ],
    );
  }
}

async function insertSections(c, typeId, subjectId, sections, photoDefault) {
  let order = 0;
  for (const s of sections) {
    order += 1;
    const { rows } = await c.query(
      `INSERT INTO form_sections (form_type_id, subject_id, title, note, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [typeId, subjectId, s.title, s.note ?? null, order],
    );
    await insertItems(c, typeId, rows[0].id, s.items ?? [], photoDefault);
  }
}

/**
 * Isi awal jenis-jenis form digital. Tiap jenis dimuat sekali (ditandai di tabel settings),
 * jadi perubahan admin tidak tertimpa saat server restart, dan jenis baru di versi berikutnya tetap masuk.
 */
export async function seedForms(log = console.log, list = FORM_SEED) {
  const { rows: sites } = await query('SELECT id, code FROM sites');
  const siteId = Object.fromEntries(sites.map((s) => [s.code, s.id]));
  for (const t of list) {
    const flag = `_seeded_form_${t.code}`;
    const done = await query('SELECT 1 FROM settings WHERE key = $1', [flag]);
    if (done.rowCount) continue;
    await tx(async (c) => {
      const ex = await c.query('SELECT id FROM form_types WHERE code = $1', [t.code]);
      if (!ex.rowCount) {
        const { rows } = await c.query(
          `INSERT INTO form_types (code, name, short_name, description, icon, period, subject_label, header_fields, fix_hours,
                                   photo_required, filler_label, verifier_label, doc_no, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [
            t.code, t.name, t.short_name, t.description ?? null, t.icon ?? 'list', t.period ?? 'none', t.subject_label ?? 'Unit',
            JSON.stringify(t.header_fields ?? []), t.fix_hours ?? 24, t.photo_required ?? true, t.filler_label ?? 'Pelaksana',
            t.verifier_label ?? 'Pengawas', t.doc_no ?? null, t.sort_order ?? 0,
          ],
        );
        const typeId = rows[0].id;
        await insertSections(c, typeId, null, t.sections ?? [], t.photo_required ?? true);
        let sOrder = 0;
        for (const s of t.subjects ?? []) {
          sOrder += 1;
          const sid = siteId[s.site];
          if (!sid) continue;
          const sub = await c.query(
            `INSERT INTO form_subjects (form_type_id, site_id, name, detail, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [typeId, sid, s.name, s.detail ?? null, sOrder],
          );
          await insertSections(c, typeId, sub.rows[0].id, s.sections ?? [], t.photo_required ?? true);
        }
      }
      await c.query(`INSERT INTO settings (key, value) VALUES ($1, 'true'::jsonb) ON CONFLICT (key) DO NOTHING`, [flag]);
    });
    log(`[seed] form "${t.short_name}" dimuat`);
  }
}
