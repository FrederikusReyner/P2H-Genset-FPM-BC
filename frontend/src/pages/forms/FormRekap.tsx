import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ComplianceChart, FindingBars, ResultTrend, Ring } from '../../components/FormCharts';
import { Icon } from '../../components/Icon';
import { DownloadMenu, ErrorBox, PageHead, SectionTitle, Segmented, Spinner } from '../../components/ui';
import { addDays, mediumDate, span, todayWita } from '../../lib/format';
import { formPath, lowerFirst, useFormStats } from '../../lib/forms';
import { SiteChips, useFormSite } from './SiteChips';
import { useFormDownload, type ExportFormat } from './useFormDownload';

type RangeKey = '7' | '30' | '90' | '365';
const RANGES: { value: RangeKey; label: string }[] = [
  { value: '7', label: '7 hari' },
  { value: '30', label: '30 hari' },
  { value: '90', label: '90 hari' },
  { value: '365', label: '12 bulan' },
];

/** Rekap / dashboard satu jenis form. */
export default function FormRekapPage() {
  const { code = '' } = useParams();
  const [range, setRange] = useState<RangeKey>('30');
  const [site, setSite] = useFormSite();
  const to = todayWita();
  const from = addDays(to, -(Number(range) - 1));
  const q = useFormStats(code, from, to, site);
  const { download: dlFile, busy: dl } = useFormDownload(code);
  // unduhan memakai rentang & site yang sedang tampil di layar
  const download = (format: ExportFormat) => dlFile(format, { from, to, site_id: site });


  if (q.isLoading) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const { type: t, summary: s, trend, compliance, top_items, subjects, sites } = q.data;
  const pctFinding = s.records ? Math.round((s.with_findings / s.records) * 100) : 0;
  const pctVerified = s.records ? Math.round((s.verified / s.records) * 100) : 0;
  const lastComp = compliance?.items[compliance.items.length - 1];
  const unit = lowerFirst(t.subject_label);
  const perText = compliance ? ({ day: 'per hari', week: 'per minggu', biweek: 'per 2 minggu', month: 'per bulan', quarter: 'per kuartal', half: 'per semester' } as const)[compliance.kind] : '';

  return (
    <div className="page frekap">
      <PageHead eyebrow={`${t.short_name} · ${mediumDate(q.data.range.from)} – ${mediumDate(q.data.range.to)}`} title="Rekap">
        <Link to={formPath(code, '/riwayat')} className="btn btn--ghost">
          <Icon name="history" size={18} /> Riwayat
        </Link>
        <DownloadMenu onPick={download} label="Unduh rekap" busy={dl} />
      </PageHead>

      <div className="frekap__bar">
        <Segmented label="Rentang waktu" value={range} onChange={setRange} options={RANGES} />
        {q.isFetching && <span className="small muted">memperbarui…</span>}
      </div>
      <SiteChips value={site} onChange={setSite} />

      {/* ---------- angka utama ---------- */}
      <section className="kpis kpis--form kpis--rekap">
        <div className="kpi">
          <div className="kpi__label">Isian</div>
          <div className="kpi__value">{s.records}</div>
          <div className="small muted">{s.findings} butir temuan</div>
        </div>
        <div className={`kpi kpi--ring ${pctFinding ? 'kpi--warn' : ''}`}>
          <Ring pct={pctFinding} tone={s.with_stop ? 'stop' : pctFinding ? 'warn' : 'ok'} />
          <div>
            <div className="kpi__label">Ada temuan</div>
            <div className="kpi__value">{pctFinding}%</div>
            <div className="small muted">
              {s.with_findings} isian{s.with_stop ? `, ${s.with_stop} STOP` : ''}
            </div>
          </div>
        </div>
        {compliance && lastComp && (
          <div className="kpi kpi--ring">
            <Ring pct={lastComp.pct} tone={lastComp.pct >= 100 ? 'ok' : lastComp.pct >= 50 ? 'warn' : 'stop'} />
            <div>
              <div className="kpi__label">Kepatuhan terakhir</div>
              <div className="kpi__value">{lastComp.pct}%</div>
              <div className="small muted">
                {lastComp.done}/{lastComp.expected} {unit}
              </div>
            </div>
          </div>
        )}
        <Link to={formPath(code, '/temuan')} className={`kpi kpi--link ${s.open_stop ? 'kpi--stop' : s.open_fix ? 'kpi--warn' : ''}`}>
          <div className="kpi__label">Temuan terbuka</div>
          <div className="kpi__value">{s.open_stop + s.open_fix}</div>
          <div className="small muted">
            {s.open_stop} STOP · {s.open_fix} perbaiki{s.overdue ? ` · ${s.overdue} lewat batas` : ''}
          </div>
        </Link>
        <div className="kpi">
          <div className="kpi__label">Temuan selesai</div>
          <div className="kpi__value">{s.closed}</div>
          <div className="small muted">{s.close_hours != null ? `rata-rata ${span(s.close_hours)}` : 'belum ada'}</div>
        </div>
        <Link to={formPath(code, '/riwayat?unverified=1')} className="kpi kpi--link kpi--ring">
          <Ring pct={pctVerified} tone={pctVerified >= 100 ? 'ok' : pctVerified >= 50 ? 'warn' : 'stop'} />
          <div>
            <div className="kpi__label">Terverifikasi</div>
            <div className="kpi__value">{pctVerified}%</div>
            <div className="small muted">
              {s.unverified} menunggu{s.verify_hours != null ? ` · rata-rata ${span(s.verify_hours)}` : ''}
            </div>
          </div>
        </Link>
      </section>

      {/* ---------- grafik ---------- */}
      <div className="frekap__grid">
        <section className="card fcard frekap__wide">
          <SectionTitle hint={`Jumlah isian ${q.data.range.bucket === 'day' ? 'per hari' : q.data.range.bucket === 'week' ? 'per minggu' : 'per bulan'}, menurut hasilnya.`}>Tren isian</SectionTitle>
          {s.records ? <ResultTrend data={trend} kind={q.data.range.bucket} /> : <div className="small muted">Belum ada isian di rentang ini.</div>}
        </section>

        {compliance && (
          <section className="card fcard frekap__wide">
            <SectionTitle hint={`Persen ${unit} yang sudah diperiksa ${perText}${compliance.per === 'shift' ? ' (2 shift)' : ''}, dari ${compliance.subjects} ${unit} aktif.`}>Kepatuhan pemeriksaan</SectionTitle>
            <ComplianceChart items={compliance.items} kind={compliance.kind} unit={unit} />
          </section>
        )}

        <section className="card fcard">
          <SectionTitle hint="Butir yang paling sering ditemukan tidak baik / di luar batas.">Butir paling sering bermasalah</SectionTitle>
          <FindingBars
            empty="Tidak ada temuan di rentang ini."
            rows={top_items.map((x) => ({ key: `${x.section_title}|${x.item_text}`, label: x.item_text, sub: x.section_title, stop: x.has_stop ? x.n : 0, fix: x.has_stop ? 0 : x.n, tip: `di ${x.subjects} ${unit}` }))}
          />
        </section>

        <section className="card fcard">
          <SectionTitle hint={`${t.subject_label} dengan temuan terbanyak.`}>Temuan per {unit}</SectionTitle>
          <FindingBars
            empty="Tidak ada temuan di rentang ini."
            rows={subjects.map((x) => ({ key: x.id, label: x.name, sub: x.site_name, stop: x.stop, fix: x.fix, tip: `${x.records} isian` }))}
          />
        </section>

        {sites.length > 0 && (
          <section className="card fcard frekap__wide">
            <SectionTitle hint="Isian dan temuan tiap site.">Per site</SectionTitle>
            <div className="tableview__scroll">
              <table className="table table--tight">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="num">Isian</th>
                    <th className="num">Temuan STOP</th>
                    <th className="num">Temuan perbaiki</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sites.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}</td>
                      <td className="num">{x.records}</td>
                      <td className="num">{x.stop ? <span className="stop-text">{x.stop}</span> : 0}</td>
                      <td className="num">{x.fix ? <span className="warn-text">{x.fix}</span> : 0}</td>
                      <td className="num">
                        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSite(x.id)}>
                          Lihat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
