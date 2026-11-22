-- Grup WhatsApp tujuan per form (kosong = grup utama di Pengaturan). Nomor WhatsApp yang ditautkan sama,
-- hanya grupnya yang berbeda; nomor itu harus sudah menjadi anggota grup tersebut.
ALTER TABLE form_types ADD COLUMN IF NOT EXISTS wa_group_id text;
ALTER TABLE form_types ADD COLUMN IF NOT EXISTS wa_group_name text;

-- Periode dua mingguan (14 hari) untuk pemeriksaan panel / MCC.
ALTER TABLE form_types DROP CONSTRAINT IF EXISTS form_types_period_check;
ALTER TABLE form_types ADD CONSTRAINT form_types_period_check
  CHECK (period IN ('shift','day','week','biweek','month','quarter','half','none'));

-- Jadwal pemeriksaan sesuai daftar terbaru:
--   mingguan   : safety device, jembatan timbang, metal catcher (oil trap power house: form baru)
--   dua minggu : panel / MCC (form baru)
--   bulanan    : arus motor
--   kuartal    : tools & equipment (koneksi terminal motor: form baru)
--   semester   : grounding
UPDATE form_types SET period = 'week' WHERE code IN ('safety_device', 'weighbridge', 'metal_catcher');
UPDATE form_types SET period = 'month' WHERE code = 'ampere';
UPDATE form_types SET period = 'quarter', name = 'Inspeksi Tools & Equipment', short_name = 'Tools & Equipment',
       description = 'Inspeksi kondisi tools & equipment electric tiap kuartal.'
 WHERE code = 'tools_monthly';
UPDATE form_types SET period = 'half' WHERE code = 'grounding';
