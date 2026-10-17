import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api, getToken, setToken, setUnauthorizedHandler } from './api';
import { clearSnapshots, safeDel, safeGet, safeSet } from './cache';
import { clearPhotoCache } from './photos';
import type { Role, User } from './types';

interface AuthCtx {
  user: User | null;
  /** true selama aplikasi masih memeriksa sesi tersimpan */
  loading: boolean;
  /** true bila memakai data tersimpan karena tidak ada sinyal */
  offline: boolean;
  login: (nrp: string, password: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
const USER_KEY = 'p2h.user';

function readUser(): User | null {
  const raw = safeGet(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUserState] = useState<User | null>(() => (getToken() ? readUser() : null));
  const [loading, setLoading] = useState<boolean>(() => !!getToken());
  const [offline, setOffline] = useState(false);
  const started = useRef(false);

  const setUser = useCallback((u: User) => {
    setUserState(u);
    // tanda tangan tidak perlu disalin ke penyimpanan HP; diambil lagi dari server saat dibutuhkan
    safeSet(USER_KEY, JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    safeDel(USER_KEY);
    clearSnapshots();
    clearPhotoCache();
    setUserState(null);
    setOffline(false);
    qc.clear();
  }, [qc]);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User }>('/api/auth/me', { noAuthRedirect: true });
      setUser(r.user);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
      } else if (e instanceof ApiError && e.isTemporary) {
        setOffline(true); // pakai data tersimpan
      }
    }
  }, [logout, setUser]);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (nrp: string, password: string) => {
      const r = await api.post<{ token: string; user: User }>('/api/auth/login', { nrp, password }, { noAuthRedirect: true });
      setToken(r.token);
      setUser(r.user);
      setOffline(false);
      return r.user;
    },
    [setUser],
  );

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      offline,
      login,
      logout,
      refresh,
      setUser,
      can: (...roles: Role[]) => !!user && roles.includes(user.role),
    }),
    [user, loading, offline, login, logout, refresh, setUser],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth harus di dalam AuthProvider');
  return c;
}

export const CAN_FILL: Role[] = ['teknisi', 'admin']; // mengisi P2H
export const CAN_SIGN: Role[] = ['pengawas', 'admin']; // memverifikasi (tanda tangan pengawas)
export const CAN_FIX: Role[] = ['teknisi', 'pengawas', 'admin']; // tindak lanjut temuan

/** Teknisi dan pengawas hanya melihat site-nya sendiri; admin melihat semua site. */
export const seesAllSites = (u: { role: Role } | null | undefined) => u?.role === 'admin';
