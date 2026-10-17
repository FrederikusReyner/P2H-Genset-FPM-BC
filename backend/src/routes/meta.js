import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { requireAuth, scopeOf } from '../middleware/auth.js';
import { PARAMS } from '../params.js';
import { getSettings } from '../services/settings.js';
import { currentShift, wita } from '../time.js';

const r = Router();

/** Daftar cek aktif dikelompokkan per bagian, nomor urut dihitung per bagian (seperti di form kertas). */
export async function loadChecklist(client, { includeInactive = false } = {}) {
  const run = client ? client.query.bind(client) : query;
  const secs = (await run('SELECT id, code, title, sort_order FROM checklist_sections ORDER BY sort_order, id')).rows;
  const items = (
    await run(
      `SELECT id, section_id, sort_order, text, hint, danger_code, is_active
         FROM checklist_items ${includeInactive ? '' : 'WHERE is_active'}
        ORDER BY sort_order, id`,
    )
  ).rows;
  return secs.map((s) => {
    const mine = items.filter((i) => i.section_id === s.id);
    let no = 0;
    return {
      id: s.id,
      code: s.code,
      title: s.title,
      sort_order: s.sort_order,
      items: mine.map((i) => ({
        id: i.id,
        no: i.is_active ? ++no : null,
        text: i.text,
        hint: i.hint,
        danger_code: i.danger_code,
        sort_order: i.sort_order,
        is_active: i.is_active,
      })),
    };
  });
}

r.get('/', requireAuth, async (req, res) => {
  const scope = scopeOf(req.user); // teknisi / pengawas hanya diberi site-nya sendiri
  const [sites, checklist, settings] = await Promise.all([
    query(`SELECT id, code, name, job_site, sort_order FROM sites WHERE is_active ${scope != null ? 'AND id = $1' : ''} ORDER BY sort_order, id`, scope != null ? [scope] : []),
    loadChecklist(null),
    getSettings(),
  ]);
  const now = new Date();
  const shift = currentShift(now, settings.shift1_start, settings.shift2_start);
  res.json({
    server_time: now.toISOString(),
    wita: wita(now),
    shift,
    sites: sites.rows,
    checklist,
    params: PARAMS,
    settings: {
      shift1_start: settings.shift1_start,
      shift2_start: settings.shift2_start,
      require_signature: settings.require_signature,
      a_deadline_hours: settings.a_deadline_hours,
    },
    version: config.version,
  });
});

export default r;
