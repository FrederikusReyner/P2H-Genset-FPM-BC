-- Grounding diperiksa per semester (bisa diganti kuartal di Kelola > Pengaturan form).
UPDATE form_types SET period = 'half' WHERE code = 'grounding' AND period = 'quarter';
