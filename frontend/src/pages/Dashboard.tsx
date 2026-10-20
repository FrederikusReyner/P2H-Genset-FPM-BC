import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SiteFindings, StatusBar, TopItems, TrendChart } from '../components/charts';
import { UnitTile } from '../components/UnitTile';
import { DangerCode, Empty, ErrorBox, ResultChip, SectionTitle, Segmented } from '../components/ui';
import { CAN_FILL, useAuth } from '../lib/auth';
import { useDashboard } from '../lib/hooks';
import { addDays, ago, dayMonth, dayName, longDate, plain, shiftLabel, timeOf, todayWita, unitTitle } from '../lib/format';
import type { DashUnit, Finding } from '../lib/types';

export default function DashboardPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const date = sp.get('tanggal');
  const shift = sp.get('shift') ? Number(sp.get('shift')) : null;
  const q = useDashboard(date, shift);
  const d = q.data;

  const setParams = (next: { tanggal?: string | null; shift?: number | null }) => {
    const p = new URLSearchParams(sp);
    if ('tanggal' in next) next.tanggal ? p.set('tanggal', next.tanggal) : p.delete('tanggal');
    if ('shift' in next) next.shift ? p.set('shift', String(next.shift)) : p.delete('shift');
    setSp(p, { replace: true });
  };

  const allUnits: DashUnit[] = useMemo(() => d?.sites.flatMap((s) => s.units) ?? [], [d]);
  const missing = useMemo(() => allUnits.filter((u) => u.required && !u.done), [allUnits]);

  if (q.isLoading) return <DashSkeleton />;
  if (q.error && !d) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return null;

  const ctx = d.context;
  const today = todayWita();
  const stale = q.isFetching && q.isPlaceholderData;
  const canFill = !!user && CAN_FILL.includes(user.role);
  const { kpi } = d;

  return (
    <div className={`dash ${stale ? 'is-stale' : ''}`}>
      {/* ---------- penyaring: satu baris di atas ---------- */}
      <div className="filterbar">
        <div className="filterbar__title">
          <div className="eyebrow">Beranda · {ctx.is_current ? 'sedang berjalan' : 'data lampau'}</div>
          <h1 className="h1">
            Shift {shiftLabel(ctx.shift)}
            <span className="h1__sub">
              {longDate(ctx.date)}
            </span>
          </h1>
        </div>
        <div className="filterbar__controls">
          <div className="datebox">
            <button type="button" className="iconbtn" aria-label="Hari sebelumnya" onClick={() => setParams({ tanggal: addDays(ctx.date, -1), shift: ctx.shift })}>
              <Icon name="chevL" size={18} />
            </button>
            <label className="datebox__in">
              <span className="sr-only">Tanggal</span>
              <input
                type="date"
                value={ctx.date}
                max={today}
                onChange={(e) => e.target.value && setParams({ tanggal: e.target.value, shift: ctx.shift })}
              />
            </label>
            <button
              type="button"
              className="iconbtn"
              aria-label="Hari berikutnya"
              disabled={ctx.date >= today}
              onClick={() => setParams({ tanggal: addDays(ctx.date, 1), shift: ctx.shift })}
            >
              <Icon name="chevR" size={18} />
            </button>
          </div>
          <Segmented
            label="Pilih shift"
            value={ctx.shift}
            onChange={(v) => setParams({ tanggal: ctx.date, shift: v })}
            options={[
              { value: 1, label: 'Shift I' },
              { value: 2, label: 'Shift II' },
            ]}
          />
          {!ctx.is_current && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setParams({ tanggal: null, shift: null })}>
              <Icon name="refresh" size={16} /> Shift sekarang
            </button>
          )}
        </div>
      </div>

      {/* ---------- kepala: angka utama ---------- */}
      <section className="hero card" aria-label="Ringkasan shift">
        <div className="hero__main">
          <div className="hero__fig">
            <div className="hero__num">
              {kpi.compliance_pct}
              <span className="hero__pct">%</span>
            </div>
            <div className="hero__cap">
              unit sudah P2H
              <b>
                {kpi.done} dari {kpi.required} unit
              </b>
              {kpi.excluded > 0 && (
                <span className="hero__note">
                  {kpi.excluded} genset breakdown tidak dihitung
                  {' · '}
                  <Link to="/unit">lihat</Link>
                </span>
              )}
            </div>
          </div>
          <div className="hero__bar">
            <StatusBar units={allUnits} />
          </div>
        </div>

        <div className="statrow">
          <Link to="/temuan" className={`stat stat--link ${kpi.stop ? 'stat--stop' : kpi.open_findings ? 'stat--warn' : ''}`}>
            <span className="stat__label">Temuan terbuka</span>
            <span className="stat__value">{kpi.open_findings}</span>
            <span className="stat__note">
              {kpi.open_aa ? (
                <>
                  <Icon name="stop" size={14} stroke={2.6} /> {kpi.open_aa} STOP OPERASI
                </>
              ) : kpi.open_findings ? (
                'perlu diperbaiki ≤ 12 jam'
              ) : (
                'tidak ada, bagus'
              )}
            </span>
          </Link>
          <div className={`stat ${kpi.missing ? 'stat--pend' : ''}`}>
            <span className="stat__label">Belum P2H</span>
            <span className="stat__value">{kpi.missing}</span>
            <span className="stat__note">
              {kpi.missing
                ? missing
                    .slice(0, 3)
                    .map((u) => u.code.replace('BC-GE-P-', 'P-').replace('BIB-GE-P-', 'BIB-'))
                    .join(', ') + (missing.length > 3 ? ` +${missing.length - 3}` : '')
                : 'semua sudah diisi'}
            </span>
          </div>
          <Link to="/p2h?belumverifikasi=1" className={`stat stat--link ${kpi.unsigned ? 'stat--pend' : ''}`}>
            <span className="stat__label">Menunggu verifikasi pengawas</span>
            <span className="stat__value">{kpi.unsigned}</span>
            <span className="stat__note">{kpi.unsigned ? 'P2H shift ini belum Terverifikasi' : 'semua sudah Terverifikasi'}</span>
          </Link>
        </div>
      </section>

      <div className="dash__grid">
        {/* ---------- perlu tindakan ---------- */}
        <section className="card dash__todo" aria-label="Perlu tindakan">
          <SectionTitle
            hint={d.open_findings.total ? `${d.open_findings.total} temuan belum selesai diperbaiki` : undefined}
            right={
              d.open_findings.total > 0 && (
                <Link to="/temuan" className="btn btn--sm btn--ghost">
                  Semua <Icon name="chevR" size={16} />
                </Link>
              )
            }
          >
            Perlu tindakan
          </SectionTitle>
          {d.open_findings.items.length === 0 ? (
            <Empty icon="check" title="Tidak ada temuan terbuka" hint="Semua kerusakan yang pernah dilaporkan sudah diperbaiki." />
          ) : (
            <ul className="todo">
              {d.open_findings.items.map((f) => (
                <TodoRow key={f.id} f={f} onClick={() => nav('/temuan')} />
              ))}
            </ul>
          )}
        </section>

        {/* ---------- belum P2H ---------- */}
        <section className="card dash__missing" aria-label="Belum P2H">
          <SectionTitle hint={`Shift ${shiftLabel(ctx.shift)} · ${dayName(ctx.date)}, ${dayMonth(ctx.date)}`}>Belum P2H</SectionTitle>
          {missing.length === 0 ? (
            <Empty icon="check" title="Semua unit sudah P2H" hint="Tidak ada genset yang terlewat di shift ini." />
          ) : (
            <ul className="miss">
              {missing.map((u) => (
                <li key={u.id}>
                  <div className="miss__who">
                    <span className="mono miss__code">{u.code}</span>
                    <span className="small muted">{siteName(d.sites, u.site_id)}</span>
                  </div>
                  {canFill && ctx.is_current ? (
                    <Link to={`/p2h/baru?unit=${u.id}`} className="btn btn--sm btn--primary">
                      Isi
                    </Link>
                  ) : (
                    <span className="chip chip--idle">
                      <Icon name="clock" size={13} /> Belum
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ---------- peta status per site ---------- */}
      <SectionTitle hint="Warna + ikon + tulisan di tiap kotak menunjukkan keadaan genset. Ketuk untuk membuka.">Status genset per site</SectionTitle>
      <div className="sites">
        {d.sites.map((s) => (
          <section key={s.id} className="sitepanel card" aria-label={`Site ${s.name}`}>
            <header className="sitepanel__head">
              <h3 className="sitepanel__name">{s.name}</h3>
              <span className="sitepanel__count">
                <b>{s.done}</b>/{s.required} sudah P2H
              </span>
              <span className="grow" />
              {s.stop > 0 && (
                <span className="chip chip--stop">
                  <Icon name="stop" size={13} stroke={2.6} /> {s.stop} STOP
                </span>
              )}
              {s.warn > 0 && (
                <span className="chip chip--warn">
                  <Icon name="alert" size={13} stroke={2.6} /> {s.warn} temuan
                </span>
              )}
            </header>
            <div className="sitepanel__meter" aria-hidden="true">
              <span style={{ width: `${s.required ? (s.done / s.required) * 100 : 0}%` }} />
            </div>
            <div className="tiles">
              {s.units.map((u) => (
                <UnitTile
                  key={u.id}
                  u={u}
                  onClick={() => (u.form_id ? nav(`/p2h/${u.form_id}`) : canFill && u.required && ctx.is_current ? nav(`/p2h/baru?unit=${u.id}`) : nav('/unit'))}
                />
              ))}
              {s.units.length === 0 && <div className="muted small">Belum ada genset di site ini.</div>}
            </div>
          </section>
        ))}
      </div>

      {/* ---------- grafik ---------- */}
      <div className="dash__charts">
        <section className="card" aria-label="Kepatuhan harian">
          <SectionTitle hint="Persen unit yang sudah P2H di kedua shift">Kepatuhan P2H {d.trend.length} hari</SectionTitle>
          <TrendChart data={d.trend} selected={ctx.date} onPick={(dt) => setParams({ tanggal: dt, shift: ctx.shift })} />
        </section>
        <section className="card" aria-label="Temuan terbanyak">
          <SectionTitle hint="30 hari terakhir, jumlah laporan per butir cek">Temuan terbanyak</SectionTitle>
          {d.top_items.length ? <TopItems items={d.top_items} /> : <Empty icon="check" title="Belum ada temuan" hint="Belum ada butir cek yang dilaporkan rusak dalam 30 hari." />}
        </section>
        <section className="card" aria-label="Temuan per site">
          <SectionTitle hint="30 hari terakhir">Temuan per site</SectionTitle>
          {d.sites.some((s) => s.findings_30d.aa + s.findings_30d.a > 0) ? (
            <SiteFindings sites={d.sites} />
          ) : (
            <Empty icon="check" title="Belum ada temuan" hint="Tidak ada temuan di semua site dalam 30 hari." />
          )}
        </section>
        <section className="card" aria-label="P2H terbaru">
          <SectionTitle right={<Link to="/p2h" className="btn btn--sm btn--ghost">Riwayat <Icon name="chevR" size={16} /></Link>}>P2H terbaru</SectionTitle>
          {d.recent.length === 0 ? (
            <Empty icon="history" title="Belum ada P2H" hint="P2H yang baru diisi akan muncul di sini." />
          ) : (
            <ul className="recent">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <Link to={`/p2h/${r.id}`} className="recent__row">
                    <span className="recent__main">
                      <span className="mono recent__code">{unitTitle({ code: r.unit_code })}</span>
                      <span className="small muted">
                        {r.site_name} · Shift {shiftLabel(r.shift)} · {r.inspector_name} · {timeOf(r.filled_at)}
                      </span>
                    </span>
                    <ResultChip result={r.result} compact />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="small muted dash__foot">Diperbarui {ago(d.generated_at)} · otomatis menyegarkan tiap 45 detik</p>
    </div>
  );
}

function siteName(sites: { id: number; name: string }[], id: number) {
  return sites.find((s) => s.id === id)?.name ?? '';
}

function TodoRow({ f, onClick }: { f: Finding; onClick: () => void }) {
  return (
    <li>
      <button type="button" className={`todo__row todo__row--${f.danger_code}`} onClick={onClick}>
        <DangerCode code={f.danger_code} title={false} />
        <span className="todo__main">
          <span className="todo__top">
            <span className="mono">{f.unit_code}</span>
            <span className="muted small">{f.site_name}</span>
          </span>
          <span className="todo__text">{plain(f.item_text)}</span>
          <span className="todo__meta small muted">
            {f.times > 1 ? `Dilaporkan ${f.times}× · ` : ''}
            sejak {ago(f.first_seen_at ?? f.last_seen_at)}
            {f.status === 'in_progress' ? ' · sedang diperbaiki' : ''}
          </span>
        </span>
        {f.overdue ? (
          <span className="chip chip--stop">Lewat batas</span>
        ) : f.danger_code === 'AA' ? (
          <span className="chip chip--stop">STOP</span>
        ) : (
          <Icon name="chevR" size={18} className="muted" />
        )}
      </button>
    </li>
  );
}

function DashSkeleton() {
  return (
    <div className="dash" aria-busy="true">
      <div className="skel skel--title" />
      <div className="skel skel--hero" />
      <div className="skel skel--card" />
      <div className="skel skel--card" />
    </div>
  );
}
