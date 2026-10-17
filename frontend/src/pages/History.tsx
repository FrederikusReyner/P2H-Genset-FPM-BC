import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { DownloadMenu, Empty, ErrorBox, PageHead, Pager, ResultChip, Spinner } from '../components/ui';
import { downloadFile } from '../lib/api';
import { CAN_FILL, useAuth } from '../lib/auth';
import { addDays, dateTime, dayName, mediumDate, modelOf, num, shiftLabel, shortDate, timeOf, todayWita, unitTitle } from '../lib/format';
import { useHistory, useMeta, useUnits } from '../lib/hooks';
import { useToast } from '../lib/toast';

const LIMIT = 30;

export default function HistoryPage() {
  const { user } = useAuth();
  const meta = useMeta();
  const unitsQ = useUnits();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [dl, setDl] = useState(false);
  const today = todayWita();

  const f = {
    from: sp.get('dari') || addDays(today, -6),
    to: sp.get('sampai') || today,
    site_id: sp.get('site') ? Number(sp.get('site')) : null,
    unit_id: sp.get('unit') ? Number(sp.get('unit')) : null,
    shift: sp.get('shift') ? Number(sp.get('shift')) : null,
    result: sp.get('hasil') || '',
    q: sp.get('q') || '',
    mine: sp.get('saya') === '1',
    unsigned: sp.get('belumttd') === '1',
    offset: Number(sp.get('hal') || 0),
  };

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    if (!('hal' in patch)) p.delete('hal');
    setSp(p, { replace: true });
  };

  const q = useHistory({ ...f, limit: LIMIT });
  const items = q.data?.items ?? [];
  const units = useMemo(() => (unitsQ.data?.items ?? []).filter((u) => !f.site_id || u.site_id === f.site_id), [unitsQ.data, f.site_id]);
  const canFill = !!user && CAN_FILL.includes(user.role);

  const range = (days: number) => set({ dari: addDays(today, -(days - 1)), sampai: today });

  const download = async (format: 'pdf' | 'xlsx' | 'docx') => {
    setDl(true);
    try {
      const filters: Record<string, string | number> = { from: f.from, to: f.to };
      if (f.site_id) filters.site_id = f.site_id;
      if (f.unit_id) filters.unit_id = f.unit_id;
      if (f.shift) filters.shift = f.shift;
      if (f.result) filters.result = f.result;
      if (f.q) filters.q = f.q;
      if (f.unsigned) filters.unsigned = 1;
      await downloadFile({ kind: 'rekap', format, filters });
    } catch (e) {
      toast.push({ title: 'Gagal menyiapkan unduhan', body: e instanceof Error ? e.message : undefined, tone: 'danger' });
    } finally {
      window.setTimeout(() => setDl(false), 1200);
    }
  };

  return (
    <div className="page">
      <PageHead eyebrow="Arsip" title="Riwayat P2H">
        <DownloadMenu onPick={download} label="Unduh rekap" busy={dl} disabled={!items.length} />
      </PageHead>

      <section className="card filters" aria-label="Penyaring">
        <div className="filters__quick">
          <button type="button" className="fchip" onClick={() => range(1)}>
            Hari ini
          </button>
          <button type="button" className="fchip" onClick={() => range(7)}>
            7 hari
          </button>
          <button type="button" className="fchip" onClick={() => range(30)}>
            30 hari
          </button>
          <span className="grow" />
          {canFill && (
            <label className="check check--chip">
              <input type="checkbox" checked={f.mine} onChange={(e) => set({ saya: e.target.checked ? '1' : null })} />
              <span>P2H saya</span>
            </label>
          )}
          <label className="check check--chip">
            <input type="checkbox" checked={f.unsigned} onChange={(e) => set({ belumttd: e.target.checked ? '1' : null })} />
            <span>Belum ditandatangani</span>
          </label>
        </div>
        <div className="filters__grid">
          <label className="field">
            <span className="field__label">Dari tanggal</span>
            <input className="input" type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ dari: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Sampai tanggal</span>
            <input className="input" type="date" value={f.to} min={f.from} max={today} onChange={(e) => e.target.value && set({ sampai: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Site</span>
            <select className="input" value={f.site_id ?? ''} onChange={(e) => set({ site: e.target.value || null, unit: null })}>
              <option value="">Semua site</option>
              {meta.data?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Unit</span>
            <select className="input" value={f.unit_id ?? ''} onChange={(e) => set({ unit: e.target.value || null })}>
              <option value="">Semua unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Shift</span>
            <select className="input" value={f.shift ?? ''} onChange={(e) => set({ shift: e.target.value || null })}>
              <option value="">Semua shift</option>
              <option value="1">Shift I</option>
              <option value="2">Shift II</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Hasil</span>
            <select className="input" value={f.result} onChange={(e) => set({ hasil: e.target.value || null })}>
              <option value="">Semua hasil</option>
              <option value="baik">Semua baik</option>
              <option value="temuan_a">Ada temuan (A)</option>
              <option value="stop_aa">STOP OPERASI (AA)</option>
            </select>
          </label>
        </div>
        <label className="searchbox">
          <Icon name="search" size={18} />
          <input value={f.q} onChange={(e) => set({ q: e.target.value || null })} placeholder="Cari kode unit atau nama mekanik…" aria-label="Cari" />
        </label>
      </section>

      {q.isLoading && <Spinner />}
      {q.error && !q.data && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}

      {q.data && items.length === 0 && (
        <Empty icon="history" title="Tidak ada P2H" hint="Coba ubah tanggal atau penyaring di atas." />
      )}

      {items.length > 0 && (
        <>
          <div className="small muted hist__count">
            {q.data!.total} P2H · {mediumDate(f.from)} s.d. {mediumDate(f.to)}
          </div>

          {/* tabel (komputer) */}
          <div className="card tablecard hide-on-phone">
            <table className="table table--hover">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Unit</th>
                  <th>Site</th>
                  <th>Mekanik / Electrician</th>
                  <th className="num">HM awal → akhir</th>
                  <th>Hasil</th>
                  <th>Pengawas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">
                      <Link to={`/p2h/${r.id}`} className="rowlink">
                        {dayName(r.shift_date)}, {shortDate(r.shift_date)}
                      </Link>
                      <div className="small muted">
                        Shift {shiftLabel(r.shift)} · {timeOf(r.filled_at)}
                      </div>
                    </td>
                    <td>
                      <span className="mono">{unitTitle({ code: r.unit_code, old_code: r.unit_old_code })}</span>
                      <div className="small muted">{modelOf({ brand: r.unit_brand, model: r.unit_model })}</div>
                    </td>
                    <td>{r.site_name}</td>
                    <td>{r.inspector_name}</td>
                    <td className="num mono">
                      {num(r.hm_start) || '—'} → {num(r.hm_end) || '—'}
                    </td>
                    <td>
                      <ResultChip result={r.result} />
                    </td>
                    <td>
                      {r.signed ? (
                        <span className="small" title={dateTime(r.sup_signed_at)}>
                          <Icon name="check" size={14} stroke={2.6} /> {r.sup_name}
                        </span>
                      ) : (
                        <span className="small muted">belum</span>
                      )}
                    </td>
                    <td>
                      <Link to={`/p2h/${r.id}`} className="iconbtn iconbtn--plain" aria-label={`Buka P2H ${r.unit_code}`}>
                        <Icon name="chevR" size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* kartu (HP) */}
          <ul className="cards only-phone">
            {items.map((r) => (
              <li key={r.id}>
                <Link to={`/p2h/${r.id}`} className={`hcard hcard--${r.result}`}>
                  <div className="hcard__top">
                    <span className="mono hcard__code">{r.unit_code}</span>
                    <ResultChip result={r.result} />
                  </div>
                  <div className="small">
                    {r.site_name} · {dayName(r.shift_date)}, {shortDate(r.shift_date)} · Shift {shiftLabel(r.shift)}
                  </div>
                  <div className="small muted">
                    {r.inspector_name} · {timeOf(r.filled_at)}
                    {r.n_aa + r.n_a > 0 ? ` · ${r.n_aa ? r.n_aa + ' AA ' : ''}${r.n_a ? r.n_a + ' A' : ''}` : ''}
                  </div>
                  <div className="small hcard__sign">{r.signed ? <><Icon name="check" size={14} stroke={2.6} /> TTD {r.sup_name}</> : <span className="muted">Belum ditandatangani pengawas</span>}</div>
                </Link>
              </li>
            ))}
          </ul>
          <Pager total={q.data!.total} limit={LIMIT} offset={f.offset} onChange={(o) => set({ hal: o ? String(o) : null })} />
        </>
      )}
    </div>
  );
}
