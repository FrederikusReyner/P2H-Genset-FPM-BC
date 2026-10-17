import { safeDel, safeGet, safeSet } from './cache';

export type ThemePref = 'auto' | 'light' | 'dark';
const KEY = 'p2h.theme';

export function getThemePref(): ThemePref {
  const v = safeGet(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

function systemDark() {
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'auto' && systemDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function setThemePref(pref: ThemePref) {
  if (pref === 'auto') safeDel(KEY);
  else safeSet(KEY, pref);
  applyTheme(pref);
}

/** Ikuti perubahan pengaturan HP bila pilihan = otomatis */
export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => undefined;
  const fn = () => {
    if (getThemePref() === 'auto') applyTheme('auto');
  };
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
