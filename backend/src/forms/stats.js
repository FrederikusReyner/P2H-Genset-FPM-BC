import { query } from '../db.js';
import { scopeOf } from '../middleware/auth.js';
import { BIWEEK_EPOCH, addDays, daysBetween, periodRange, wita } from '../time.js';

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

/* =====================================================================
   Rekap / dashboard satu jenis form: tren, kepatuhan, temuan terbanyak, per objek, per site
   ===================================================================== */

/** Deret tanggal awal tiap ember (hari / minggu / bulan) dari `from` sampai `to`. */
export function buckets(kind, from, to) {
  const out = [];
  let d = kind === 'day' ? from : periodRange(kind, from).from;
  while (d <= to && out.length < 400) {
    out.push(d);
    d = kind === 'day' ? addDays(d, 1) : kind === 'week' ? addDays(d, 7) : kind === 'biweek' ? addDays(d, 14) : addDays(periodRange(kind, d).to, 1);
  }
  return out;
}
const truncSql = (kind, col) =>
  kind === 'day'
    ? col
    : kind === 'biweek'
      ? `(DATE '${BIWEEK_EPOCH}' + (floor((${col} - DATE '${BIWEEK_EPOCH}') / 14.0) * 14)::int)`
      : kind === 'half'
      ? `make_date(EXTRACT(YEAR FROM ${col})::int, CASE WHEN EXTRACT(MONTH FROM ${col}) <= 6 THEN 1 ELSE 7 END, 1)`
      : `date_trunc('${kind}', ${col})::date`;

