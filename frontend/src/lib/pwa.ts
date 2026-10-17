// Pendaftaran service worker + pemberitahuan "versi baru tersedia".
import { registerSW } from 'virtual:pwa-register';

let needRefresh = false;
let offlineReady = false;
const listeners = new Set<() => void>();
let update: ((reload?: boolean) => Promise<void>) | null = null;

export const swState = () => ({ needRefresh, offlineReady });
export const onSwChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((l) => l());

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
    onOfflineReady() {
      offlineReady = true;
      emit();
    },
    onRegisteredSW(_url, reg) {
      // cek versi baru tiap 30 menit selama aplikasi terbuka
      if (reg) window.setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
    },
  });
}

export function applySwUpdate() {
  void update?.(true);
}
