import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { Empty, ErrorBox, PageHead, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { GENSET_CODE, canUseForm, formIcon, formPath, PERIOD_TEXT, useFormTypes, lowerFirst } from '../lib/forms';
import { useFindings, useUnits } from '../lib/hooks';

/** Layar pertama sesudah masuk: pilih form yang mau dibuka. */
export default function LauncherPage() {
  const { user } = useAuth();
  const types = useFormTypes();
  const gensetOk = canUseForm(user, GENSET_CODE);
  const genset = useFindings('open', null, gensetOk);
  const units = useUnits(gensetOk);
  const gAA = genset.data?.items.filter((f) => f.danger_code === 'AA').length ?? 0;
  const gA = (genset.data?.items.length ?? 0) - gAA;
  const gRequired = units.data?.items.filter((u) => u.status === 'running' || u.status === 'standby') ?? [];
  const gDone = gRequired.filter((u) => u.current_form_id).length;

  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';

  return (
    <div className="page">
      <PageHead eyebrow={`${greet}, ${user?.name?.split(' ')[0] ?? ''}`} title="Pilih form" />
      <p className="muted lintro">Semua pemeriksaan dalam satu aplikasi. Pilih form yang mau diisi atau dipantau.</p>

      <ul className="lcards">
        {gensetOk && (
        <li>
          <LCard
            to="/genset"
            icon="generator"
            title="P2H Genset"
            sub="Pemeriksaan harian genset tiap shift, rekap & PMMR."
            period="Tiap shift"
            stop={gAA}
            fix={gA}
            progress={gRequired.length ? { label: 'Shift ini', done: gDone, total: gRequired.length } : null}
          />
        </li>
        )}
        {types.data?.items.map((t) => (
          <li key={t.code}>
            <LCard
              to={formPath(t.code)}
              icon={formIcon(t.icon)}
              title={t.short_name}
              sub={t.description ?? t.name}
              period={PERIOD_TEXT[t.period]}
              stop={t.open_stop}
              fix={t.open_fix}
              unverified={t.unverified}
              progress={t.period_label && t.subjects ? { label: t.period_label, done: t.done_this_period ?? 0, total: t.subjects } : null}
              empty={t.subjects === 0 ? (user?.role === 'admin' ? `Belum ada ${lowerFirst(t.subject_label)}, tambahkan di Kelola` : `Belum ada ${lowerFirst(t.subject_label)} di site Anda`) : null}
            />
          </li>
        ))}
      </ul>
      {types.isLoading && <Spinner label="Memuat daftar form…" />}
      {types.data && !gensetOk && types.data.items.length === 0 && (
        <Empty icon="lock" title="Belum ada form untuk akun Anda" hint="Minta admin memberi akses form di menu Pengguna." />
      )}
      {types.error && !types.data && <ErrorBox error={types.error} onRetry={() => void types.refetch()} />}
    </div>
  );
}

function LCard({
  to,
  icon,
  title,
  sub,
  period,
  stop,
  fix,
  unverified = 0,
  progress,
  empty,
}: {
  to: string;
  icon: IconName;
  title: string;
  sub: string;
  period: string;
  stop: number;
  fix: number;
  unverified?: number;
  progress: { label: string; done: number; total: number } | null;
  empty?: string | null;
}) {
  const tone = stop > 0 ? 'stop' : fix > 0 ? 'warn' : 'ok';
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Link to={to} className={`lcard lcard--${tone}`}>
      <span className="lcard__icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <span className="lcard__body">
        <span className="lcard__title">{title}</span>
        <span className="lcard__sub">{sub}</span>
        <span className="lcard__chips">
          <span className="chip chip--idle">{period}</span>
          {stop > 0 && (
            <span className="chip chip--stop">
              <Icon name="stop" size={13} stroke={2.6} /> {stop} STOP
            </span>
          )}
          {fix > 0 && (
            <span className="chip chip--warn">
              <Icon name="alert" size={13} stroke={2.6} /> {fix} temuan
            </span>
          )}
          {unverified > 0 && (
            <span className="chip chip--info">
              <Icon name="clock" size={13} stroke={2.4} /> {unverified} belum diverifikasi
            </span>
          )}
        </span>
        {progress && (
          <span className="lcard__prog">
            <span className="small">
              {progress.label}: <b>{progress.done}</b>/{progress.total}
            </span>
            <span className="lcard__bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </span>
        )}
        {empty && <span className="small muted">{empty}</span>}
      </span>
      <Icon name="chevR" size={20} className="lcard__go" />
    </Link>
  );
}