export async function formStats(t, q, user) {
  const today = wita().date;
  const to = isDate(q.to) && q.to <= today ? q.to : today;
  let from = isDate(q.from) && q.from <= to ? q.from : addDays(to, -29);
  if (daysBetween(from, to) > 800) from = addDays(to, -800);
  const span = daysBetween(from, to) + 1;
  const bucket = span <= 45 ? 'day' : span <= 200 ? 'week' : 'month';

  const scope = scopeOf(user);
  const site = scope ?? (Number(q.site_id) || null);
  const p = [t.id, from, to];
  const siteR = site ? (p.push(site), `AND r.site_id = $${p.length}`) : '';

  const [trendQ, topQ, subjQ, sumQ, openQ, siteQ, verQ, closeQ] = await Promise.all([
    query(
      `SELECT ${truncSql(bucket, 'r.record_date')} AS b,
              count(*) FILTER (WHERE r.result = 'ok')::int AS ok,
              count(*) FILTER (WHERE r.result = 'finding')::int AS finding,
              count(*) FILTER (WHERE r.result = 'stop')::int AS stop
         FROM form_records r WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR}
        GROUP BY 1`,
      p,
    ),
    query(
      `SELECT a.item_text, a.section_title, max(a.severity) FILTER (WHERE a.severity = 'stop') IS NOT NULL AS has_stop,
              count(*)::int AS n, count(DISTINCT r.subject_id)::int AS subjects
         FROM form_answers a JOIN form_records r ON r.id = a.record_id
        WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR} AND a.is_finding
        GROUP BY a.item_text, a.section_title ORDER BY n DESC, a.item_text LIMIT 8`,
      p,
    ),
    query(
      `SELECT r.subject_id AS id, max(r.subject_name) AS name, max(r.site_name) AS site_name, count(DISTINCT r.id)::int AS records,
              count(a.id) FILTER (WHERE a.severity = 'stop')::int AS stop, count(a.id) FILTER (WHERE a.severity <> 'stop')::int AS fix
         FROM form_records r LEFT JOIN form_answers a ON a.record_id = r.id AND a.is_finding
        WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR}
        GROUP BY r.subject_id ORDER BY (count(a.id)) DESC, max(r.subject_name) LIMIT 12`,
      p,
    ),
    query(
      `SELECT count(*)::int AS records,
              count(*) FILTER (WHERE r.result <> 'ok')::int AS with_findings,
              count(*) FILTER (WHERE r.result = 'stop')::int AS with_stop,
              count(*) FILTER (WHERE r.sup_signed_at IS NOT NULL)::int AS verified,
              COALESCE(round(avg(EXTRACT(EPOCH FROM (r.sup_signed_at - COALESCE(r.filled_at, r.submitted_at))) / 3600) FILTER (WHERE r.sup_signed_at IS NOT NULL)::numeric, 1), NULL) AS verify_hours,
              (SELECT count(*)::int FROM form_answers a2 JOIN form_records r2 ON r2.id = a2.record_id
                WHERE r2.form_type_id = $1 AND r2.record_date BETWEEN $2 AND $3 ${siteR.replace(/r\./g, 'r2.')} AND a2.is_finding) AS findings
         FROM form_records r WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR}`,
      p,
    ),
    // temuan yang masih terbuka sekarang (tidak dibatasi rentang tanggal)
    query(
      `SELECT count(*) FILTER (WHERE a.severity = 'stop')::int AS stop, count(*) FILTER (WHERE a.severity <> 'stop')::int AS fix,
              count(*) FILTER (WHERE a.severity <> 'stop' AND COALESCE(r.filled_at, r.submitted_at) + make_interval(hours => $2) < now())::int AS overdue
         FROM form_answers a JOIN form_records r ON r.id = a.record_id
        WHERE r.form_type_id = $1 AND a.is_finding AND a.fix_status <> 'closed' ${site ? 'AND r.site_id = $3' : ''}`,
      site ? [t.id, t.fix_hours, site] : [t.id, t.fix_hours],
    ),
    scope != null || site
      ? Promise.resolve({ rows: [] })
      : query(
          `SELECT s.id, s.name, count(DISTINCT r.id)::int AS records,
                  count(a.id) FILTER (WHERE a.severity = 'stop')::int AS stop, count(a.id) FILTER (WHERE a.severity <> 'stop')::int AS fix
             FROM sites s
             LEFT JOIN form_records r ON r.site_id = s.id AND r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3
             LEFT JOIN form_answers a ON a.record_id = r.id AND a.is_finding
            WHERE s.is_active GROUP BY s.id ORDER BY s.sort_order, s.id`,
          p,
        ),
    query(
      `SELECT count(*)::int AS n FROM form_records r WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR} AND r.sup_signed_at IS NULL`,
      p,
    ),
    query(
      `SELECT count(*)::int AS closed,
              round(avg(EXTRACT(EPOCH FROM (a.fix_at - COALESCE(r.filled_at, r.submitted_at))) / 3600)::numeric, 1) AS close_hours
         FROM form_answers a JOIN form_records r ON r.id = a.record_id
        WHERE r.form_type_id = $1 AND a.is_finding AND a.fix_status = 'closed' AND a.fix_at::date BETWEEN $2 AND $3 ${siteR}`,
      p,
    ),
  ]);

  // tren: semua ember ditampilkan, termasuk yang kosong
  const byB = new Map(trendQ.rows.map((x) => [x.b, x]));
  const trend = buckets(bucket, from, to).map((b) => ({ start: b, ok: byB.get(b)?.ok ?? 0, finding: byB.get(b)?.finding ?? 0, stop: byB.get(b)?.stop ?? 0 }));

  // kepatuhan: per periode form (shift / hari -> per hari, minggu, bulan, kuartal, semester); "sesuai kebutuhan" tidak dihitung
  let compliance = null;
  if (t.period !== 'none') {
    const kind = t.period === 'shift' || t.period === 'day' ? 'day' : t.period;
    const cp = [t.id];
    const cSite = site ? (cp.push(site), `AND site_id = $${cp.length}`) : '';
    const total = (await query(`SELECT count(*)::int AS n FROM form_subjects WHERE form_type_id = $1 AND is_active ${cSite}`, cp)).rows[0].n;
    let cFrom = from;
    if (kind === 'day' && span > 45) cFrom = addDays(to, -44); // maks 45 hari supaya grafik tetap terbaca
    // periode yang terpotong di awal rentang dihitung utuh (mis. kuartal ini sejak tanggal 1 bulan pertamanya)
    if (kind !== 'day') cFrom = periodRange(kind, cFrom).from;
    const dq = await query(
      `SELECT ${truncSql(kind, 'r.record_date')} AS b,
              count(DISTINCT ${t.period === 'shift' ? "r.subject_id::text || '-' || r.shift" : 'r.subject_id'})::int AS done
         FROM form_records r JOIN form_subjects s ON s.id = r.subject_id AND s.is_active
        WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR}
        GROUP BY 1`,
      [t.id, cFrom, to, ...(site ? [site] : [])],
    );
    const doneBy = new Map(dq.rows.map((x) => [x.b, x.done]));
    const expected = total * (t.period === 'shift' ? 2 : 1);
    compliance = {
      kind,
      per: t.period,
      subjects: total,
      expected_per_bucket: expected,
      items: buckets(kind, cFrom, to).map((b) => {
        const done = doneBy.get(b) ?? 0;
        return { start: b, done, expected, pct: expected ? Math.min(100, Math.round((done / expected) * 100)) : 0 };
      }),
    };
  }

  const s = sumQ.rows[0];
  return {
    type: { code: t.code, short_name: t.short_name, period: t.period, fix_hours: t.fix_hours, subject_label: t.subject_label },
    range: { from, to, bucket, days: span },
    summary: {
      records: s.records,
      with_findings: s.with_findings,
      with_stop: s.with_stop,
      findings: s.findings,
      verified: s.verified,
      unverified: verQ.rows[0].n,
      verify_hours: s.verify_hours,
      closed: closeQ.rows[0].closed,
      close_hours: closeQ.rows[0].close_hours,
      open_stop: openQ.rows[0].stop,
      open_fix: openQ.rows[0].fix,
      overdue: openQ.rows[0].overdue,
    },
    trend,
    compliance,
    top_items: topQ.rows,
    subjects: subjQ.rows,
    sites: siteQ.rows,
  };
}
