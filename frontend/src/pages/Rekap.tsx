import { useState } from 'react';
import { Icon } from '../components/Icon';
import { PmmrCard } from '../components/Pmmr';
import { Link } from 'react-router-dom';
import { ComplianceChart, FindingBars, ResultTrend, Ring } from '../components/FormCharts';
import { DownloadMenu, Empty, ErrorBox, PageHead, SectionTitle, Segmented, Spinner } from '../components/ui';
import { downloadFile } from '../lib/api';
import { PERIOD_LABEL, periodStart, periodText, span, stepAnchor, todayWita, type Period } from '../lib/format';
import { useMeta, useRekapPreview } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { RekapPreview } from '../lib/types';

/* =====================================================================
   Rekap mingguan / bulanan / tahunan: lihat ringkasan di layar, lalu unduh PDF / Excel / Word
   ===================================================================== */

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

export default function RekapPage() {
  const toast = useToast();
  const meta = useMeta();
  const today = todayWita();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(today);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [dl, setDl] = useState(false);
  const q = useRekapPreview(period, anchor, siteId);
  const d = q.data;
  const sites = meta.data?.sites ?? [];

  const isNow = periodStart(period, anchor) >= periodStart(period, today);
  const label = d?.from && d.to ? periodText(period, d.from, d.to) : '…';

  const download = async (format: 'pdf' | 'xlsx' | 'docx') => {
    setDl(true);
    try {
      const filters: Record<string, string | number> = { period, date: anchor };
      if (siteId) filters.site_id = siteId;
      await downloadFile({ kind: 'rekap', format, filters });
    } catch (e) {
      toast.push({ title: 'Gagal menyiapkan unduhan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      window.setTimeout(() => setDl(false), 1200);
    }
  };

  return (
    <div className="page rekap">
      <PageHead eyebrow="Laporan" title="Rekap P2H">
        <DownloadMenu onPick={download} label="Unduh rekap" busy={dl} disabled={!d || d.sum.total === 0} />
      </PageHead>


      <section className="card rekap__ctrl" aria-label="Pilih periode">
        <Segmented<Period>
          label="Jenis rekap"
          block
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setAnchor(today);
          }}
          options={(['week', 'month', 'year'] as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        />
        <div className="pstep">
          <button type="button" className="iconbtn iconbtn--frame" onClick={() => setAnchor(stepAnchor(period, anchor, -1))} aria-label="Periode sebelumnya">
            <Icon name="chevL" />
          </button>
          <div className="pstep__label" aria-live="polite">
            {label}
          </div>
          <button type="button" className="iconbtn iconbtn--frame" onClick={() => setAnchor(stepAnchor(period, anchor, 1))} disabled={isNow} aria-label="Periode berikutnya">
            <Icon name="chevR" />
          </button>
        </div>
        <div className="row row--wrap">
          {!isNow && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAnchor(today)}>
              <Icon name="refresh" size={16} /> {period === 'week' ? 'Minggu ini' : period === 'month' ? 'Bulan ini' : 'Tahun ini'}
            </button>
          )}
          {sites.length > 1 && (
            <label className="field field--inline">
              <span className="sr-only">Site</span>
              <select className="input input--auto" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : null)} aria-label="Site">
                <option value="">Semua site</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {q.isLoading && <Spinner />}
      {q.error && !d && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}

      {d && d.sum.total === 0 && <Empty icon="table" title="Belum ada P2H pada periode ini" hint="Pilih periode lain dengan tombol panah di atas." />}

      {d && d.sum.total > 0 && <RekapDashboard d={d} />}

      <PmmrCard />
    </div>
  );
}

const ringTone = (p: number | null) => (p == null ? 'warn' : p >= 100 ? 'ok' : p >= 50 ? 'warn' : 'stop');

