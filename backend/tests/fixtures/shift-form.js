// Contoh form per shift untuk uji (isi P2H LV lama). Tidak ikut isi awal aplikasi: P2H LV dihapus dari aplikasi,
// tetapi mesin "form per shift" (termasuk rekap WhatsApp per site per shift) tetap diuji dengan contoh ini.
const yaTidak = { good: 'Ya', bad: 'Tidak' };
const baikRusak = { good: 'Baik', bad: 'Rusak' };
const ck = (label, text, o = {}) => ({ label, text, kind: 'check', ...o });
const ms = (label, text, unit, o = {}) => ({ label, text, kind: 'measure', unit, fields: [{ key: 'v', label: 'Hasil' }], ...o });

/* ---------- P2H LV ---------- */
const lvOperator = { severity: 'stop', ...yaTidak, needs_photo: false };
const lvCritical = { severity: 'stop', ...baikRusak };
const lvNonCritical = { severity: 'fix', ...baikRusak };

export const SHIFT_FORM = {
  code: 'p2h_lv',
  name: 'Pelaksanaan Perawatan Harian (P2H) Unit LV / Bus / Man Hauler / Light Truck',
  short_name: 'P2H LV',
  description: 'Pemeriksaan harian unit LV, bus, man hauler, dan light truck sebelum dipakai.',
  icon: 'truck',
  period: 'shift',
  subject_label: 'Unit LV',
  fix_hours: 24,
  photo_required: true,
  filler_label: 'Operator',
  verifier_label: 'Foreman / Mekanik',
  sort_order: 1,
  header_fields: [
    { key: 'job_site', label: 'Job site', type: 'text' },
    { key: 'lokasi', label: 'Lokasi kerja', type: 'text' },
    { key: 'type_alat', label: 'Type alat', type: 'text' },
    { key: 'hm_awal', label: 'HM / KM awal', type: 'number' },
    { key: 'hm_akhir', label: 'HM / KM akhir', type: 'number' },
    { key: 'sko_expired', label: 'Expired date sticker (SKO)', type: 'date' },
  ],
  sections: [
    {
      title: 'A · Operator',
      note: 'STOP bekerja jika ada jawaban "Tidak".',
      items: [
        ck('1', 'Membawa SIMPER & masih valid', lvOperator),
        { label: '1a', text: 'Expired date ID Card', kind: 'input', input_type: 'date', severity: 'note' },
        { label: '1b', text: 'Expired date SIMPER', kind: 'input', input_type: 'date', severity: 'note' },
        ck('2a', 'Fit: waktu tidur minimal 6 jam dalam 24 jam terakhir', lvOperator),
        ck('2b', 'Fit: pikiran fokus pada pekerjaan di shift ini', lvOperator),
        ck('2c', 'Fit: tidak dalam pengaruh obat', lvOperator),
        ck('2d', 'Fit: tidak ada permasalahan dengan atasan, keluarga, dan orang lain', lvOperator),
        ck('3', 'Telah memahami Golden Rules #1 & #2', lvOperator),
      ],
    },
    {
      title: 'B · Unit · item kritis',
      note: 'STOP bekerja jika ada jawaban "Rusak / Tidak normal".',
      items: [
        ck('1', 'Ban & baut roda', lvCritical),
        ck('2', 'Sabuk pengaman', lvCritical),
        ck('3', 'Sistem kemudi (steering system)', lvCritical),
        ck('4', 'Semua rem / brake', lvCritical),
        ck('5', 'Klakson', lvCritical),
        ck('6', 'Alarm mundur', lvCritical),
        ck('7', 'Radio komunikasi', lvCritical),
        ck('8', 'Spion', lvCritical),
        ck('9a', 'Accu: kebersihan accu', lvCritical),
        ck('9b', 'Accu: level air accu', lvCritical),
        ck('9c', 'Accu: penutup dan lubang breather', lvCritical),
        ck('9d', 'Accu: kepala accu', lvCritical),
        ck('9e', 'Accu: kabel rangkaian accu', lvCritical),
        ck('10', 'Tabung udara (angin)', lvCritical),
        ck('11a', 'Lampu kerja: lampu depan', lvCritical),
        ck('11b', 'Lampu kerja: lampu sign', lvCritical),
        ck('12', 'Lampu strobe / rotary', lvCritical),
        ck('13', 'Safety / traffic cone', lvCritical),
        ck('14', 'Ganjal ban', lvCritical),
        ck('15', 'APAR', lvCritical),
        ck('16', 'Buggy whip', lvCritical),
        ck('17', 'Alat keselamatan berbasis teknologi (fatigue alarm, dll.)', lvCritical),
      ],
    },
    {
      title: 'B · Unit · item non-kritis',
      note: 'Mengikuti rekomendasi mekanik bila "Rusak / Tidak normal". Wajib diperbaiki dalam 1×24 jam.',
      items: [
        ck('1', 'Fungsi control panel', lvNonCritical),
        ck('2', 'Oli (engine, steering, brake)', lvNonCritical),
        ck('3', 'Suspensi', lvNonCritical),
        ck('4', 'Hose', lvNonCritical),
        ck('5', 'Fuel meter', lvNonCritical),
        ck('6', 'Wiper & air wiper', lvNonCritical),
        ck('7', 'Air radiator', lvNonCritical),
        ck('8', 'Perlengkapan P3K', lvNonCritical),
        ck('9', 'Wheel nut indicator', lvNonCritical),
        ck('10', 'Palu pemecah kaca (khusus bus)', { ...lvNonCritical, required: false }),
      ],
    },
  ],
  subjects: [],
};

