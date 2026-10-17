import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, scopeOf } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { addDays, currentShift } from '../time.js';
import { OPEN_FINDINGS_SQL } from './findings.js';
import { LIST_COLS } from './p2h.js';
import { ITEM_KEY } from './units.js';

const r = Router();
r.use(requireAuth);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

function unitState(u) {
  const required = u.status === 'running' || u.status === 'standby';
  const done = u.form_id != null;
  let state;
  if (u.open_aa > 0) state = 'stop';
  else if (u.open_a > 0) state = 'warn';
  else if (done) state = 'ok';
  else if (!required) state = 'off';
  else state = 'pending';
  return { required, done, state };
}

r.get('/', async (req, res) => {
  const settings = await getSettings();
  const cur = currentShift(new Date(), settings.shift1_start, settings.shift2_start);
  const date = isDate(req.query.date) ? String(req.query.date) : cur.shift_date;
  const shift = [1, 2].includes(Number(req.query.shift)) ? Number(req.query.shift) : cur.shift;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 60);
  // teknisi / pengawas hanya melihat site-nya (admin: semua)
  const scope = scopeOf(req.user);
  const sc = (col, n) => (scope != null ? ` AND ${col} = $${n}` : '');
  const sp = (...p) => (scope != null ? [...p, scope] : p);

  const [unitsQ, trendQ, topQ, siteFindQ, recentQ, openQ, sitesQ] = await Promise.all([
    query(
      `SELECT u.id, u.code, u.old_code, u.brand, u.model, u.status, u.site_id, u.location,
              f.id AS form_id, f.result, f.n_aa, f.n_a, f.inspector_name,
              (f.sup_signed_at IS NOT NULL) AS signed,
              COALESCE(f.filled_at, f.submitted_at) AS filled_at,
              COALESCE(oc.open_aa, 0)::int AS open_aa, COALESCE(oc.open_a, 0)::int AS open_a
         FROM units u
         LEFT JOIN p2h_forms f ON f.unit_id = u.id AND f.shift_date = $1 AND f.shift = $2
         LEFT JOIN LATERAL (
           SELECT count(DISTINCT ${ITEM_KEY}) FILTER (WHERE a.danger_code = 'AA') AS open_aa,
                  count(DISTINCT ${ITEM_KEY}) FILTER (WHERE a.danger_code = 'A') AS open_a
             FROM p2h_answers a JOIN p2h_forms f2 ON f2.id = a.form_id
            WHERE f2.unit_id = u.id AND a.condition <> 'baik' AND a.fix_status <> 'closed'
         ) oc ON true
        WHERE (u.status <> 'inactive' OR f.id IS NOT NULL)${sc('u.site_id', 3)}
        ORDER BY u.code`,
      sp(date, shift),
    ),
    query(
      `SELECT f.shift_date, f.shift, count(*)::int AS n, count(*) FILTER (WHERE f.result <> 'baik')::int AS with_findings
         FROM p2h_forms f JOIN units u ON u.id = f.unit_id
        WHERE f.shift_date BETWEEN $1 AND $2 AND u.status IN ('running','standby')${sc('f.site_id', 3)}
        GROUP BY 1, 2`,
      sp(addDays(date, -(days - 1)), date),
    ),
    query(
      `SELECT a.item_text, a.danger_code, a.section_code, count(*)::int AS n, count(DISTINCT f.unit_id)::int AS units
         FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
        WHERE a.condition <> 'baik' AND f.shift_date BETWEEN $1 AND $2${sc('f.site_id', 3)}
        GROUP BY a.item_text, a.danger_code, a.section_code
        ORDER BY n DESC, a.item_text LIMIT 6`,
      sp(addDays(date, -29), date),
    ),
    query(
      `SELECT f.site_id,
              count(*) FILTER (WHERE a.danger_code = 'AA')::int AS aa,
              count(*) FILTER (WHERE a.danger_code = 'A')::int AS a
         FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
        WHERE a.condition <> 'baik' AND f.shift_date BETWEEN $1 AND $2${sc('f.site_id', 3)}
        GROUP BY f.site_id`,
      sp(addDays(date, -29), date),
    ),
    query(
      `SELECT ${LIST_COLS} FROM p2h_forms f ${scope != null ? 'WHERE f.site_id = $1' : ''}
        ORDER BY f.shift_date DESC, f.shift DESC, f.id DESC LIMIT 8`,
      sp(),
    ),
    query(
      `SELECT * FROM (${OPEN_FINDINGS_SQL}) x ${scope != null ? 'WHERE site_id = $1' : ''} ORDER BY (danger_code = 'AA') DESC, first_seen_at ASC LIMIT 300`,
      sp(),
    ),
    query(`SELECT id, code, name, sort_order FROM sites WHERE is_active${sc('id', 1)} ORDER BY sort_order, id`, sp()),
  ]);

  // ---- per unit & per site ----
  const units = unitsQ.rows.map((u) => ({ ...u, ...unitState(u) }));
  const siteFind = Object.fromEntries(siteFindQ.rows.map((x) => [x.site_id, { aa: x.aa, a: x.a }]));
  const sites = sitesQ.rows.map((s) => {
    const mine = units.filter((u) => u.site_id === s.id);
    const req_ = mine.filter((u) => u.required);
    return {
      ...s,
      required: req_.length,
      done: req_.filter((u) => u.done).length,
      missing: req_.filter((u) => !u.done).length,
      stop: mine.filter((u) => u.state === 'stop').length,
      warn: mine.filter((u) => u.state === 'warn').length,
      findings_30d: siteFind[s.id] || { aa: 0, a: 0 },
      units: mine,
    };
  });

  const required = units.filter((u) => u.required);
  const kpi = {
    required: required.length,
    done: required.filter((u) => u.done).length,
    missing: required.filter((u) => !u.done).length,
    stop: units.filter((u) => u.state === 'stop').length,
    warn: units.filter((u) => u.state === 'warn').length,
    ok: units.filter((u) => u.state === 'ok').length,
    unsigned: units.filter((u) => u.done && !u.signed).length,
    forms_total: units.filter((u) => u.done).length,
    open_findings: openQ.rowCount,
    open_aa: openQ.rows.filter((x) => x.danger_code === 'AA').length,
  };
  kpi.compliance_pct = kpi.required ? Math.round((kpi.done / kpi.required) * 100) : 0;

  // ---- tren harian ----
  const shiftsDue = (dt) => (dt < cur.shift_date ? 2 : dt === cur.shift_date ? cur.shift : 0);
  const map = new Map();
  for (const t of trendQ.rows) {
    const k = t.shift_date;
    const e = map.get(k) || { s1: 0, s2: 0, findings: 0 };
    if (t.shift === 1) e.s1 = t.n;
    else e.s2 = t.n;
    e.findings += t.with_findings;
    map.set(k, e);
  }
  const trend = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = addDays(date, -i);
    const e = map.get(d) || { s1: 0, s2: 0, findings: 0 };
    trend.push({
      date: d,
      s1: e.s1,
      s2: e.s2,
      findings: e.findings,
      // shift yang sudah mulai: hari lalu = 2, hari ini = shift sekarang (1 atau 2), setelahnya = 0
      pct: kpi.required && shiftsDue(d) ? Math.min(100, Math.round(((e.s1 + e.s2) / (shiftsDue(d) * kpi.required)) * 100)) : 0,
    });
  }

  res.json({
    context: {
      date,
      shift,
      is_current: date === cur.shift_date && shift === cur.shift,
      current: cur,
    },
    kpi,
    sites,
    trend,
    top_items: topQ.rows,
    open_findings: { total: openQ.rowCount, items: openQ.rows.slice(0, 8) },
    recent: recentQ.rows,
    generated_at: new Date().toISOString(),
  });
});

export default r;
