// Tanggal, jam, angka - semuanya dalam WITA (Kalimantan Timur)

export const TZ = 'Asia/Makassar';

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function witaParts(d: Date | string | number = new Date()) {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(d))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, h: Number(p.hour), m: Number(p.minute) };
}

export const todayWita = () => witaParts().date;

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 2026-09-30 -> 30/09/26 */
export function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

/** 2026-09-30 -> 30 Sep 2026 */
export function mediumDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN_PENDEK[m - 1]} ${y}`;
}

/** 2026-09-30 -> Rabu, 30 September 2026 */
export function longDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${dayName(dateStr)}, ${d} ${BULAN[m - 1]} ${y}`;
}

/** 2026-09-30 -> 30 Sep */
export function dayMonth(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN_PENDEK[m - 1]}`;
}

export function timeOf(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  return witaParts(iso).time;
}

/** "30 Sep 2026 07:12" */
export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const p = witaParts(iso);
  return `${mediumDate(p.date)} ${p.time}`;
}

/** "5 menit lalu", "2 jam lalu", "kemarin" */
export function ago(iso: string | Date | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.round(h / 24);
  if (d === 1) return 'kemarin';
  return `${d} hari lalu`;
}

/** Lama sejak/ sampai: "7 jam", "1 hari 3 jam" */
export function span(hours: number): string {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} menit`;
  if (h < 24) return `${Math.round(h)} jam`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return r ? `${d} hari ${r} jam` : `${d} hari`;
}

export const shiftLabel = (s: number | null | undefined) => (s === 1 ? 'I' : s === 2 ? 'II' : '');

/** Angka gaya Indonesia: 26630,5 (tanpa pemisah ribuan seperti di form kertas) */
export function num(v: number | null | undefined, max = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return v.toLocaleString('id-ID', { useGrouping: false, maximumFractionDigits: max });
}

/** Angka dengan pemisah ribuan: 1.250 */
export function numGroup(v: number | null | undefined, max = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return v.toLocaleString('id-ID', { maximumFractionDigits: max });
}

/** Ubah isian "12,5" / "12.5" jadi angka; kosong jadi null; salah jadi NaN */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Teks butir cek memakai **tebal** */
export function segments(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  s.split('**').forEach((part, i) => {
    if (part) out.push({ text: part, bold: i % 2 === 1 });
  });
  return out.length ? out : [{ text: '', bold: false }];
}

export const plain = (s: string) => s.replace(/\*\*/g, '');

export const unitTitle = (u: { code: string; old_code?: string | null }) => (u.old_code ? `${u.code} (${u.old_code})` : u.code);

export const modelOf = (u: { brand?: string | null; model?: string | null }) => [u.brand, u.model].filter(Boolean).join(' ');

/** Lokasi unit, tetapi kosong bila sama saja dengan nama site (supaya tidak ditulis dua kali) */
export const locationOf = (u: { site_name: string; location?: string | null }) =>
  u.location && u.location.trim().toLowerCase() !== u.site_name.trim().toLowerCase() ? u.location : '';

export function plural(n: number, one: string): string {
  return `${n} ${one}`;
}

export const ROLE_LABEL: Record<string, string> = {
  teknisi: 'Teknisi',
  pengawas: 'Pengawas',
  teknisi_pengawas: 'Teknisi & Pengawas',
  admin: 'Admin',
};

/* ---------- periode rekap: mingguan / bulanan / tahunan ---------- */

export type Period = 'week' | 'month' | 'year';
export const PERIOD_LABEL: Record<Period, string> = { week: 'Mingguan', month: 'Bulanan', year: 'Tahunan' };

/** Awal periode yang memuat tanggal `anchor` (minggu mulai Senin). */
export function periodStart(period: Period, anchor: string): string {
  const [y, m, d] = anchor.split('-').map(Number);
  if (period === 'week') {
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return addDays(anchor, -dow);
  }
  if (period === 'month') return `${y}-${String(m).padStart(2, '0')}-01`;
  return `${y}-01-01`;
}

/** Tulisan periode di layar: "12 Okt 2026 – 18 Okt 2026", "Oktober 2026", "Tahun 2026". */
export function periodText(period: Period, from: string, to: string): string {
  if (period === 'year') return `Tahun ${from.slice(0, 4)}`;
  if (period === 'month') {
    const [y, m] = from.split('-').map(Number);
    return `${BULAN[m - 1]} ${y}`;
  }
  return `${mediumDate(from)} – ${mediumDate(to)}`;
}

/** Geser satu periode ke depan (+1) atau ke belakang (-1). */
export function stepAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'week') return addDays(periodStart('week', anchor), 7 * dir);
  if (period === 'month') return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
  return `${y + dir}-01-01`;
}

export const RESULT_LABEL: Record<string, string> = {
  baik: 'Semua baik',
  temuan_a: 'Ada temuan',
  stop_aa: 'STOP OPERASI',
};

export const CONDITION_LABEL: Record<string, string> = { baik: 'Baik', rusak: 'Rusak', perbaiki: 'Perbaiki' };
export const FIX_LABEL: Record<string, string> = {
  open: 'Belum diperbaiki',
  in_progress: 'Sedang diperbaiki',
  closed: 'Selesai diperbaiki',
};
export const UNIT_STATUS_LABEL: Record<string, string> = {
  running: 'Jalan',
  standby: 'Standby',
  breakdown: 'Breakdown',
  inactive: 'Tidak aktif',
};
