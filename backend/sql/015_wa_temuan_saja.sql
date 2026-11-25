-- Grup WhatsApp hanya menerima temuan (A / AA, STOP / perbaiki) dan perbaikannya, supaya tidak terlalu ramai:
--  - P2H Genset: rekap per site per shift tidak dikirim lagi (tabel penandanya tidak dipakai).
--  - Form digital: kabar verifikasi (dan rekap per shift) dimatikan; admin masih bisa menyalakannya per form di Kelola.
DROP TABLE IF EXISTS wa_site_reports;
ALTER TABLE form_types ALTER COLUMN wa_verify SET DEFAULT false;
UPDATE form_types SET wa_verify = false;