/** Isi rekap bergaya dashboard: sama dengan Rekap form digital lain. */
function RekapDashboard({ d }: { d: RekapPreview }) {
  const s = d.sum;
  const f = d.findings;
  const pctFinding = s.total ? Math.round(((s.temuan + s.stop) / s.total) * 100) : 0;
  const pctVerified = s.total ? Math.round((s.verified / s.total) * 100) : 0;
  const open = f.total - f.closed;
  const unit = d.bucket_unit.toLowerCase();
  const kind = d.bucket_kind;
  const trend = d.buckets.map((b) => ({ start: b.start, ok: b.baik, finding: b.temuan, stop: b.stop }));
  const comp = d.buckets.filter((b) => b.expected > 0).map((b) => ({ start: b.start, done: b.total, expected: b.expected, pct: b.pct ?? 0 }));

  return (
    <>
      <section className="kpis kpis--form kpis--rekap">
        <div className="kpi">
          <div className="kpi__label">Total P2H</div>
          <div className="kpi__value">{s.total}</div>
          <div className="small muted">{s.expected ? `dari perkiraan ${s.expected}` : 'P2H masuk'}</div>
        </div>
        <div className="kpi kpi--ring">
          <Ring pct={s.compliance ?? 0} tone={ringTone(s.compliance)} />
          <div>
            <div className="kpi__label">Kepatuhan</div>
            <div className="kpi__value">{s.compliance == null ? '–' : `${s.compliance}%`}</div>
            <div className="small muted">perkiraan</div>
          </div>
        </div>
        <div className={`kpi kpi--ring ${pctFinding ? 'kpi--warn' : ''}`}>
          <Ring pct={pctFinding} tone={s.stop ? 'stop' : pctFinding ? 'warn' : 'ok'} />
          <div>
            <div className="kpi__label">Ada temuan</div>
            <div className="kpi__value">{pctFinding}%</div>
            <div className="small muted">
              {s.temuan} temuan A · {s.stop} STOP AA
            </div>
          </div>
        </div>
        <Link to="/temuan" className={`kpi kpi--link ${open && f.aa ? 'kpi--stop' : open ? 'kpi--warn' : ''}`}>
          <div className="kpi__label">Temuan</div>
          <div className="kpi__value">{f.total}</div>
          <div className="small muted">
            AA {f.aa} · A {f.a} · belum selesai {open}
          </div>
        </Link>
        <div className="kpi">
          <div className="kpi__label">Temuan selesai</div>
          <div className="kpi__value">{f.closed}</div>
          <div className="small muted">{s.close_hours != null ? `rata-rata ${span(s.close_hours)}` : 'belum ada'}</div>
        </div>
        <Link to={`/p2h?belumverifikasi=1&dari=${d.from ?? ""}&sampai=${d.to ?? ""}`} className="kpi kpi--link kpi--ring">
          <Ring pct={pctVerified} tone={ringTone(pctVerified)} />
          <div>
            <div className="kpi__label">Terverifikasi</div>
            <div className="kpi__value">{pctVerified}%</div>
            <div className="small muted">
              {s.unverified} menunggu{s.verify_hours != null ? ` · rata-rata ${span(s.verify_hours)}` : ''}
            </div>
          </div>
        </Link>
      </section>

      <div className="frekap__grid">
        <section className="card fcard">
          <SectionTitle hint={`Jumlah P2H per ${unit}, menurut hasilnya.`}>Tren P2H</SectionTitle>
          <ResultTrend data={trend} kind={kind} />
        </section>
        <section className="card fcard">
          <SectionTitle hint={`P2H masuk dibanding perkiraan (genset jalan / standby × shift) per ${unit}.`}>Kepatuhan P2H</SectionTitle>
          {comp.length ? <ComplianceChart items={comp} kind={kind} unit="P2H" /> : <div className="small muted">Belum ada shift yang berjalan di periode ini.</div>}
        </section>

        <section className="card fcard">
          <SectionTitle hint="Butir cek yang paling sering rusak / perlu diperbaiki.">Butir paling sering bermasalah</SectionTitle>
          <FindingBars
            empty="Tidak ada temuan pada periode ini."
            rows={d.top_items.map((x) => ({
              key: `${x.section_title}|${x.item_text}`,
              label: x.item_text.replace(/\*\*/g, ''),
              sub: x.section_title,
              stop: x.has_stop ? x.n : 0,
              fix: x.has_stop ? 0 : x.n,
              tip: `di ${x.units} unit`,
            }))}
          />
        </section>
        <section className="card fcard">
          <SectionTitle hint="Genset dengan temuan terbanyak.">Temuan per unit</SectionTitle>
          <FindingBars
            empty="Tidak ada temuan pada periode ini."
            rows={d.units.filter((x) => x.stop + x.fix > 0).map((x) => ({ key: x.id, label: x.name, sub: x.site_name, stop: x.stop, fix: x.fix, tip: `${x.total} P2H` }))}
          />
        </section>

        {d.sites.length > 1 && (
          <section className="card fcard frekap__wide">
            <SectionTitle hint="Jumlah P2H tiap site, menurut hasilnya.">Per site</SectionTitle>
            <div className="tableview__scroll">
              <table className="table table--tight">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="num">P2H</th>
                    <th className="num">Baik</th>
                    <th className="num">Temuan A</th>
                    <th className="num">STOP AA</th>
                    <th className="num">Terverifikasi</th>
                  </tr>
                </thead>
                <tbody>
                  {d.sites.map((x) => (
                    <tr key={x.site}>
                      <td>{x.site}</td>
                      <td className="num">{x.total}</td>
                      <td className="num">{x.baik}</td>
                      <td className="num">{x.temuan ? <span className="warn-text">{x.temuan}</span> : 0}</td>
                      <td className="num">{x.stop ? <span className="stop-text">{x.stop}</span> : 0}</td>
                      <td className="num">{pct(x.verified, x.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <p className="small muted">
        Kepatuhan (perkiraan) = P2H yang masuk dibanding jumlah genset jalan / standby saat ini × shift yang sudah mulai. Unduh PDF, Excel, atau Word untuk grafik ini beserta daftar lengkap P2H dan temuan.
      </p>
    </>
  );
}
