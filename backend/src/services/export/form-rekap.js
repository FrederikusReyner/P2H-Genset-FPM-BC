import { query } from '../../db.js';
import { scopeOf } from '../../middleware/auth.js';
import { formStats } from '../../forms/stats.js';
import { FIX_LABEL, plain } from '../../text.js';
import { addDays, dayShort, longDate, monthShort, rangeShort, shiftLabel, stampWITA } from '../../time.js';
import { fmtNum } from './common.js';
import { RENDER } from './dashboard-report.js';
import { COLOR } from './visual.js';

/*
 * Unduhan rekap form digital (selain P2H Genset): PDF / Excel / Word bergaya dashboard.
 * Isinya sama dengan layar Rekap (angka utama, tren, kepatuhan, butir & objek bermasalah, per site)
 * ditambah daftar isian dan daftar temuan pada rentang yang dipilih.
 */

const LIMITS = { xlsx: { records: 20000, findings: 20000 }, doc: { records: 2000, findings: 600 } };
const RESULT = { ok: 'Baik', finding: 'Ada temuan', stop: 'STOP' };
const RESULT_COLOR = { ok: COLOR.ok, finding: COLOR.warn, stop: COLOR.stop };
const SEVERITY = { stop: 'STOP', fix: 'Perbaiki', note: 'Dicatat' };
const VALUE_LABEL = { v: 'Hasil', k_r: 'Kosong R', k_s: 'Kosong S', k_t: 'Kosong T', m_r: 'Muatan R', m_s: 'Muatan S', m_t: 'Muatan T' };
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const pctN = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const tone = (p) => (p >= 100 ? COLOR.ok : p >= 50 ? COLOR.warn : COLOR.stop);
export const hours = (h) => {
  if (h == null) return '-';
  const n = Number(h);
  if (n < 1) return `${Math.max(1, Math.round(n * 60))} menit`;
  return n < 24 ? `${fmtNum(Math.round(n * 10) / 10)} jam` : `${fmtNum(Math.round((n / 24) * 10) / 10)} hari`;
};
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** Hasil satu butir temuan dalam teks: label "tidak baik", angka ukur, atau isian. */
function answerText(a) {
  if (a.kind === 'check') return a.bad_label || 'Tidak baik';
  const v = a.values || {};
  if (a.kind === 'input') return String(v.value ?? '');
  const vals = Object.entries(v)
    .filter(([, x]) => x !== null && x !== '')
    .map(([k, x]) => `${VALUE_LABEL[k] ?? k} ${fmtNum(x)}`)
    .join(' · ');
  const lim = [a.min_value != null ? `min ${fmtNum(a.min_value)}` : '', a.max_value != null ? `maks ${fmtNum(a.max_value)}` : ''].filter(Boolean).join(', ');
  return `${vals}${a.unit ? ` ${a.unit}` : ''}${lim ? ` (batas ${lim})` : ''}`;
}

const BUCKET_NAME = { day: 'Hari', week: 'Minggu', biweek: '2 minggu', month: 'Bulan', quarter: 'Kuartal', half: 'Semester' };
function bucketLabel(kind, start, to) {
  if (kind === 'day') return dayShort(start);
  if (kind === 'month') return monthShort(start.slice(0, 7));
  const [y, m] = start.split('-').map(Number);
  if (kind === 'quarter') return `Kuartal ${Math.floor((m - 1) / 3) + 1} ${y}`;
  if (kind === 'half') return `Semester ${m <= 6 ? 1 : 2} ${y}`;
  const end = addDays(start, kind === 'biweek' ? 13 : 6);
  return rangeShort(start, end > to ? to : end);
}

/** Tabel ringkas "STOP / perbaiki" + kolom grafik, untuk lembar Ringkasan Excel. */
export function findingSummary(title, head, rows) {
  const max = Math.max(1, ...rows.map((r) => r.stop + r.fix));
  return {
    title,
    cols: [{ h: head, w: 38 }, { h: 'Keterangan', w: 26 }, { h: 'STOP', w: 9, align: 'center' }, { h: 'Perbaiki', w: 9, align: 'center' }],
    rows: rows.map((r) => [r.label, r.sub ?? '', r.stop, r.fix]),
    colorOf: (i, j) => (j === 2 && rows[i].stop ? COLOR.stop : null),
    bar: { segs: (i) => [{ v: rows[i].stop, color: COLOR.stop }, { v: rows[i].fix, color: COLOR.warn }], max },
    empty: 'Tidak ada temuan di rentang ini.',
  };
}

