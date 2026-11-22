-- Kalibrasi Belt Scale tidak dipakai lagi: form, isian (beserta jawaban & foto), pemberitahuan, dan hak aksesnya dihapus.
DELETE FROM notifications WHERE form_code = 'belt_scale';
DELETE FROM form_wa_reports WHERE form_type_id IN (SELECT id FROM form_types WHERE code = 'belt_scale');
DELETE FROM form_records WHERE form_type_id IN (SELECT id FROM form_types WHERE code = 'belt_scale');
DELETE FROM form_types WHERE code = 'belt_scale';
DELETE FROM settings WHERE key = '_seeded_form_belt_scale';
UPDATE users SET form_access = array_remove(form_access, 'belt_scale') WHERE 'belt_scale' = ANY(form_access);
