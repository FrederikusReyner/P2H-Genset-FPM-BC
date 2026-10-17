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

/** Tanda tangan harus berupa gambar PNG (data URL) dan tidak terlalu besar. */
export function assertPngDataUrl(s, label = 'Tanda tangan') {
  if (typeof s !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) || s.length > 250_000) {
    throw new AppError(422, 'validation', `${label} tidak valid. Gambar ulang tanda tangan.`);
  }
}
