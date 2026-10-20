// Penghubung ke server. Semua panggilan lewat sini.

export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/+$/, '');

const TOKEN_KEY = 'p2h.token';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** true bila masalahnya sinyal / server tidak terjangkau (bukan salah isian) */
  get isNetwork() {
    return this.status === 0;
  }
  /** masalah sementara (sinyal putus, server tidur / sedang restart): aman dicoba lagi nanti */
  get isTemporary() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504 || this.code === 'gateway';
  }
}

/* ---------- token ---------- */
let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  /* penyimpanan diblokir */
}
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* abaikan */
  }
}

/* ---------- penanda "server lambat" (server gratis Render bisa tidur) ---------- */
type SlowListener = (slow: boolean) => void;
const slowListeners = new Set<SlowListener>();
let inflight = 0;
let slowTimers = 0;
export const onSlow = (fn: SlowListener) => {
  slowListeners.add(fn);
  return () => {
    slowListeners.delete(fn);
  };
};
const emitSlow = (v: boolean) => slowListeners.forEach((f) => f(v));

/* ---------- panggilan bila sesi habis ---------- */
let unauthorizedHandler: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  unauthorizedHandler = fn;
};

interface Opts {
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  noAuthRedirect?: boolean;
}

async function once<T>(method: string, path: string, opts: Opts): Promise<T> {
  const ctrl = new AbortController();
  const timeout = opts.timeout ?? 75_000;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  inflight += 1;
  const slow = window.setTimeout(() => {
    slowTimers += 1;
    emitSlow(true);
  }, 3500);
  try {
    let res: Response;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers: {
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'network', 'Tidak ada sinyal atau server tidak terjangkau.');
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* bukan JSON */
    }
    if (!res.ok) {
      const e = json?.error;
      if (res.status === 401 && !opts.noAuthRedirect) unauthorizedHandler?.();
      // balasan bukan JSON dari server (mis. halaman error proxy) = server belum bisa dijangkau
      const code = e?.code || (json === null && res.status >= 500 ? 'gateway' : 'error');
      throw new ApiError(res.status, code, e?.message || (code === 'gateway' ? 'Server belum bisa dijangkau. Coba lagi sebentar.' : `Terjadi kesalahan (${res.status}).`), e?.details);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
    clearTimeout(slow);
    inflight -= 1;
    if (inflight <= 0) {
      inflight = 0;
      if (slowTimers > 0) emitSlow(false);
      slowTimers = 0;
    }
  }
}

async function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  // server baru bangun (503 "starting"): coba lagi beberapa kali
  for (let i = 0; ; i += 1) {
    try {
      return await once<T>(method, path, opts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503 && e.code === 'starting' && i < 8) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
}

export const api = {
  get: <T>(path: string, opts?: Opts) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: Opts) => request<T>('POST', path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: Opts) => request<T>('PUT', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: Opts) => request<T>('PATCH', path, { ...opts, body: body ?? {} }),
  del: <T>(path: string, opts?: Opts) => request<T>('DELETE', path, opts),
};

/** Bangun query string dari objek (nilai kosong dibuang). */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Bangunkan server (gratis di Render tidur bila lama tidak dipakai). */
export function wakeServer() {
  fetch(`${API_BASE}/api/health`, { cache: 'no-store' }).catch(() => undefined);
}

/**
 * Unduh file (PDF / Word / Excel): minta tiket lalu buka alamat unduhannya.
 * Cara ini jalan juga di iPhone dan aplikasi yang sudah dipasang.
 */
export async function downloadFile(body: {
  kind: 'p2h' | 'rekap' | 'pmmr';
  format: 'pdf' | 'docx' | 'xlsx';
  id?: number;
  filters?: Record<string, string | number>;
}) {
  const r = await api.post<{ path: string }>('/api/exports/ticket', body);
  const url = API_BASE + r.path;
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
