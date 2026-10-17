import { config } from './config.js';

// Semua hitungan tanggal & shift memakai WITA (Asia/Makassar), bukan jam server.
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.tz,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Tanggal & jam WITA dari sebuah waktu. */
export function wita(d = new Date()) {
  const p = {};
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  const H = Number(p.hour);
  const M = Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, H, M, minutes: H * 60 + M, time: `${p.hour}:${p.minute}` };
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const hhmmToMinutes = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Shift 1 = mulai s1 sampai sebelum s2 (hari itu).
 * Shift 2 = mulai s2 sampai sebelum s1 besok. Lewat tengah malam tetap dihitung tanggal kemarin.
 */
export function currentShift(now = new Date(), s1 = '06:00', s2 = '18:00') {
  const t = wita(now);
  const a = hhmmToMinutes(s1);
  const b = hhmmToMinutes(s2);
  if (t.minutes >= a && t.minutes < b) return { shift_date: t.date, shift: 1 };
  if (t.minutes >= b) return { shift_date: t.date, shift: 2 };
  return { shift_date: addDays(t.date, -1), shift: 2 };
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function dayNameID(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 2026-09-30 -> 30/09/26 (seperti tulisan tangan di form) */
export function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

/** 2026-09-30 -> 30 September 2026 */
export function longDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/** Waktu (Date / ISO) -> "30/09/2026 07:12 WITA" */
export function stampWITA(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  const t = wita(d);
  const [y, m, dd] = t.date.split('-');
  return `${dd}/${m}/${y} ${t.time} WITA`;
}

export const shiftLabel = (s) => (Number(s) === 1 ? 'I' : 'II');
