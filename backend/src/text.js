// Teks butir cek memakai tanda **...** untuk bagian yang dicetak tebal di form kertas.

/** Buang tanda tebal -> teks biasa. */
export const plain = (s) => String(s ?? '').replace(/\*\*/g, '');

/** Pecah jadi potongan [{ text, bold }] untuk PDF / Word / Excel. */
export function segments(s) {
  const out = [];
  String(s ?? '')
    .split('**')
    .forEach((part, i) => {
      if (part) out.push({ text: part, bold: i % 2 === 1 });
    });
  return out.length ? out : [{ text: '', bold: false }];
}

export const CONDITION_LABEL = { baik: 'Baik', rusak: 'Rusak', perbaiki: 'Perbaiki' };
export const RESULT_LABEL = { baik: 'Semua baik', temuan_a: 'Ada temuan (A)', stop_aa: 'STOP OPERASI (AA)' };
export const FIX_LABEL = { open: 'Belum diperbaiki', in_progress: 'Sedang diperbaiki', closed: 'Selesai diperbaiki' };
export const ROLE_LABEL = { teknisi: 'Teknisi', pengawas: 'Pengawas', admin: 'Admin' };
