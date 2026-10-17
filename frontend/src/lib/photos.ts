// Foto temuan: dikecilkan di HP sebelum dikirim, dan diambil dari server dengan tanda masuk.
import { createStore, del, get, set } from 'idb-keyval';
import { API_BASE, getToken } from './api';

export const MAX_PHOTOS = 3;
const TARGET_BYTES = 320_000; // sasaran ukuran satu foto setelah dikecilkan

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Foto tidak bisa dibaca. Coba ambil lagi.'));
    img.src = src;
  });

const dataUrlBytes = (u: string) => Math.round(((u.length - u.indexOf(',') - 1) * 3) / 4);

/**
 * Kecilkan foto dari kamera / galeri: sisi terpanjang paling besar 1280 px, disimpan sebagai JPEG.
 * Foto HP bisa 3-8 MB; setelah ini biasanya 100-300 KB, jadi cepat terkirim walau sinyal lemah.
 */
export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|heif)$/i.test(file.name)) throw new Error('Pilih berkas gambar (foto).');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url); // arah foto (EXIF) otomatis dipatuhi browser
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error('Foto tidak bisa dibaca. Coba ambil lagi.');
    let best = '';
    for (const [side, quality] of [[1280, 0.72], [1280, 0.6], [1024, 0.6], [800, 0.55]] as const) {
      const k = Math.min(1, side / Math.max(w0, h0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * k));
      canvas.height = Math.max(1, Math.round(h0 * k));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Browser ini tidak bisa memproses foto.');
      ctx.fillStyle = '#ffffff'; // latar putih untuk foto transparan (PNG)
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      best = canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(best) <= TARGET_BYTES) break;
    }
    return best;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- foto yang sudah ada di server ---------- */

const blobCache = new Map<number, Promise<string>>();

/** Alamat gambar (blob) untuk foto nomor `id`. Hasilnya disimpan supaya tidak diunduh berulang. */
export function photoBlobUrl(id: number): Promise<string> {
  let p = blobCache.get(id);
  if (!p) {
    p = fetch(`${API_BASE}/api/photos/${id}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } }).then(async (r) => {
      if (!r.ok) throw new Error('Foto tidak bisa dimuat.');
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => blobCache.delete(id));
    blobCache.set(id, p);
  }
  return p;
}

/** Dipanggil saat keluar akun: lepaskan foto dari memori. */
export function clearPhotoCache() {
  for (const p of blobCache.values()) void p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  blobCache.clear();
}

/* ---------- draf foto (di IndexedDB, bukan localStorage yang kecil) ---------- */

const store = createStore('p2h-genset-draft', 'photos');
const draftKey = (uid: number) => `draft.${uid}`;

export async function saveDraftPhotos(uid: number, photos: Record<number, string[]>) {
  try {
    if (Object.keys(photos).length) await set(draftKey(uid), photos, store);
    else await del(draftKey(uid), store);
  } catch {
    /* penyimpanan diblokir: foto hanya ada selama halaman terbuka */
  }
}

export async function loadDraftPhotos(uid: number): Promise<Record<number, string[]> | null> {
  try {
    return (await get<Record<number, string[]>>(draftKey(uid), store)) ?? null;
  } catch {
    return null;
  }
}

export async function clearDraftPhotos(uid: number) {
  try {
    await del(draftKey(uid), store);
  } catch {
    /* abaikan */
  }
}
