// Notifikasi di HP (Web Push). Di iPhone hanya jalan kalau aplikasi sudah "Tambah ke Layar Utama".
import { ApiError, api } from './api';

export interface PushInfo {
  /** HP / browser ini mampu menerima notifikasi */
  supported: boolean;
  /** iPhone/iPad yang belum dipasang ke Layar Utama: harus dipasang dulu */
  needsInstall: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  serverEnabled: boolean;
}

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function b64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    // belum terdaftar (mis. mode pengembangan): tunggu sebentar saja, jangan menggantung
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
  } catch {
    return null;
  }
}

export async function getPushInfo(): Promise<PushInfo> {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const needsInstall = isIOS() && !isStandalone();
  let serverEnabled = false;
  try {
    serverEnabled = (await api.get<{ enabled: boolean }>('/api/notifications/push/public-key', { timeout: 8000 })).enabled;
  } catch {
    /* tidak terjangkau */
  }
  if (!hasApis) {
    return { supported: false, needsInstall, permission: 'unsupported', subscribed: false, serverEnabled };
  }
  let subscribed = false;
  const reg = await registration();
  if (reg) subscribed = !!(await reg.pushManager.getSubscription());
  return { supported: true, needsInstall, permission: Notification.permission, subscribed, serverEnabled };
}

/** Harus dipanggil dari tombol yang ditekan orang (aturan iPhone & Chrome). */
export async function enablePush(): Promise<void> {
  if (!('Notification' in window) || !('PushManager' in window)) throw new Error('HP ini belum mendukung notifikasi.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Izin notifikasi ditolak. Buka pengaturan HP > aplikasi ini > Notifikasi untuk mengizinkan.');
  const reg = await registration();
  if (!reg) throw new Error('Aplikasi belum siap (service worker). Tutup lalu buka aplikasi lagi.');
  const { enabled, public_key } = await api.get<{ enabled: boolean; public_key: string | null }>('/api/notifications/push/public-key');
  if (!enabled || !public_key) throw new Error('Server belum diatur untuk notifikasi (kunci VAPID belum diisi).');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(public_key) });
  }
  const j = sub.toJSON();
  await api.post('/api/notifications/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  try {
    await api.post('/api/notifications/push/unsubscribe', { endpoint: sub.endpoint });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  await sub.unsubscribe();
}

/** Pastikan server tahu HP ini (dipanggil tiap aplikasi dibuka, kalau izin sudah diberikan). */
export async function syncPush(): Promise<void> {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const j = sub.toJSON();
    await api.post('/api/notifications/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
  } catch {
    /* tidak apa-apa, coba lagi lain kali */
  }
}

export async function sendTestPush(): Promise<{ ok: boolean; reason?: string }> {
  return api.post('/api/notifications/push/test');
}
