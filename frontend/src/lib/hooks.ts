import { useEffect, useState, useSyncExternalStore } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError, api, onSlow, qs } from './api';
import { loadSnapshot, saveSnapshot } from './cache';
import type { Dashboard, Finding, Meta, Notice, P2HListItem, Unit } from './types';

/** Ambil dari server; kalau tidak ada sinyal, pakai salinan terakhir yang tersimpan di HP. */
async function withSnapshot<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    saveSnapshot(key, data);
    return data;
  } catch (e) {
    if (e instanceof ApiError && e.isTemporary) {
      const snap = loadSnapshot<T>(key);
      if (snap) return snap.data;
    }
    throw e;
  }
}

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: () => withSnapshot('meta', () => api.get<Meta>('/api/meta')),
    staleTime: 5 * 60_000,
    initialData: () => loadSnapshot<Meta>('meta')?.data,
    initialDataUpdatedAt: () => loadSnapshot<Meta>('meta')?.at,
  });
}

export function useUnits() {
  return useQuery({
    queryKey: ['units'],
    queryFn: () => withSnapshot('units', () => api.get<{ items: Unit[]; shift: { shift_date: string; shift: 1 | 2 } }>('/api/units')),
    staleTime: 20_000,
    initialData: () => loadSnapshot<{ items: Unit[]; shift: { shift_date: string; shift: 1 | 2 } }>('units')?.data,
    initialDataUpdatedAt: () => loadSnapshot<unknown>('units')?.at,
  });
}

export function useDashboard(date: string | null, shift: number | null) {
  return useQuery({
    queryKey: ['dashboard', date, shift],
    queryFn: () => api.get<Dashboard>(`/api/dashboard${qs({ date, shift })}`),
    placeholderData: keepPreviousData,
    refetchInterval: () => (document.visibilityState === 'visible' ? 45_000 : false),
    staleTime: 15_000,
  });
}

export function useFindings(status: 'open' | 'closed', siteId?: number | null) {
  return useQuery({
    queryKey: ['findings', status, siteId ?? null],
    queryFn: () => api.get<{ items: Finding[] }>(`/api/findings${qs({ status, site_id: siteId })}`),
    placeholderData: keepPreviousData,
    refetchInterval: () => (document.visibilityState === 'visible' ? 60_000 : false),
  });
}

export interface HistoryFilter {
  site_id?: number | null;
  unit_id?: number | null;
  from?: string;
  to?: string;
  shift?: number | null;
  result?: string;
  q?: string;
  mine?: boolean;
  unsigned?: boolean;
  limit?: number;
  offset?: number;
}

export function useHistory(f: HistoryFilter) {
  return useQuery({
    queryKey: ['history', f],
    queryFn: () =>
      api.get<{ items: P2HListItem[]; total: number; limit: number; offset: number }>(
        `/api/p2h${qs({ ...f, mine: f.mine ? 1 : undefined, unsigned: f.unsigned ? 1 : undefined })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useNotices() {
  return useQuery({
    queryKey: ['notices'],
    queryFn: () => api.get<{ items: Notice[]; unread: number; seen_id: number }>('/api/notifications?limit=40'),
    refetchInterval: () => (document.visibilityState === 'visible' ? 30_000 : false),
    staleTime: 10_000,
  });
}

/* ---------- status jaringan ---------- */

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** true bila ada permintaan ke server yang lebih dari 3,5 detik (server gratis sedang bangun) */
export function useSlowServer() {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlow(setSlow), []);
  return slow;
}

/* ---------- pasang aplikasi (Android / Chrome) ---------- */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installListeners.forEach((l) => l());
  });
}

export function usePwaInstall() {
  const ev = useSyncExternalStore(
    (cb) => {
      installListeners.add(cb);
      return () => installListeners.delete(cb);
    },
    () => deferred,
    () => null,
  );
  return {
    canPrompt: !!ev,
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      installListeners.forEach((l) => l());
    },
  };
}
