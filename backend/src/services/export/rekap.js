import { query } from '../../db.js';
import { scopeOf } from '../../middleware/auth.js';
import { buildListFilter, LIST_COLS } from '../../routes/p2h.js';
import { CONDITION_LABEL, FIX_LABEL, RESULT_LABEL, plain } from '../../text.js';
import {
  PERIODS, PERIOD_LABEL, addDays, currentShift, dayNameID, dayShort, daysBetween, longDate, monthShort, periodRange,
  periodTitle, rangeShort, shiftLabel, shortDate, stampWITA, weekdayIndex, wita,
} from '../../time.js';
import { getSettings } from '../settings.js';
import { fmtNum } from './common.js';
import { RENDER } from './dashboard-report.js';
import { findingSummary, hours } from './form-rekap.js';
import { COLOR } from './visual.js';

const LIMITS = {
  xlsx: { forms: 20000, findings: 20000 },
  doc: { forms: 3000, findings: 600 }, // PDF / Word: dibatasi supaya tetap enak dibaca
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

/**
 * Perkiraan jumlah P2H yang seharusnya masuk (genset jalan / standby x shift yang sudah mulai).
 * Mengembalikan fungsi (dari, sampai) -> jumlah, supaya bisa dihitung per hari / minggu / bulan.
 */
async function expectedCounter(q, user) {
  const scope = scopeOf(user);
  const where = ["status IN ('running','standby')"];
  const p = [];
  if (q.unit_id && Number(q.unit_id)) {
    p.push(Number(q.unit_id));
    where.push(`id = $${p.length}`);
  }
  if (scope != null) {
    p.push(scope);
    where.push(`site_id = $${p.length}`);
  } else if (q.site_id && Number(q.site_id)) {
    p.push(Number(q.site_id));
    where.push(`site_id = $${p.length}`);
  }
  const units = (await query(`SELECT count(*)::int AS n FROM units WHERE ${where.join(' AND ')}`, p)).rows[0].n;
  const settings = await getSettings();
  const cur = currentShift(new Date(), settings.shift1_start, settings.shift2_start);
  const only = [1, 2].includes(Number(q.shift)) ? Number(q.shift) : null;
  return (from, to) => {
    const end = to && to < cur.shift_date ? to : cur.shift_date;
    if (!from || from > end) return 0;
    let n = 0;
    const days = daysBetween(from, end) + 1;
    for (let i = 0; i < days; i += 1) {
      const d = addDays(from, i);
      const due = d < cur.shift_date ? [1, 2] : cur.shift === 2 ? [1, 2] : [1];
      n += only ? (due.includes(only) ? 1 : 0) : due.length;
    }
    return units * n;
  };
}

const zero = () => ({ total: 0, baik: 0, temuan: 0, stop: 0, verified: 0 });
function add(e, r) {
  e.total += r.total;
  e.baik += r.baik;
  e.temuan += r.temuan;
  e.stop += r.stop;
  e.verified += r.verified;
  return e;
}

/** Susun baris rincian per hari / minggu / bulan dari hitungan harian. */
function makeBuckets(period, from, to, byDay) {
  const map = new Map(byDay.map((r) => [r.d, r]));
  const rows = [];
  let unit = 'Hari';
  const days = from && to ? daysBetween(from, to) + 1 : 0;
  const mode = period === 'year' ? 'month' : period === 'month' ? 'week' : period === 'week' ? 'day' : days > 0 && days <= 31 ? 'day' : days > 0 && days <= 120 ? 'week' : 'month';
  if (mode === 'day') {
    for (let i = 0; i < days; i += 1) {
      const d = addDays(from, i);
      rows.push({ label: dayShort(d), start: d, end: d, ...add(zero(), map.get(d) || zero()) });
    }
  } else if (mode === 'week') {
    unit = 'Minggu';
    let start = from;
    let n = 0;
    while (start <= to) {
      const monday = addDays(start, -weekdayIndex(start));
      const end = addDays(monday, 6) < to ? addDays(monday, 6) : to;
      n += 1;
      const e = zero();
      for (let d = start; d <= end; d = addDays(d, 1)) add(e, map.get(d) || zero());
      rows.push({ label: `Minggu ke-${n} (${rangeShort(start, end)})`, start, end, ...e });
      start = addDays(end, 1);
    }
  } else {
    unit = 'Bulan';
    const byMonth = new Map();
    for (const r of byDay) byMonth.set(r.d.slice(0, 7), add(byMonth.get(r.d.slice(0, 7)) || zero(), r));
    if (period === 'year') {
      for (let m = 1; m <= 12; m += 1) {
        const key = `${from.slice(0, 4)}-${String(m).padStart(2, '0')}`;
        rows.push({ label: monthShort(key), start: `${key}-01`, end: periodRange('month', `${key}-01`).to, ...(byMonth.get(key) || zero()) });
      }
    } else {
      for (const key of [...byMonth.keys()].sort()) rows.push({ label: monthShort(key), start: `${key}-01`, end: periodRange('month', `${key}-01`).to, ...byMonth.get(key) });
    }
  }
  return { unit, kind: mode, rows };
}

/**
 * Ambil data rekap. Penyaring: periode (period = week | month | year + date), atau from / to,
 * site, unit, shift, hasil. Hitungan ringkasan memakai SQL (akurat walau datanya banyak);
 * daftar P2H dan temuan dibatasi jumlahnya.
 * detail = false -> hanya ringkasan (dipakai pratinjau di layar).
 */
export async function loadRekap(q, user, { kind = 'doc', detail = true } = {}) {
  const period = PERIODS.includes(q.period) ? q.period : null;
  let from = isDate(q.from) ? q.from : null;
  let to = isDate(q.to) ? q.to : null;
  if (period) {
    const anchor = isDate(q.date) ? q.date : wita().date;
    ({ from, to } = periodRange(period, anchor));
  }
  const qq = { ...q, from, to };
  const f = buildListFilter(qq, user);
  const lim = LIMITS[kind === 'xlsx' ? 'xlsx' : 'doc'];
  // rincian per P2H tidak dicetak di PDF / Word untuk rekap tahunan (terlalu panjang); Excel tetap lengkap
  const listForms = detail && !(period === 'year' && kind !== 'xlsx');

  const [sumQ, siteQ, dayQ, findQ] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE f.result = 'baik')::int AS baik,
              count(*) FILTER (WHERE f.result = 'temuan_a')::int AS temuan,
              count(*) FILTER (WHERE f.result = 'stop_aa')::int AS stop,
              count(*) FILTER (WHERE f.sup_signed_at IS NOT NULL)::int AS verified
         FROM p2h_forms f ${f.sql}`,
      f.params,
    ),
    query(
      `SELECT f.site_name AS site, s.sort_order,
              count(*)::int AS total,
              count(*) FILTER (WHERE f.result = 'baik')::int AS baik,
              count(*) FILTER (WHERE f.result = 'temuan_a')::int AS temuan,
              count(*) FILTER (WHERE f.result = 'stop_aa')::int AS stop,
              count(*) FILTER (WHERE f.sup_signed_at IS NOT NULL)::int AS verified
         FROM p2h_forms f JOIN sites s ON s.id = f.site_id ${f.sql}
        GROUP BY f.site_name, s.sort_order ORDER BY s.sort_order`,
      f.params,
    ),
    query(
      `SELECT f.shift_date::text AS d,
              count(*)::int AS total,
              count(*) FILTER (WHERE f.result = 'baik')::int AS baik,
              count(*) FILTER (WHERE f.result = 'temuan_a')::int AS temuan,
              count(*) FILTER (WHERE f.result = 'stop_aa')::int AS stop,
              count(*) FILTER (WHERE f.sup_signed_at IS NOT NULL)::int AS verified
         FROM p2h_forms f ${f.sql} GROUP BY f.shift_date ORDER BY f.shift_date`,
      f.params,
    ),
    query(
      `SELECT count(*) FILTER (WHERE a.danger_code = 'AA')::int AS aa,
              count(*) FILTER (WHERE a.danger_code = 'A')::int AS a,
              count(*) FILTER (WHERE a.fix_status = 'closed')::int AS closed,
              count(*)::int AS total
         FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
         ${f.sql ? `${f.sql} AND` : 'WHERE'} a.condition <> 'baik'`,
      f.params,
    ),
  ]);

  // untuk tampilan dashboard: butir paling sering bermasalah, temuan per unit, lama verifikasi & perbaikan
  const AND = f.sql ? `${f.sql} AND` : 'WHERE';
  const [topQ, unitQ, timeQ] = await Promise.all([
    query(
      `SELECT a.item_text, a.section_title, bool_or(a.danger_code = 'AA') AS has_stop, count(*)::int AS n, count(DISTINCT f.unit_id)::int AS units
         FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
         ${AND} a.condition <> 'baik'
        GROUP BY a.item_text, a.section_title ORDER BY n DESC, a.item_text LIMIT 8`,
      f.params,
    ),
    query(
      `SELECT f.unit_id AS id, max(f.unit_code) AS name, max(f.site_name) AS site_name, count(DISTINCT f.id)::int AS total,
              count(a.id) FILTER (WHERE a.danger_code = 'AA')::int AS stop, count(a.id) FILTER (WHERE a.danger_code <> 'AA')::int AS fix
         FROM p2h_forms f LEFT JOIN p2h_answers a ON a.form_id = f.id AND a.condition <> 'baik'
         ${f.sql}
        GROUP BY f.unit_id ORDER BY count(a.id) DESC, max(f.unit_code) LIMIT 12`,
      f.params,
    ),
    query(
      `SELECT round(avg(EXTRACT(EPOCH FROM (f.sup_signed_at - COALESCE(f.filled_at, f.submitted_at))) / 3600) FILTER (WHERE f.sup_signed_at IS NOT NULL)::numeric, 1) AS verify_hours,
              (SELECT round(avg(EXTRACT(EPOCH FROM (a.fix_at - COALESCE(f.filled_at, f.submitted_at))) / 3600)::numeric, 1)
                 FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id ${AND} a.fix_status = 'closed' AND a.fix_at IS NOT NULL) AS close_hours
         FROM p2h_forms f ${f.sql}`,
      f.params,
    ),
  ]);

  const forms = listForms
    ? (
        await query(
          `SELECT ${LIST_COLS} FROM p2h_forms f ${f.sql}
            ORDER BY f.shift_date DESC, f.shift DESC, f.unit_code LIMIT ${lim.forms}`,
          f.params,
        )
      ).rows
    : [];
  const findings = detail
    ? (
        await query(
          `SELECT a.id, a.form_id, a.section_title, a.item_text, a.danger_code, a.condition, a.note, a.fix_status, a.fix_note,
                  a.fix_by_name, a.fix_at, f.shift_date, f.shift, f.unit_code, f.site_name, f.inspector_name,
                  (SELECT count(*)::int FROM p2h_photos ph WHERE ph.answer_id = a.id) AS n_photos
             FROM p2h_answers a JOIN p2h_forms f ON f.id = a.form_id
             ${f.sql ? `${f.sql} AND` : 'WHERE'} a.condition <> 'baik'
            ORDER BY f.shift_date DESC, f.shift DESC, f.unit_code, a.section_order, a.item_no
            LIMIT ${lim.findings}`,
          f.params,
        )
      ).rows
    : [];

  const scope = scopeOf(user);
  let siteName = null;
  let unitCode = null;
  const siteId = scope != null ? scope : Number(q.site_id) || null;
  if (siteId) siteName = (await query('SELECT name FROM sites WHERE id = $1', [siteId])).rows[0]?.name ?? null;
  if (q.unit_id) unitCode = (await query('SELECT code FROM units WHERE id = $1', [Number(q.unit_id) || 0])).rows[0]?.code ?? null;

  const s = sumQ.rows[0];
  const expectedFor = await expectedCounter(qq, user);
  const expected = expectedFor(from, to);
  const sum = {
    total: s.total,
    baik: s.baik,
    temuan: s.temuan,
    stop: s.stop,
    verified: s.verified,
    unverified: s.total - s.verified,
    expected,
    compliance: expected ? Math.min(100, Math.round((s.total / expected) * 100)) : null,
    verify_hours: timeQ.rows[0].verify_hours,
    close_hours: timeQ.rows[0].close_hours,
  };
  const buckets = makeBuckets(period, from, to, dayQ.rows);
  for (const b of buckets.rows) {
    b.expected = b.start ? expectedFor(b.start, b.end) : 0;
    b.pct = b.expected ? Math.min(100, Math.round((b.total / b.expected) * 100)) : null;
  }

  const parts = [];
  parts.push(period ? `${PERIOD_LABEL[period]} · ${periodTitle(period, from, to)}` : from || to ? `Periode ${from ? longDate(from) : '…'} s.d. ${to ? longDate(to) : '…'}` : 'Semua tanggal');
  if (siteName) parts.push(`Site ${siteName}`);
  if (unitCode) parts.push(`Unit ${unitCode}`);
  if ([1, 2].includes(Number(q.shift))) parts.push(`Shift ${shiftLabel(Number(q.shift))}`);
  if (q.result && RESULT_LABEL[q.result]) parts.push(`Hasil: ${RESULT_LABEL[q.result]}`);

  const tag = period ? `${PERIOD_LABEL[period]}_${from}${period === 'week' ? `_sd_${to}` : ''}` : `${from || 'awal'}_sd_${to || 'akhir'}`;
  return {
    period,
    from,
    to,
    forms,
    findings,
    findingsSum: findQ.rows[0],
    sum,
    sites: siteQ.rows,
    buckets,
    top_items: topQ.rows,
    units: unitQ.rows,
    formsOmitted: detail && !listForms,
    truncatedForms: listForms && forms.length >= lim.forms,
    truncatedFindings: detail && findings.length >= lim.findings,
    limits: lim,
    title: period ? `REKAP P2H GENSET · ${PERIOD_LABEL[period].toUpperCase()}` : 'REKAP P2H GENSET',
    subtitle: parts.join(' · '),
    filename: `Rekap_P2H_${tag}${siteName ? `_${siteName}` : ''}`.replace(/[^A-Za-z0-9._-]+/g, '-'),
    generated: stampWITA(new Date()),
  };
}

/** Ringkasan untuk layar (tanpa daftar P2H). */
export async function rekapPreview(q, user) {
  const d = await loadRekap(q, user, { detail: false });
  return {
    period: d.period,
    from: d.from,
    to: d.to,
    title: d.title,
    subtitle: d.subtitle,
    sum: d.sum,
    sites: d.sites,
    bucket_unit: d.buckets.unit,
    bucket_kind: d.buckets.kind,
    buckets: d.buckets.rows,
    findings: d.findingsSum,
    top_items: d.top_items,
    units: d.units,
  };
}

const unitLabel = (x) => (x.unit_old_code ? `${x.unit_code} (${x.unit_old_code})` : x.unit_code);
const modelLabel = (x) => [x.unit_brand, x.unit_model].filter(Boolean).join(' ');
const dateLabel = (d) => `${dayNameID(d)} ${shortDate(d)}`;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const pctN = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const tone = (p) => (p == null ? COLOR.muted : p >= 100 ? COLOR.ok : p >= 50 ? COLOR.warn : COLOR.stop);
const verLabel = (x) => (x.verified ? `Terverifikasi: ${x.sup_name}` : 'Menunggu verifikasi');
const RESULT_COLOR = { baik: COLOR.ok, temuan_a: COLOR.warn, stop_aa: COLOR.stop };

const notes = (d) => {
  const n = [];
  if (d.formsOmitted) n.push('Rincian per P2H tidak dicetak untuk rekap tahunan di PDF / Word supaya tidak terlalu panjang. Unduh Excel untuk rincian lengkap, atau pilih rekap bulanan.');
  if (d.truncatedForms) n.push(`Daftar P2H dibatasi ${d.limits.forms} baris terbaru. Ringkasan di atas tetap menghitung semua data.`);
  if (d.truncatedFindings) n.push(`Daftar temuan dibatasi ${d.limits.findings} baris terbaru. Ringkasan di atas tetap menghitung semua data.`);
  if (d.sum.compliance != null) n.push('Kepatuhan (perkiraan) = jumlah P2H masuk dibanding jumlah genset jalan / standby saat ini x shift yang sudah mulai.');
  return n;
};

/** Rekap P2H Genset sebagai model laporan dashboard (lihat dashboard-report.js). */
function rekapModel(d) {
  const s = d.sum;
  const f = d.findingsSum;
  const C = 'center';
  const unit = d.buckets.unit.toLowerCase();
  const open = f.total - f.closed;

  const kpis = [
    { label: 'Total P2H', value: String(s.total), note: s.expected ? `dari perkiraan ${s.expected}` : 'P2H masuk', color: COLOR.ink },
    { label: 'Kepatuhan', value: s.compliance == null ? '-' : `${s.compliance}%`, note: 'perkiraan', color: tone(s.compliance), ring: s.compliance ?? 0 },
    { label: 'Ada temuan', value: `${pctN(s.temuan + s.stop, s.total)}%`, note: `${s.temuan} temuan A · ${s.stop} STOP AA`, color: s.stop ? COLOR.stop : s.temuan ? COLOR.warn : COLOR.ok, ring: pctN(s.temuan + s.stop, s.total) },
    { label: 'Temuan', value: String(f.total), note: `AA ${f.aa} · A ${f.a} · belum selesai ${open}`, color: open ? (f.aa ? COLOR.stop : COLOR.warn) : COLOR.ok },
    { label: 'Temuan selesai', value: String(f.closed), note: s.close_hours != null ? `rata-rata ${hours(s.close_hours)}` : 'belum ada', color: COLOR.ok },
    { label: 'Terverifikasi', value: `${pctN(s.verified, s.total)}%`, note: `${s.unverified} menunggu${s.verify_hours != null ? ` · rata-rata ${hours(s.verify_hours)}` : ''}`, color: s.total ? tone(pctN(s.verified, s.total)) : COLOR.muted, ring: pctN(s.verified, s.total) },
  ];
  const facts = [
    ['Total P2H', `${s.total}${s.expected ? ` dari perkiraan ${s.expected}` : ''}`],
    ['Semua baik', `${s.baik} (${pct(s.baik, s.total)})`],
    ['Ada temuan (A) / STOP (AA)', `${s.temuan} / ${s.stop}`],
    ['Temuan pada periode ini', `${f.total} (AA ${f.aa}, A ${f.a}), selesai ${f.closed}`],
    ['Terverifikasi pengawas', `${s.verified} dari ${s.total}${s.verify_hours != null ? `, rata-rata ${hours(s.verify_hours)}` : ''}`],
  ];

  const trendRows = d.buckets.rows.map((b) => ({ label: d.buckets.kind === 'week' ? b.label.replace(/^Minggu ke-\d+ \((.*)\)$/, '$1') : b.label, ok: b.baik, warn: b.temuan, stop: b.stop }));
  const compRows = d.buckets.rows.map((b, i) => ({ label: trendRows[i].label, pct: b.pct, done: b.total, expected: b.expected })).filter((r) => r.expected);
  const topRows = d.top_items.map((x) => ({ label: plain(x.item_text), sub: `${x.section_title} · di ${x.units} unit`, stop: x.has_stop ? x.n : 0, fix: x.has_stop ? 0 : x.n }));
  const unitRows = d.units.filter((x) => x.stop + x.fix > 0).map((x) => ({ label: x.name, sub: `${x.site_name} · ${x.total} P2H`, stop: x.stop, fix: x.fix }));
  const siteRows = d.sites.map((x) => ({ label: x.site, ok: x.baik, warn: x.temuan, stop: x.stop }));
  const labels = ['Semua baik', 'Ada temuan (A)', 'STOP (AA)'];

  const charts = [
    { type: 'stack', title: 'Tren P2H', hint: `Jumlah P2H per ${unit}, menurut hasilnya.`, rows: trendRows, labels, wide: !compRows.length },
    ...(compRows.length ? [{ type: 'compliance', title: 'Kepatuhan P2H', hint: `P2H masuk dibanding perkiraan (genset jalan / standby x shift) per ${unit}.`, rows: compRows }] : []),
    { type: 'hbars', title: 'Butir paling sering bermasalah', hint: 'Butir cek yang paling sering rusak / perlu diperbaiki.', rows: topRows, labels: ['AA', 'A'], empty: 'Tidak ada temuan pada periode ini.' },
    { type: 'hbars', title: 'Temuan per unit', hint: 'Genset dengan temuan terbanyak.', rows: unitRows, labels: ['AA', 'A'], empty: 'Tidak ada temuan pada periode ini.' },
    ...(siteRows.length > 1 ? [{ type: 'stack', title: 'Per site', hint: 'Jumlah P2H tiap site, menurut hasilnya.', rows: siteRows, labels, wide: true }] : []),
  ];

  const stackSummary = (title, head, rows, extra) => {
    const max = Math.max(1, ...rows.map((r) => r.ok + r.warn + r.stop));
    return {
      title,
      cols: [{ h: head, w: 24 }, { h: 'Total P2H', w: 10, align: C }, { h: 'Semua baik', w: 11, align: C }, { h: 'Ada temuan (A)', w: 13, align: C }, { h: 'STOP (AA)', w: 11, align: C }, ...extra.cols],
      rows: rows.map((r, i) => [r.label, r.ok + r.warn + r.stop, r.ok, r.warn, r.stop, ...extra.vals(i)]),
      colorOf: (i, j) => (j === 4 && rows[i].stop ? COLOR.stop : null),
      bar: { segs: (i) => [{ v: rows[i].ok, color: COLOR.ok }, { v: rows[i].warn, color: COLOR.warn }, { v: rows[i].stop, color: COLOR.stop }], max },
    };
  };
  const summary = [
    stackSummary(`Per ${unit}`, d.buckets.unit, trendRows, {
      cols: [{ h: 'Terverifikasi', w: 12, align: C }, { h: 'Kepatuhan', w: 11, align: C }],
      vals: (i) => [d.buckets.rows[i].verified, d.buckets.rows[i].pct == null ? '-' : `${d.buckets.rows[i].pct}%`],
    }),
    stackSummary('Per site', 'Site', siteRows, { cols: [{ h: 'Terverifikasi', w: 12, align: C }], vals: (i) => [d.sites[i].verified] }),
    findingSummary('Butir paling sering bermasalah', 'Butir cek', topRows),
    findingSummary('Temuan per unit', 'Unit', unitRows),
  ];
  // judul kolom STOP / Perbaiki di tabel temuan genset memakai kode bahaya
  for (const tb of summary.slice(2)) tb.cols = tb.cols.map((c) => (c.h === 'STOP' ? { ...c, h: 'AA' } : c.h === 'Perbaiki' ? { ...c, h: 'A' } : c));

  const lists = [];
  if (d.forms.length || !d.formsOmitted) {
    lists.push({
      title: 'Daftar P2H',
      sheet: 'Rekap P2H',
      cols: [
        { h: 'No', w: 5, align: C }, { h: 'Tanggal', w: 15 }, { h: 'Shift', w: 6, align: C }, { h: 'Site', w: 12 },
        { h: 'Lokasi', w: 15, xlsxOnly: true }, { h: 'No. Unit', w: 18 }, { h: 'Merk / Model', w: 18 }, { h: 'Teknisi', w: 20 },
        { h: 'Perusahaan', w: 18, xlsxOnly: true }, { h: 'No SID', w: 12, xlsxOnly: true }, { h: 'HM Awal', w: 9, align: C }, { h: 'HM Akhir', w: 9, align: C },
        { h: 'Hasil', w: 17, align: C }, { h: 'AA', w: 6, align: C }, { h: 'A', w: 6, align: C }, { h: 'Foto', w: 6, align: C, xlsxOnly: true },
        { h: 'Status verifikasi', w: 26 }, { h: 'Waktu isi (WITA)', w: 19, xlsxOnly: true }, { h: 'ID P2H', w: 8, align: C, xlsxOnly: true },
      ],
      rows: d.forms.map((x, i) => [
        i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, x.location || '', unitLabel(x), modelLabel(x),
        x.inspector_name, x.inspector_company || '', x.inspector_nrp || '', fmtNum(x.hm_start), fmtNum(x.hm_end), RESULT_LABEL[x.result], x.n_aa, x.n_a, x.n_photos,
        verLabel(x), stampWITA(x.filled_at), x.id,
      ]),
      colorOf: (i, j, cols) => (cols[j].h === 'Hasil' ? RESULT_COLOR[d.forms[i].result] : cols[j].h === 'AA' && d.forms[i].n_aa ? COLOR.stop : null),
      empty: 'Tidak ada P2H pada penyaring ini.',
    });
  }
  lists.push({
    title: 'Daftar temuan (rusak / perlu diperbaiki)',
    sheet: 'Temuan',
    cols: [
      { h: 'No', w: 5, align: C, xlsxOnly: true }, { h: 'Tanggal', w: 15 }, { h: 'Shift', w: 6, align: C }, { h: 'Site', w: 12, xlsxOnly: true },
      { h: 'No. Unit', w: 14 }, { h: 'Bagian', w: 20, xlsxOnly: true }, { h: 'Butir cek', w: 44, wrap: true }, { h: 'Kode', w: 6, align: C },
      { h: 'Kondisi', w: 10, align: C }, { h: 'Catatan teknisi', w: 30, wrap: true }, { h: 'Foto', w: 6, align: C }, { h: 'Status tindak lanjut', w: 17 },
      { h: 'Catatan perbaikan', w: 30, wrap: true, xlsxOnly: true }, { h: 'Diperbaiki oleh', w: 18, xlsxOnly: true }, { h: 'Waktu selesai (WITA)', w: 19, xlsxOnly: true },
    ],
    rows: d.findings.map((x, i) => [
      i + 1, dateLabel(x.shift_date), shiftLabel(x.shift), x.site_name, x.unit_code, x.section_title, plain(x.item_text), x.danger_code,
      CONDITION_LABEL[x.condition], x.note || '', x.n_photos, FIX_LABEL[x.fix_status] || '', x.fix_note || '', x.fix_by_name || '', x.fix_at ? stampWITA(x.fix_at) : '',
    ]),
    colorOf: (i, j, cols) => (cols[j].h === 'Kode' && d.findings[i].danger_code === 'AA' ? COLOR.stop : cols[j].h === 'Status tindak lanjut' && d.findings[i].fix_status === 'closed' ? COLOR.ok : null),
    empty: 'Tidak ada temuan pada periode ini.',
  });

  return {
    title: d.title,
    subtitle: d.subtitle,
    generated: d.generated,
    footer: 'P2H Genset · Berau Coal · MTL',
    kpis,
    facts,
    charts,
    summary,
    lists,
    notes: notes(d),
    filename: d.filename,
  };
}

const build = (format) => async (q, user) => RENDER[format](rekapModel(await loadRekap(q, user, { kind: format })));
export const buildRekapXlsx = build('xlsx');
export const buildRekapPdf = build('pdf');
export const buildRekapDocx = build('docx');
