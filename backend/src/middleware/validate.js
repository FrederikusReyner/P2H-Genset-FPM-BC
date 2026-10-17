import { z } from 'zod';
import { AppError } from '../errors.js';

// Pesan kesalahan isian dalam Bahasa Indonesia sederhana
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'wajib diisi' };
      return { message: 'isinya tidak sesuai' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'wajib diisi' : `terlalu pendek (minimal ${issue.minimum} karakter)` };
      if (issue.type === 'array') return { message: `minimal ${issue.minimum} isian` };
      return { message: `terlalu kecil (minimal ${issue.minimum})` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `terlalu panjang (maksimal ${issue.maximum} karakter)` };
      return { message: `terlalu besar (maksimal ${issue.maximum})` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `pilihan tidak dikenal (${issue.options.join(', ')})` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'uuid') return { message: 'kode tidak valid' };
      if (issue.validation === 'regex') return { message: 'format tidak sesuai' };
      return { message: 'format tidak sesuai' };
    default:
      return { message: ctx.defaultError };
  }
});

/** Cek isian dengan zod; bila salah, lempar error 422 dengan pesan yang jelas. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first.path.length ? first.path.join('.') : '';
  throw new AppError(422, 'validation', where ? `${where}: ${first.message}` : first.message, {
    fields: r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

/** Angka dari HP: boleh angka, teks "12,5", atau kosong (jadi null). */
export const numOrNull = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string') return parseFloat(v.replace(',', '.'));
    return v;
  },
  z.number().finite().nullable(),
);

export const idParam = (req, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, 'bad_id', 'Nomor tidak valid.');
  return n;
};

export const MAX_PHOTO_BYTES = 1_200_000; // HP mengecilkan foto ke sekitar 100-300 KB; ini batas longgar
export const MAX_PHOTOS_PER_ITEM = 3;

/**
 * Foto temuan: data URL JPEG / PNG. Dicek isi aslinya (bukan hanya tulisan di depan)
 * supaya berkas lain tidak bisa diselundupkan. Mengembalikan { mime, buffer }.
 */
export function decodePhoto(s, label = 'Foto') {
  const m = typeof s === 'string' ? /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(s) : null;
  if (!m) throw new AppError(422, 'validation', `${label} tidak valid. Pakai foto JPEG atau PNG.`);
  const buffer = Buffer.from(m[2], 'base64');
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const ok = (m[1] === 'jpeg' && isJpeg) || (m[1] === 'png' && isPng);
  if (!ok) throw new AppError(422, 'validation', `${label} rusak atau bukan gambar. Ambil fotonya lagi.`);
  if (buffer.length > MAX_PHOTO_BYTES) throw new AppError(422, 'validation', `${label} terlalu besar (maksimal ${Math.round(MAX_PHOTO_BYTES / 1000)} KB). Ambil ulang dengan ukuran lebih kecil.`);
  return { mime: `image/${m[1]}`, buffer };
}

/** Tanda tangan harus berupa gambar PNG (data URL) dan tidak terlalu besar. */
export function assertPngDataUrl(s, label = 'Tanda tangan') {
  if (typeof s !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) || s.length > 250_000) {
    throw new AppError(422, 'validation', `${label} tidak valid. Gambar ulang tanda tangan.`);
  }
}
