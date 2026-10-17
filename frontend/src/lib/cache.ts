// Salinan data terakhir di HP, supaya form tetap bisa dibuka saat sinyal hilang.

const PREFIX = 'p2h.snap.';

export function saveSnapshot(key: string, data: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* penyimpanan penuh / diblokir */
  }
}

export function loadSnapshot<T>(key: string): { at: number; data: T } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as { at: number; data: T }) : null;
  } catch {
    return null;
  }
}

export function clearSnapshots() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* abaikan */
  }
}

export const safeGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* abaikan */
  }
};
export const safeDel = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* abaikan */
  }
};
