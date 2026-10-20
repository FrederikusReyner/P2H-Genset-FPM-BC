import { useState } from 'react';
import { Icon } from '../components/Icon';
import { PmmrCard } from '../components/Pmmr';
import { DownloadMenu, Empty, ErrorBox, PageHead, SectionTitle, Segmented, Spinner } from '../components/ui';
import { downloadFile } from '../lib/api';
import { PERIOD_LABEL, periodStart, periodText, stepAnchor, todayWita, type Period } from '../lib/format';
import { useMeta, useRekapPreview } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { RekapRow } from '../lib/types';

/* =====================================================================
   Rekap mingguan / bulanan / tahunan: lihat ringkasan di layar, lalu unduh PDF / Excel / Word
   ===================================================================== */

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

function Bar({ r }: { r: RekapRow }) {
  if (!r.total) return <span className="rbar" aria-hidden="true" />;
  const w = (n: number) => `${(n / r.total) * 100}%`;
  return (
    <span className="rbar" role="img" aria-label={`${r.baik} baik, ${r.temuan} temuan A, ${r.stop} STOP AA`}>
      <i className="b-ok" style={{ width: w(r.baik) }} />
      <i className="b-warn" style={{ width: w(r.temuan) }} />
      <i className="b-stop" style={{ width: w(r.stop) }} />
    </span>
  );
}

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

      <PmmrCard />

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

      {d && d.sum.total > 0 && (
        <>
          <div className="rtiles">
            <div className="rtile">
              <span className="rtile__label">Total P2H</span>
              <span className="rtile__value">{d.sum.total}</span>
              <span className="rtile__note">{d.sum.expected ? `dari perkiraan ${d.sum.expected}` : ' '}</span>
            </div>
            <div className="rtile rtile--ok">
              <span className="rtile__label">Semua baik</span>
              <span className="rtile__value">{d.sum.baik}</span>
              <span className="rtile__note">{pct(d.sum.baik, d.sum.total)} dari P2H</span>
            </div>
            <div className="rtile rtile--warn">
              <span className="rtile__label">Ada temuan (A)</span>
              <span className="rtile__value">{d.sum.temuan}</span>
              <span className="rtile__note">perbaiki ≤ 12 jam</span>
            </div>
            <div className="rtile rtile--stop">
              <span className="rtile__label">STOP (AA)</span>
              <span className="rtile__value">{d.sum.stop}</span>
              <span className="rtile__note">tidak boleh jalan</span>
            </div>
            <div className="rtile rtile--ok">
              <span className="rtile__label">Terverifikasi</span>
              <span className="rtile__value">{d.sum.verified}</span>
              <span className="rtile__note">sudah ditandatangani pengawas</span>
            </div>
            <div className="rtile">
              <span className="rtile__label">Menunggu verifikasi</span>
              <span className="rtile__value">{d.sum.unverified}</span>
              <span className="rtile__note">belum diperiksa pengawas</span>
            </div>
            <div className="rtile">
              <span className="rtile__label">Kepatuhan</span>
              <span className="rtile__value">{d.sum.compliance == null ? '–' : `${d.sum.compliance}%`}</span>
              <span className="rtile__note">perkiraan</span>
            </div>
            <div className="rtile">
              <span className="rtile__label">Temuan</span>
              <span className="rtile__value">{d.findings.total}</span>
              <span className="rtile__note">
                AA {d.findings.aa} · A {d.findings.a} · selesai {d.findings.closed}
              </span>
            </div>
          </div>

          <section className="card tablecard">
            <div className="tablecard__head">
              <SectionTitle hint="Warna: hijau semua baik, kuning ada temuan A, merah STOP (AA)">Per {d.bucket_unit.toLowerCase()}</SectionTitle>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{d.bucket_unit}</th>
                  <th className="num">P2H</th>
                  <th className="hide-on-phone num">Baik</th>
                  <th className="hide-on-phone num">Temuan A</th>
                  <th className="hide-on-phone num">STOP AA</th>
                  <th className="hide-on-phone num">Terverifikasi</th>
                  <th>Gambaran</th>
                </tr>
              </thead>
              <tbody>
                {d.buckets.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td className="num mono">{b.total}</td>
                    <td className="hide-on-phone num mono">{b.baik}</td>
                    <td className="hide-on-phone num mono">{b.temuan}</td>
                    <td className="hide-on-phone num mono">{b.stop}</td>
                    <td className="hide-on-phone num mono">{b.verified}</td>
                    <td>
                      <Bar r={b} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {d.sites.length > 1 && (
            <section className="card tablecard">
              <div className="tablecard__head">
                <SectionTitle>Per site</SectionTitle>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="num">P2H</th>
                    <th className="hide-on-phone num">Baik</th>
                    <th className="hide-on-phone num">Temuan A</th>
                    <th className="hide-on-phone num">STOP AA</th>
                    <th>Gambaran</th>
                  </tr>
                </thead>
                <tbody>
                  {d.sites.map((s) => (
                    <tr key={s.site}>
                      <td>{s.site}</td>
                      <td className="num mono">{s.total}</td>
                      <td className="hide-on-phone num mono">{s.baik}</td>
                      <td className="hide-on-phone num mono">{s.temuan}</td>
                      <td className="hide-on-phone num mono">{s.stop}</td>
                      <td>
                        <Bar r={s} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <p className="small muted">
            Kepatuhan (perkiraan) = P2H yang masuk dibanding jumlah genset jalan / standby saat ini × shift yang sudah mulai. Unduh PDF, Excel, atau Word untuk daftar lengkap P2H dan temuan pada periode ini.
          </p>
        </>
      )}
    </div>
  );
}
