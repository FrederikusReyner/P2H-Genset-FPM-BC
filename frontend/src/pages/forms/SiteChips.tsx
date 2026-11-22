import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useMeta } from '../../lib/hooks';

/*
 * Saringan site untuk form digital. Teknisi & pengawas sudah terkunci ke site-nya (server yang membatasi),
 * jadi pilihan ini hanya tampil untuk admin. Pilihan diingat selama sesi, sama untuk semua halaman form.
 */

const KEY = 'forms.site';
const listeners = new Set<(v: number | null) => void>();
let current: number | null = (() => {
  try {
    const v = Number(sessionStorage.getItem(KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
})();

function setSite(v: number | null) {
  current = v;
  try {
    if (v) sessionStorage.setItem(KEY, String(v));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* penyimpanan diblokir: pilihan hanya selama halaman terbuka */
  }
  listeners.forEach((l) => l(v));
}

/** Site yang sedang dipilih (null = semua). Untuk selain admin selalu null: server sudah membatasi ke site-nya. */
export function useFormSite(): [number | null, (v: number | null) => void] {
  const { user } = useAuth();
  const [v, setV] = useState(current);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return [user?.role === 'admin' ? v : null, setSite];
}

export function SiteChips({ value, onChange, counts }: { value: number | null; onChange: (v: number | null) => void; counts?: Record<number, number> }) {
  const { user } = useAuth();
  const meta = useMeta();
  const sites = meta.data?.sites ?? [];
  if (user?.role !== 'admin' || sites.length < 2) return null;
  return (
    <div className="chips sitechips" role="tablist" aria-label="Site">
      <button type="button" role="tab" aria-selected={value === null} className={`fchip ${value === null ? 'is-on' : ''}`} onClick={() => onChange(null)}>
        Semua site
      </button>
      {sites.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={value === s.id} className={`fchip ${value === s.id ? 'is-on' : ''}`} onClick={() => onChange(s.id)}>
          {s.name}
          {counts && counts[s.id] != null ? <span className="sitechips__n">{counts[s.id]}</span> : null}
        </button>
      ))}
    </div>
  );
}
