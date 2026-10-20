import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { MONTHS, MonthStep, PmmrButton, thisMonth, type YM } from '../components/Pmmr';
import { Empty, ErrorBox, PageHead, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { UNIT_STATUS_LABEL, num, parseNum } from '../lib/format';
import { useMonthly } from '../lib/hooks';
import { useToast } from '../lib/toast';

/* =====================================================================
   Data bulanan: HM awal / akhir (dihitung otomatis) dan kWh (diisi manual) untuk rekap Excel PMMR.
   Untuk pengawas, teknisi & pengawas, dan admin.
   ===================================================================== */

const kwhText = (v: number | null) => (v === null ? '' : num(v, 1));
const SOURCE: Record<string, string> = { P2H: 'dari P2H', impor: 'data lama' };

export default function BulananPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [ym, setYm] = useState<YM>(thisMonth);
  const q = useMonthly(ym.year, ym.month);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const showSite = new Set(items.map((i) => i.site_id)).size > 1;

  // ganti bulan atau data baru dimuat: buang isian yang belum disimpan
  useEffect(() => {
    setEdits({});
  }, [ym.year, ym.month]);

  const state = useMemo(() => {
    const changed: { unit_id: number; kwh: number | null }[] = [];
    const bad = new Set<number>();
    for (const it of items) {
      const raw = edits[it.id];
      if (raw === undefined || raw === kwhText(it.kwh)) continue;
      const v = parseNum(raw);
      if (v !== null && (Number.isNaN(v) || v < 0)) bad.add(it.id);
      else changed.push({ unit_id: it.id, kwh: v });
    }
    return { changed, bad };
  }, [items, edits]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/bulanan/kwh', { year: ym.year, month: ym.month, items: state.changed });
      await qc.invalidateQueries({ queryKey: ['monthly'] });
      setEdits({});
      toast.push({ title: 'kWh bulanan disimpan', body: `${state.changed.length} unit · ${MONTHS[ym.month - 1]} ${ym.year}`, tone: 'ok' });
    } catch (e) {
      toast.push({ title: 'Gagal menyimpan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const dirty = state.changed.length > 0;
  return (
    <div className="page rekap">
      <PageHead eyebrow="Rekap PMMR" title="Data bulanan">
        <PmmrButton value={ym} />
      </PageHead>

      <section className="card rekap__ctrl" aria-label="Pilih bulan">
        <MonthStep value={ym} onChange={setYm} />
        <p className="small muted" style={{ margin: 0 }}>
          HM awal dan HM akhir terisi sendiri dari P2H (bulan lama dari data PMMR). Yang perlu diisi di sini hanya <b>kWh</b>: total listrik yang dihasilkan genset selama bulan itu, dibaca dari meter kWh. Kosongkan kalau datanya tidak ada.
        </p>
      </section>

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && items.length === 0 && <Empty icon="bolt" title="Belum ada genset" hint="Genset produksi di site Anda belum terdaftar." />}

      {items.length > 0 && (
        <section className="card tablecard">
          <table className="table">
            <thead>
              <tr>
                <th>Unit</th>
                <th className="hide-on-phone num">HM awal</th>
                <th className="hide-on-phone num">HM akhir</th>
                <th className="hide-on-phone num">HM jalan</th>
                <th className="num">kWh</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const run = it.hm_start !== null && it.hm_end !== null ? it.hm_end - it.hm_start : null;
                const val = edits[it.id] ?? kwhText(it.kwh);
                const isBad = state.bad.has(it.id);
                return (
                  <tr key={it.id}>
                    <td>
                      <span className="mono">{it.code}</span>
                      <div className="small muted">
                        {[showSite ? it.site_name : null, [it.brand, it.model].filter(Boolean).join(' '), it.status !== 'running' ? UNIT_STATUS_LABEL[it.status] : null].filter(Boolean).join(' · ')}
                      </div>
                      <div className="small muted only-phone">
                        HM {num(it.hm_start) || '—'} → {num(it.hm_end) || '—'}
                        {run !== null ? ` (${num(run)} jam)` : ''}
                      </div>
                    </td>
                    <td className="hide-on-phone num mono">{num(it.hm_start) || '—'}</td>
                    <td className="hide-on-phone num mono">
                      {num(it.hm_end) || '—'}
                      {it.hm_source && <div className="small muted">{SOURCE[it.hm_source] ?? it.hm_source}</div>}
                    </td>
                    <td className="hide-on-phone num mono">{run !== null ? num(run) : '—'}</td>
                    <td className="num">
                      <input
                        className={`input input--auto mono kwhin ${isBad ? 'is-bad' : ''}`}
                        inputMode="decimal"
                        value={val}
                        aria-label={`kWh ${it.code}`}
                        aria-invalid={isBad || undefined}
                        placeholder="0"
                        onChange={(e) => setEdits((s) => ({ ...s, [it.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="savebar">
            <span className="small muted grow">
              {state.bad.size > 0 ? 'Ada isian yang bukan angka.' : dirty ? `${state.changed.length} unit belum disimpan` : 'Tidak ada perubahan'}
            </span>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !dirty || state.bad.size > 0}>
              <Icon name="check" size={18} /> {busy ? 'Menyimpan…' : 'Simpan kWh'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
