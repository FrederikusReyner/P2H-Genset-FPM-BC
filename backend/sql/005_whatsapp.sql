-- Kabar temuan ke grup WhatsApp lewat gateway sendiri (tanpa layanan pihak ketiga).
-- Tabel ini menyimpan sesi WhatsApp nomor pengirim: kunci tautan perangkat dan kunci enkripsi pesan.
-- Isi kolom value dienkripsi (AES-256-GCM) dengan kunci turunan dari JWT_SECRET,
-- jadi tidak terbaca lewat DBeaver dan tidak bisa dipakai tanpa JWT_SECRET server.
CREATE TABLE IF NOT EXISTS wa_auth (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
