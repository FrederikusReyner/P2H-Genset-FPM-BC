-- =====================================================================
-- Revisi 1 (Oktober 2026)
--   - Peran jadi tiga: teknisi, pengawas, admin (dulu: mekanik, pengawas, manajemen, admin)
--   - Akun punya kolom Perusahaan; "ID karyawan" kini disebut No SID (kolom tetap bernama nrp)
--   - Foto temuan: wajib untuk butir yang rusak / perlu diperbaiki
--   - P2H menyimpan perusahaan pengisi dan pengawas (untuk dicetak di PDF / Word / Excel)
-- Dijalankan otomatis oleh server. Jangan diubah setelah dipakai.
-- =====================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'teknisi' WHERE role = 'mekanik';
UPDATE users SET role = 'pengawas' WHERE role = 'manajemen';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('teknisi', 'pengawas', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS company text;

ALTER TABLE p2h_forms ADD COLUMN IF NOT EXISTS inspector_company text;
ALTER TABLE p2h_forms ADD COLUMN IF NOT EXISTS sup_company text;

-- Foto temuan (disimpan di database supaya ikut dicadangkan; sudah dikecilkan di HP)
CREATE TABLE IF NOT EXISTS p2h_photos (
  id         bigserial PRIMARY KEY,
  answer_id  bigint NOT NULL REFERENCES p2h_answers(id) ON DELETE CASCADE,
  form_id    bigint NOT NULL REFERENCES p2h_forms(id) ON DELETE CASCADE,
  mime       text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  data       bytea NOT NULL,
  size       int NOT NULL,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS p2h_photos_answer_idx ON p2h_photos (answer_id);
CREATE INDEX IF NOT EXISTS p2h_photos_form_idx ON p2h_photos (form_id);
