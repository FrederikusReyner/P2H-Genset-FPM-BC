-- Periode pemeriksaan baru: kuartal (3 bulan) dan semester (6 bulan).
ALTER TABLE form_types DROP CONSTRAINT IF EXISTS form_types_period_check;
ALTER TABLE form_types ADD CONSTRAINT form_types_period_check
  CHECK (period IN ('shift','day','week','month','quarter','half','none'));

-- Arus motor & trafo diperiksa bulanan, grounding per kuartal (bisa diganti semester di Kelola).
UPDATE form_types SET period = 'month' WHERE code IN ('ampere', 'trafo');
UPDATE form_types SET period = 'quarter' WHERE code = 'grounding';
UPDATE form_types
   SET description = 'Pemeriksaan bulanan tegangan, beban, oli, tangki, bushing, dan kebersihan trafo, plus butir tahunan (megger, grounding, bushing).'
 WHERE code = 'trafo';
UPDATE form_sections SET note = replace(note, 'pemeriksaan mingguan', 'pemeriksaan bulanan')
 WHERE form_type_id IN (SELECT id FROM form_types WHERE code = 'trafo') AND note LIKE '%pemeriksaan mingguan%';
