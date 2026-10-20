// Data untuk rekap Excel PMMR: unit (urutan seperti di Excel PMMR), HM awal / akhir tiap bulan, dan kWh bulanan.
import { query } from '../../db.js';
import { scopeOf } from '../../middleware/auth.js';

/** Urutan site di rekap PMMR (sama dengan Excel contoh): Lati, Binungan, Suaran, Sambarata, Gurimbang. */
export const SITE_ORDER = ['LMO', 'BMO', 'SRN', 'SMO', 'GMO'];

const toNum = (v) => (v === null || v === undefined ? null : Number(v));
const pad2 = (n) => String(n).padStart(2, '0');

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * HM awal / akhir tiap bulan untuk satu unit.
 *  - HM akhir bulan = pembacaan terakhir di P2H bulan itu (HM akhir, atau HM awal bila HM akhir belum diisi),
 *    kalau tidak ada P2H pakai data impor Excel PMMR.
 *  - HM awal bulan = HM akhir bulan sebelumnya (seperti di Excel PMMR); kalau tidak ada, pembacaan pertama bulan itu.
 */
export function buildMonthlyHm(formsByMonth, importedByMonth) {
  const own = [];
  const out = [];
  for (let m = 1; m <= 12; m += 1) {
    const fr = formsByMonth[m] || [];
    let p2hEnd = null;
    for (let i = fr.length - 1; i >= 0 && p2hEnd === null; i -= 1) p2hEnd = fr[i].hm_end ?? fr[i].hm_start ?? null;
    let p2hStart = null;
    for (let i = 0; i < fr.length && p2hStart === null; i += 1) p2hStart = fr[i].hm_start ?? fr[i].hm_end ?? null;
    const imp = importedByMonth[m];
    const end = p2hEnd ?? toNum(imp?.hm_end);
    own[m] = { start: p2hStart ?? toNum(imp?.hm_start), end, source: p2hEnd !== null ? 'P2H' : imp && end !== null ? 'impor' : null };
  }
  for (let m = 1; m <= 12; m += 1) {
    const prevEnd = m > 1 ? out[m - 2].end : null;
    out.push({ month: m, start: prevEnd ?? own[m].start, end: own[m].end, source: own[m].source });
  }
  return out;
}

/**
 * Semua yang dibutuhkan rekap PMMR untuk satu tahun dan bulan.
 * user: admin melihat semua site; teknisi / pengawas hanya site-nya.
 */
export async function loadPmmrData(user, year, month) {
  const scope = scopeOf(user);
  const p = scope != null ? [scope] : [];
  const sites = (await query('SELECT id, code, name, sort_order FROM sites WHERE is_active ORDER BY sort_order, id')).rows;
  const siteRank = (code) => {
    const i = SITE_ORDER.indexOf(code);
    return i < 0 ? 99 : i;
  };
  const units = (
    await query(
      `SELECT u.*, s.code AS site_code, s.name AS site_name
         FROM units u JOIN sites s ON s.id = u.site_id
        ${scope != null ? "WHERE u.site_id = $1 AND u.pmmr_group = 'produksi'" : ''}`,
      p,
    )
  ).rows;
  units.sort(
    (a, b) =>
      (a.pmmr_group === 'arsip') - (b.pmmr_group === 'arsip') ||
      siteRank(a.site_code) - siteRank(b.site_code) ||
      (a.pmmr_sort ?? 9999) - (b.pmmr_sort ?? 9999) ||
      String(a.code).localeCompare(String(b.code)),
  );

  const ids = units.map((u) => u.id);
  const formRows = ids.length
    ? (
        await query(
          `SELECT unit_id, extract(month FROM shift_date)::int AS m, hm_start, hm_end
             FROM p2h_forms
            WHERE unit_id = ANY($1::int[]) AND shift_date BETWEEN $2 AND $3
            ORDER BY unit_id, shift_date, shift, id`,
          [ids, `${year}-01-01`, `${year}-12-31`],
        )
      ).rows
    : [];
  const imported = ids.length
    ? (await query('SELECT unit_id, month, hm_start, hm_end FROM unit_hm_monthly WHERE unit_id = ANY($1::int[]) AND year = $2', [ids, year])).rows
    : [];
  const kwhRows = ids.length ? (await query('SELECT unit_id, kwh FROM unit_kwh_monthly WHERE unit_id = ANY($1::int[]) AND year = $2 AND month = $3', [ids, year, month])).rows : [];

  const formsBy = new Map();
  for (const f of formRows) {
    const e = formsBy.get(f.unit_id) || {};
    (e[f.m] ||= []).push({ hm_start: toNum(f.hm_start), hm_end: toNum(f.hm_end) });
    formsBy.set(f.unit_id, e);
  }
  const impBy = new Map();
  for (const r of imported) {
    const e = impBy.get(r.unit_id) || {};
    e[r.month] = r;
    impBy.set(r.unit_id, e);
  }
  const kwhBy = new Map(kwhRows.map((r) => [r.unit_id, toNum(r.kwh)]));

  for (const u of units) {
    u.hm = buildMonthlyHm(formsBy.get(u.id) || {}, impBy.get(u.id) || {});
    u.hm_month = u.hm[month - 1];
    u.kwh = kwhBy.get(u.id) ?? null;
  }
  const last = daysInMonth(year, month);
  return { year, month, last_day: last, month_end: `${year}-${pad2(month)}-${pad2(last)}`, scope, sites, units };
}
