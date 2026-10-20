-- =====================================================================
-- Revisi 2 (Oktober 2026), bagian 1: peran "Teknisi & Pengawas"
--   Satu orang bisa mengisi P2H sekaligus memverifikasi P2H orang lain di site-nya.
--   (Tidak boleh memverifikasi P2H yang ia isi sendiri.)
-- Dijalankan otomatis oleh server. Jangan diubah setelah dipakai.
-- =====================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('teknisi', 'pengawas', 'teknisi_pengawas', 'admin'));
