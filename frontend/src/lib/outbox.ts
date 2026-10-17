// Kotak keluar: P2H yang gagal terkirim karena sinyal hilang disimpan di HP dan dikirim ulang otomatis.
import { createStore, del, get, set } from 'idb-keyval';
import { ApiError, api } from './api';
import type { P2HPayload } from './types';

const store = createStore('p2h-genset', 'outbox');
const KEY = 'queue';

export interface OutboxItem {
  uuid: string;
  payload: P2HPayload;
  label: string; // mis. "BC-GE-P-31 · Shift II · 30 Sep"
  created_at: number;
  tries: number;
  /** bila diisi: tidak bisa dikirim otomatis, butuh tindakan orang (mis. unit itu sudah di-P2H oleh orang lain) */
  blocked?: string;
}

type Listener = (items: OutboxItem[]) => void;
const listeners = new Set<Listener>();
let flushing = false;

async function read(): Promise<OutboxItem[]> {
  try {
    return (await get<OutboxItem[]>(KEY, store)) || [];
  } catch {
    return [];
  }
}
async function write(items: OutboxItem[]) {
  try {
    if (items.length) await set(KEY, items, store);
    else await del(KEY, store);
  } catch {
    /* penyimpanan diblokir: abaikan */
  }
  listeners.forEach((l) => l(items));
}

export const outboxList = read;

export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn);
  read().then(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function enqueue(item: Omit<OutboxItem, 'created_at' | 'tries'>) {
  const items = await read();
  if (items.some((i) => i.uuid === item.uuid)) return;
  items.push({ ...item, created_at: Date.now(), tries: 0 });
  await write(items);
}

export async function removeFromOutbox(uuid: string) {
  await write((await read()).filter((i) => i.uuid !== uuid));
}

/** Kirim semua yang menunggu. Berhenti begitu sinyal hilang lagi. Mengembalikan jumlah yang berhasil. */
export async function flushOutbox(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: (await read()).length };
  flushing = true;
  let sent = 0;
  try {
    let items = await read();
    for (const it of items) {
      if (it.blocked) continue;
      try {
        await api.post('/api/p2h', it.payload, { timeout: 40_000 });
        items = items.filter((x) => x.uuid !== it.uuid);
        sent += 1;
        await write(items);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.isTemporary) break; // belum ada sinyal / server belum siap: coba lagi nanti
          if (e.status === 401) break; // perlu masuk lagi dulu
          if (e.status >= 500) {
            it.tries += 1;
            if (it.tries >= 8) it.blocked = 'Server menolak berulang kali. Hubungi admin.';
            await write(items);
            break;
          }
          // 409 (sudah ada) / 422 (isian ditolak): tidak akan berhasil kalau dikirim ulang apa adanya
          it.blocked = e.message;
          await write(items);
        } else break;
      }
    }
    return { sent, left: (await read()).length };
  } finally {
    flushing = false;
  }
}
