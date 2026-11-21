-- 1. Form yang dihapus / digabung (sebelum fitur form digital dipakai di produksi):
--    TMD (sudah ada Metal Catcher), Generator (sudah ada P2H Genset), Trafo mingguan & tahunan (digabung jadi form "trafo").
DELETE FROM form_records WHERE form_type_id IN (SELECT id FROM form_types WHERE code IN ('tmd', 'generator', 'trafo_weekly', 'trafo_yearly'));
DELETE FROM form_types WHERE code IN ('tmd', 'generator', 'trafo_weekly', 'trafo_yearly');
DELETE FROM settings WHERE key IN ('_seeded_form_tmd', '_seeded_form_generator', '_seeded_form_trafo_weekly', '_seeded_form_trafo_yearly');

-- 2. Hak akses form per akun. NULL = semua form. Isinya kode form: 'p2h_genset', 'p2h_lv', 'safety_device', ...
ALTER TABLE users ADD COLUMN IF NOT EXISTS form_access text[];

-- Pemberitahuan ditandai form-nya, supaya hanya sampai ke akun yang boleh membuka form itu
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS form_code text;
