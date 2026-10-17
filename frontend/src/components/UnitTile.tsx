import { Icon } from './Icon';
import { tileInfo } from './ui';
import { modelOf, timeOf } from '../lib/format';
import type { DashUnit } from '../lib/types';

/** Satu kotak = satu genset. Warna + ikon + tulisan menunjukkan keadaannya (tidak hanya warna). */
export function UnitTile({ u, onClick }: { u: DashUnit; onClick: () => void }) {
  const info = tileInfo(u.state);
  const line2 = u.done
    ? `P2H ${timeOf(u.filled_at)} · ${u.inspector_name?.split(' ')[0] ?? ''}`
    : u.required
      ? 'Belum P2H shift ini'
      : u.status === 'breakdown'
        ? 'Breakdown'
        : u.status === 'inactive'
          ? 'Tidak aktif'
          : '';
  const flags: string[] = [];
  if (u.open_aa) flags.push(`${u.open_aa} AA`);
  if (u.open_a) flags.push(`${u.open_a} A`);
  return (
    <button
      type="button"
      className={`tile tile--${u.state}`}
      onClick={onClick}
      aria-label={`${u.code}. ${info.label}. ${line2}${flags.length ? '. Temuan terbuka ' + flags.join(', ') : ''}`}
    >
      <span className="tile__bar" aria-hidden="true" />
      <span className="tile__head">
        <span className="tile__code mono">{u.code.replace('BC-GE-P-', 'P-').replace('BIB-GE-P-', 'BIB-')}</span>
        <Icon name={info.icon} size={16} stroke={2.6} className="tile__icon" />
      </span>
      <span className="tile__model">{modelOf(u) || '—'}</span>
      <span className="tile__state">
        {info.label}
        {flags.length > 0 && u.state !== 'ok' && <span className="tile__flags"> · {flags.join(' · ')}</span>}
      </span>
      {line2 && <span className="tile__meta">{line2}</span>}
    </button>
  );
}
