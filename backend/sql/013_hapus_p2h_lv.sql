-- P2H LV tidak dipakai lagi: form, isian (beserta jawaban & foto), rekap WhatsApp, pemberitahuan, dan hak aksesnya dihapus.
-- Mesin "form per shift" tetap ada untuk form lain bila nanti dibutuhkan.
DELETE FROM notifications WHERE form_code = 'p2h_lv';
DELETE FROM form_wa_reports WHERE form_type_id IN (SELECT id FROM form_types WHERE code = 'p2h_lv');
DELETE FROM form_records WHERE form_type_id IN (SELECT id FROM form_types WHERE code = 'p2h_lv');
DELETE FROM form_types WHERE code = 'p2h_lv';
DELETE FROM settings WHERE key = '_seeded_form_p2h_lv';
UPDATE users SET form_access = array_remove(form_access, 'p2h_lv') WHERE 'p2h_lv' = ANY(form_access);
