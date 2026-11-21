import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, ErrorBox, PageHead, Spinner } from '../../components/ui';
import { CAN_FILL, useAuth } from '../../lib/auth';
import { mediumDate, shiftLabel } from '../../lib/format';
import { PERIOD_TEXT, RESULT_TEXT, RESULT_TONE, formIcon, formPath, useFormOverview , lowerFirst } from '../../lib/forms';
import type { FormSubject } from '../../lib/types';
import { SiteChips, useFormSite } from './SiteChips';

/** Ringkasan satu jenis form: objek yang diperiksa dan keadaannya. */
export default function FormHomePage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  const q = useFormOverview(code);
  const [qtext, setQtext] = useState('');
  const [site, setSite] = useFormSite();
  const canFill = !!user && CAN_FILL.includes(user.role);

  const subjects = useMemo(() => {
    const k = qtext.trim().toLowerCase();
    const all = (q.data?.subjects ?? []).filter((s) => !site || s.site_id === site);
    return k ? all.filter((s) => `${s.name} ${s.detail ?? ''} ${s.site_name}`.toLowerCase().includes(k)) : all;
  }, [q.data, qtext, site]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const { type: t, period } = q.data;
  const all = q.data.subjects.filter((s) => !site || s.site_id === site);
  const perSite: Record<number, number> = {};
  for (const s of q.data.subjects) perSite[s.site_id] = (perSite[s.site_id] ?? 0) + 1;
  const stop = all.reduce((n, s) => n + s.open_stop, 0);
  const fix = all.reduce((n, s) => n + s.open_fix, 0);
  const done = all.filter((s) => s.done_now).length;

  return (
    <div className="page">
      <PageHead eyebrow={`${PERIOD_TEXT[t.period]} · ${t.filler_label} → ${t.verifier_label}`} title={t.short_name}>
        <Link to={formPath(code, '/rekap')} className="btn btn--ghost">
          <Icon name="chart" size={18} /> Rekap &amp; grafik
        </Link>
        {canFill && (
          <Link to={formPath(code, '/baru')} className="btn btn--primary">
            <Icon name="plus" size={18} /> Isi baru
          </Link>
        )}
      </PageHead>
      <p className="muted lintro">{t.name}</p>
      <SiteChips value={site} onChange={setSite} counts={perSite} />

      <section className="kpis kpis--form">
        {period && (
          <div className="kpi">
            <div className="kpi__label">{period.label}</div>
            <div className="kpi__value">
              {done}
              <span className="kpi__of">/{all.length}</span>
            </div>
            <div className="small muted">{lowerFirst(t.subject_label)} sudah diperiksa</div>
          </div>
        )}
        <Link to={formPath(code, '/temuan')} className={`kpi kpi--link ${stop ? 'kpi--stop' : ''}`}>
          <div className="kpi__label">Temuan STOP</div>
          <div className="kpi__value">{stop}</div>
          <div className="small muted">belum selesai</div>
        </Link>
        <Link to={formPath(code, '/temuan')} className={`kpi kpi--link ${fix ? 'kpi--warn' : ''}`}>
          <div className="kpi__label">Temuan perbaiki</div>
          <div className="kpi__value">{fix}</div>
          <div className="small muted">batas {t.fix_hours} jam</div>
        </Link>
        <Link to={formPath(code, '/riwayat?unverified=1')} className="kpi kpi--link">
          <div className="kpi__label">Riwayat</div>
          <div className="kpi__value">
            <Icon name="history" size={26} />
          </div>
          <div className="small muted">lihat semua isian</div>
        </Link>
      </section>

      <div className="row row--between fh-head">
        <h2 className="h2">{t.subject_label}</h2>
        {all.length > 6 && (
          <label className="searchbox fh-search">
            <Icon name="search" size={18} />
            <input value={qtext} onChange={(e) => setQtext(e.target.value)} placeholder={`Cari ${lowerFirst(t.subject_label)}…`} aria-label="Cari" />
          </label>
        )}
      </div>

      {all.length === 0 && (
        <Empty icon={formIcon(t.icon)} title={`Belum ada ${lowerFirst(t.subject_label)}`} hint={user?.role === 'admin' ? 'Tambahkan dulu di Kelola.' : 'Minta admin menambahkannya.'}>
          {user?.role === 'admin' && (
            <Link to={formPath(code, '/kelola')} className="btn btn--dark">
              <Icon name="settings" size={18} /> Kelola
            </Link>
          )}
        </Empty>
      )}

      <ul className="slist">
        {subjects.map((s) => (
          <li key={s.id}>
            <SubjectRow code={code} s={s} canFill={canFill} periodOn={!!period} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubjectRow({ code, s, canFill, periodOn }: { code: string; s: FormSubject; canFill: boolean; periodOn: boolean }) {
  const tone = s.open_stop ? 'stop' : s.open_fix ? 'warn' : s.done_now === false ? 'pending' : 'ok';
  return (
    <article className={`srow srow--${tone}`}>
      <div className="srow__bar" aria-hidden="true" />
      <div className="srow__main">
        <div className="srow__title">
          <b className="mono">{s.name}</b>
          <span className="small muted">
            {[s.detail, s.site_name].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="srow__chips">
          {periodOn &&
            (s.done_now ? (
              <span className="chip chip--ok">
                <Icon name="check" size={13} stroke={2.6} /> Sudah diperiksa
              </span>
            ) : (
              <span className="chip chip--idle">
                <Icon name="clock" size={13} stroke={2.4} /> Belum diperiksa
              </span>
            ))}
          {s.open_stop > 0 && (
            <span className="chip chip--stop">
              <Icon name="stop" size={13} stroke={2.6} /> {s.open_stop} STOP
            </span>
          )}
          {s.open_fix > 0 && (
            <span className="chip chip--warn">
              <Icon name="alert" size={13} stroke={2.6} /> {s.open_fix} temuan
            </span>
          )}
        </div>
        <div className="small muted">
          {s.last_id ? (
            <Link to={formPath(code, `/r/${s.last_id}`)} className="link">
              Terakhir {mediumDate(s.last_date!)}
              {s.last_shift ? ` Shift ${shiftLabel(s.last_shift)}` : ''} · {RESULT_TEXT[s.last_result!]}
              {s.last_verified ? ' · terverifikasi' : ' · menunggu verifikasi'}
            </Link>
          ) : (
            'Belum pernah diisi'
          )}
        </div>
      </div>
      <div className="srow__act">
        {s.last_result && <span className={`dot dot--${RESULT_TONE[s.last_result]}`} aria-hidden="true" />}
        {canFill && (
          <Link to={formPath(code, `/baru?subject=${s.id}`)} className="btn btn--sm btn--primary">
            Isi
          </Link>
        )}
        <Link to={formPath(code, `/riwayat?subject=${s.id}`)} className="btn btn--sm btn--ghost">
          Riwayat
        </Link>
      </div>
    </article>
  );
}
