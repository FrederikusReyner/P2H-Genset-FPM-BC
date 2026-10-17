/// <reference lib="webworker" />
// Service worker: aplikasi tetap terbuka tanpa sinyal + menampilkan notifikasi P2H.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// semua alamat halaman memakai index.html (aplikasi satu halaman), kecuali panggilan /api
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

clientsClaim();

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface PushPayload {
  id?: number;
  kind?: string;
  severity?: 'ok' | 'info' | 'warn' | 'danger';
  title?: string;
  body?: string;
  path?: string;
  url?: string;
  tag?: string;
  ts?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    data = { title: 'P2H Genset', body: event.data ? event.data.text() : '' };
  }
  const danger = data.severity === 'danger';
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[]; timestamp?: number } = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: danger,
    vibrate: danger ? [220, 120, 220, 120, 420] : [140],
    timestamp: data.ts ? Date.parse(data.ts) || Date.now() : Date.now(),
    lang: 'id',
    data: { path: data.path || '/' },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'P2H Genset', options);
      // beri tahu jendela yang sedang terbuka supaya daftar & angka langsung diperbarui
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: 'push', payload: data });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path: string = (event.notification.data && event.notification.data.path) || '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) {
          await w.focus();
          w.postMessage({ type: 'navigate', path });
          return;
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});