/** Semua isi rekap sebagai model laporan dashboard (lihat dashboard-report.js). */
export async function loadFormRekap(code, q, user, { kind = 'doc' } = {}) {
  const t = (await query('SELECT id, code, name, short_name, period, fix_hours, subject_label, filler_label, verifier_label, doc_no FROM form_types WHERE code = $1', [String(code)])).rows[0];
  if (!t) return null;
  const st = await formStats(t, q, user);
  const { from, to } = st.range;
  const scope = scopeOf(user);
  const site = scope ?? (Number(q.site_id) || null);
  const siteName = site ? (await query('SELECT name FROM sites WHERE id = $1', [site])).rows[0]?.name : null;
  const lim = LIMITS[kind === 'xlsx' ? 'xlsx' : 'doc'];

  const p = [t.id, from, to];
  const siteR = site ? (p.push(site), `AND r.site_id = $${p.length}`) : '';
  const [recQ, recN, finQ, finN] = await Promise.all([
    query(
      `SELECT r.id, r.record_date, r.shift, r.subject_name, r.subject_detail, r.site_name, r.filler_name, r.result, r.n_stop, r.n_fix,
              COALESCE(r.filled_at, r.submitted_at) AS filled_at, r.sup_name, r.sup_signed_at, r.sup_note, r.notes
         FROM form_records r WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR}
        ORDER BY r.record_date, r.shift, r.subject_name, r.id LIMIT ${lim.records}`,
      p,
    ),
    query(`SELECT count(*)::int AS n FROM form_records r WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR}`, p),
    query(
      `SELECT a.item_label, a.item_text, a.section_title, a.kind, a.severity, a.bad_label, a.unit, a.min_value, a.max_value, a.values, a.note,
              a.fix_status, a.fix_plan_date, a.fix_note, a.fix_by_name, a.fix_at,
              r.record_date, r.shift, r.subject_name, r.site_name, r.filler_name,
              (SELECT count(*)::int FROM form_photos ph WHERE ph.answer_id = a.id) AS n_photos
         FROM form_answers a JOIN form_records r ON r.id = a.record_id
        WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR} AND a.is_finding
        ORDER BY r.record_date, r.shift, r.subject_name, a.section_order, a.item_order LIMIT ${lim.findings}`,
      p,
    ),
    query(
      `SELECT count(*)::int AS n FROM form_answers a JOIN form_records r ON r.id = a.record_id
        WHERE r.form_type_id = $1 AND r.record_date BETWEEN $2 AND $3 ${siteR} AND a.is_finding`,
      p,
    ),
  ]);

  const s = st.summary;
  const perShift = t.period === 'shift';
  const unit = t.subject_label.toLowerCase();
  const bk = st.range.bucket;
  const ck = st.compliance;
  const lastComp = ck?.items.at(-1);
  const C = 'center';

  const kpis = [
    { label: 'Isian', value: String(s.records), note: `${s.findings} butir temuan`, color: COLOR.ink },
    {
      label: 'Ada temuan',
      value: `${pctN(s.with_findings, s.records)}%`,
      note: `${s.with_findings} isian${s.with_stop ? `, ${s.with_stop} STOP` : ''}`,
      color: s.with_stop ? COLOR.stop : s.with_findings ? COLOR.warn : COLOR.ok,
      ring: pctN(s.with_findings, s.records),
    },
    ...(lastComp ? [{ label: 'Kepatuhan terakhir', value: `${lastComp.pct}%`, note: `${lastComp.done}/${lastComp.expected} ${unit}`, color: tone(lastComp.pct), ring: lastComp.pct }] : []),
    {
      label: 'Temuan terbuka',
      value: String(s.open_stop + s.open_fix),
      note: `${s.open_stop} STOP · ${s.open_fix} perbaiki${s.overdue ? ` · ${s.overdue} lewat batas` : ''}`,
      color: s.open_stop ? COLOR.stop : s.open_fix ? COLOR.warn : COLOR.ok,
    },
    { label: 'Temuan selesai', value: String(s.closed), note: s.close_hours != null ? `rata-rata ${hours(s.close_hours)}` : 'belum ada', color: COLOR.ok },
    {
      label: 'Terverifikasi',
      value: `${pctN(s.verified, s.records)}%`,
      note: `${s.unverified} menunggu${s.verify_hours != null ? ` · rata-rata ${hours(s.verify_hours)}` : ''}`,
      color: s.records ? tone(pctN(s.verified, s.records)) : COLOR.muted,
      ring: pctN(s.verified, s.records),
    },
  ];
  const facts = [
    ['Jumlah isian', `${s.records} (${s.findings} butir temuan)`],
    ['Isian ada temuan', `${s.with_findings} (${pct(s.with_findings, s.records)}), STOP ${s.with_stop}`],
    ['Temuan terbuka saat ini', `STOP ${s.open_stop}, perbaiki ${s.open_fix}, lewat batas ${s.overdue}`],
    ['Temuan selesai di rentang ini', `${s.closed}${s.close_hours != null ? `, rata-rata ${hours(s.close_hours)}` : ''}`],
    ['Terverifikasi', `${s.verified} dari ${s.records}${s.verify_hours != null ? `, rata-rata ${hours(s.verify_hours)}` : ''}`],
    ...(ck ? [['Objek aktif', `${ck.subjects} ${unit}${ck.per === 'shift' ? ' (2 shift per hari)' : ''}`]] : []),
  ];

  const trendRows = st.trend.map((b) => ({ label: bucketLabel(bk, b.start, to), ok: b.ok, warn: b.finding, stop: b.stop }));
  const compRows = ck ? ck.items.map((b) => ({ label: bucketLabel(ck.kind, b.start, to), pct: b.pct, done: b.done, expected: b.expected })) : [];
  const topRows = st.top_items.map((x) => ({ label: plain(x.item_text), sub: `${x.section_title} · di ${x.subjects} ${unit}`, stop: x.has_stop ? x.n : 0, fix: x.has_stop ? 0 : x.n }));
  const subjRows = st.subjects.filter((x) => x.stop + x.fix > 0).map((x) => ({ label: x.name, sub: `${x.site_name} · ${x.records} isian`, stop: x.stop, fix: x.fix }));
  const siteRows = st.sites.map((x) => ({ label: x.name, sub: `${x.records} isian`, stop: x.stop, fix: x.fix }));

  const charts = [
    { type: 'stack', title: 'Tren isian', hint: `Jumlah isian per ${BUCKET_NAME[bk].toLowerCase()}, menurut hasilnya.`, rows: trendRows, wide: !ck, empty: 'Belum ada isian di rentang ini.' },
    ...(ck
      ? [
          {
            type: 'compliance',
            title: 'Kepatuhan pemeriksaan',
            hint: `Persen ${unit} yang sudah diperiksa per ${BUCKET_NAME[ck.kind].toLowerCase()}${ck.per === 'shift' ? ' (2 shift)' : ''}, dari ${ck.subjects} ${unit} aktif.`,
            rows: compRows,
          },
        ]
      : []),
    { type: 'hbars', title: 'Butir paling sering bermasalah', hint: 'Butir yang paling sering tidak baik / di luar batas.', rows: topRows, empty: 'Tidak ada temuan di rentang ini.' },
    { type: 'hbars', title: `Temuan per ${unit}`, hint: `${t.subject_label} dengan temuan terbanyak.`, rows: subjRows, empty: 'Tidak ada temuan di rentang ini.' },
    ...(siteRows.length ? [{ type: 'hbars', title: 'Per site', hint: 'Temuan tiap site.', rows: siteRows, wide: true }] : []),
  ];

  const trendMax = Math.max(1, ...trendRows.map((r) => r.ok + r.warn + r.stop));
  const summary = [
    {
      title: `Tren isian per ${BUCKET_NAME[bk].toLowerCase()}`,
      cols: [{ h: BUCKET_NAME[bk], w: 22 }, { h: 'Isian', w: 9, align: C }, { h: 'Baik', w: 9, align: C }, { h: 'Ada temuan', w: 11, align: C }, { h: 'STOP', w: 9, align: C }, { h: '% baik', w: 9, align: C }],
      rows: trendRows.map((r) => [r.label, r.ok + r.warn + r.stop, r.ok, r.warn, r.stop, pct(r.ok, r.ok + r.warn + r.stop)]),
      bar: { segs: (i) => [{ v: trendRows[i].ok, color: COLOR.ok }, { v: trendRows[i].warn, color: COLOR.warn }, { v: trendRows[i].stop, color: COLOR.stop }], max: trendMax },
    },
    ...(ck
      ? [
          {
            title: 'Kepatuhan pemeriksaan',
            cols: [{ h: BUCKET_NAME[ck.kind], w: 22 }, { h: 'Diperiksa', w: 11, align: C }, { h: 'Seharusnya', w: 11, align: C }, { h: 'Kepatuhan', w: 11, align: C }],
            rows: compRows.map((r) => [r.label, r.done, r.expected, `${r.pct}%`]),
            colorOf: (i, j) => (j === 3 ? tone(compRows[i].pct) : null),
            bar: { segs: (i) => [{ v: compRows[i].pct, color: tone(compRows[i].pct) }, { v: 100 - compRows[i].pct, color: COLOR.track }], max: 100 },
          },
        ]
      : []),
    findingSummary('Butir paling sering bermasalah', 'Butir', topRows),
    findingSummary(`Temuan per ${unit}`, t.subject_label, subjRows),
    ...(siteRows.length ? [findingSummary('Per site', 'Site', siteRows)] : []),
  ];

  const records = recQ.rows;
  const findings = finQ.rows;
  const lists = [
    {
      title: 'Daftar isian',
      sheet: 'Isian',
      cols: [
        { h: 'No', w: 5, align: C }, { h: 'Tanggal', w: 13 }, ...(perShift ? [{ h: 'Shift', w: 6, align: C }] : []),
        { h: t.subject_label, w: 20 }, { h: 'Site', w: 13 }, { h: t.filler_label || 'Pengisi', w: 20 }, { h: 'Hasil', w: 11, align: C },
        { h: 'STOP', w: 7, align: C }, { h: 'Perbaiki', w: 8, align: C }, { h: t.verifier_label || 'Pemeriksa', w: 20 },
        { h: 'Catatan pemeriksa', w: 30, wrap: true, xlsxOnly: true }, { h: 'Waktu isi (WITA)', w: 19 },
      ],
      rows: records.map((x, i) => [
        i + 1, dayShort(x.record_date), ...(perShift ? [x.shift ? shiftLabel(x.shift) : '-'] : []), x.subject_name, x.site_name, x.filler_name,
        RESULT[x.result], x.n_stop, x.n_fix, x.sup_signed_at ? x.sup_name : 'Menunggu verifikasi', x.sup_note || '', stampWITA(x.filled_at),
      ]),
      colorOf: (i, j, cols) => (cols[j].h === 'Hasil' ? RESULT_COLOR[records[i].result] : cols[j].h === 'STOP' && records[i].n_stop ? COLOR.stop : null),
      empty: 'Belum ada isian di rentang ini.',
      omitted: recN.rows[0].n - records.length,
    },
    {
      title: 'Daftar temuan',
      sheet: 'Temuan',
      cols: [
        { h: 'Tanggal', w: 13 }, ...(perShift ? [{ h: 'Shift', w: 6, align: C }] : []), { h: t.subject_label, w: 16 }, { h: 'Bagian', w: 18, xlsxOnly: true },
        { h: 'Butir', w: 36, wrap: true }, { h: 'Tingkat', w: 9, align: C }, { h: 'Hasil', w: 22, wrap: true }, { h: 'Catatan', w: 26, wrap: true },
        { h: 'Foto', w: 6, align: C }, { h: 'Status', w: 16 }, { h: 'Rencana selesai', w: 13, xlsxOnly: true }, { h: 'Tindakan perbaikan', w: 30, wrap: true, xlsxOnly: true },
        { h: 'Ditutup oleh', w: 18, xlsxOnly: true }, { h: 'Waktu selesai (WITA)', w: 19, xlsxOnly: true },
      ],
      rows: findings.map((x) => [
        dayShort(x.record_date), ...(perShift ? [x.shift ? shiftLabel(x.shift) : '-'] : []), x.subject_name, x.section_title,
        plain([x.item_label, x.item_text].filter(Boolean).join('. ')), SEVERITY[x.severity] || x.severity, answerText(x), x.note || '',
        x.n_photos, FIX_LABEL[x.fix_status] || '', x.fix_plan_date ? dayShort(x.fix_plan_date) : '', x.fix_note || '', x.fix_by_name || '', x.fix_at ? stampWITA(x.fix_at) : '',
      ]),
      colorOf: (i, j, cols) => (cols[j].h === 'Tingkat' && findings[i].severity === 'stop' ? COLOR.stop : cols[j].h === 'Status' && findings[i].fix_status === 'closed' ? COLOR.ok : null),
      empty: 'Tidak ada temuan di rentang ini.',
      omitted: finN.rows[0].n - findings.length,
    },
  ];

  return {
    title: `REKAP ${t.name.toUpperCase()}`,
    subtitle: [`Periode ${longDate(from)} s.d. ${longDate(to)}`, siteName ? `Site ${siteName}` : 'Semua site', t.doc_no].filter(Boolean).join(' · '),
    generated: stampWITA(new Date()),
    footer: `${t.short_name} · Form digital · Berau Coal · MTL`,
    kpis,
    facts,
    charts,
    summary,
    lists,
    notes: [],
    filename: `Rekap_${fileSafe(t.short_name)}_${from}_sd_${to}${siteName ? `_${fileSafe(siteName)}` : ''}`,
  };
}

const build = (format) => async (code, q, user) => {
  const m = await loadFormRekap(code, q, user, { kind: format });
  return m ? RENDER[format](m) : null;
};

export const FORM_REKAP_BUILD = { xlsx: build('xlsx'), pdf: build('pdf'), docx: build('docx') };
