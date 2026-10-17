-- =====================================================================
-- P2H GENSET - skema database awal (PostgreSQL)
-- Dijalankan otomatis oleh server saat pertama hidup (src/migrate.js).
-- Aman dibuka di DBeaver untuk dilihat. Jangan diubah setelah dipakai;
-- perubahan baru dibuat sebagai berkas 002_..., 003_..., dst.
-- =====================================================================

-- Site / lokasi kerja
CREATE TABLE sites (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,            -- BMO, SRN, GMO, LMO, SMO
  name       text NOT NULL,                   -- Binungan, Suaran, ...
  job_site   text,                            -- tulisan "Job Site" di form (mis. BMO 1)
  sort_order int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

-- Pengguna (akun pribadi)
CREATE TABLE users (
  id                   serial PRIMARY KEY,
  nrp                  text NOT NULL,         -- ID karyawan = nama untuk login
  name                 text NOT NULL,
  password_hash        text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('mekanik','pengawas','manajemen','admin')),
  site_id              int REFERENCES sites(id) ON DELETE SET NULL,
  job_title            text,
  phone                text,
  signature_png        text,                  -- tanda tangan tersimpan (data URL PNG)
  notif_mode           text NOT NULL DEFAULT 'all' CHECK (notif_mode IN ('all','findings')),
  notif_site_ids       int[],                 -- NULL = semua site
  notif_seen_id        bigint NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  token_version        int NOT NULL DEFAULT 0,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_nrp_key ON users (lower(nrp));

-- Unit genset
CREATE TABLE units (
  id            serial PRIMARY KEY,
  code          text NOT NULL,                -- kode registrasi baru (NEW REG. CODE)
  old_code      text,                         -- kode lama (OLD REG. CODE)
  site_id       int NOT NULL REFERENCES sites(id),
  location      text,
  job_site      text,
  brand         text,
  model         text,
  serial_no     text,
  engine_model  text,
  capacity_kva  numeric(10,1),
  rated_kw      numeric(10,1),
  rated_voltage numeric(10,1),
  rated_rpm     numeric(10,1),
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','standby','breakdown','inactive')),
  hm_master     numeric(12,2),                -- hour meter awal dari data PMMR
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX units_code_key ON units (lower(code));
CREATE INDEX units_site_idx ON units (site_id);

-- Daftar cek (sesuai form kertas)
CREATE TABLE checklist_sections (
  id         serial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  title      text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE checklist_items (
  id          serial PRIMARY KEY,
  section_id  int NOT NULL REFERENCES checklist_sections(id) ON DELETE CASCADE,
  sort_order  int NOT NULL DEFAULT 0,
  text        text NOT NULL,
  hint        text,
  danger_code text NOT NULL CHECK (danger_code IN ('AA','A')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Form P2H (1 unit x 1 tanggal x 1 shift = 1 form)
CREATE TABLE p2h_forms (
  id                bigserial PRIMARY KEY,
  client_uuid       uuid UNIQUE,              -- kode unik dari HP supaya kiriman ulang tidak dobel
  unit_id           int NOT NULL REFERENCES units(id),
  site_id           int NOT NULL REFERENCES sites(id),
  shift_date        date NOT NULL,            -- tanggal shift (WITA)
  shift             smallint NOT NULL CHECK (shift IN (1,2)),
  user_id           int NOT NULL REFERENCES users(id),
  inspector_name    text NOT NULL,
  inspector_nrp     text,
  -- salinan data unit saat form dibuat (supaya arsip tetap benar walau data unit berubah)
  unit_code         text NOT NULL,
  unit_old_code     text,
  unit_brand        text,
  unit_model        text,
  site_name         text NOT NULL,
  job_site          text,
  location          text,
  hm_start          numeric(12,2),
  hm_end            numeric(12,2),
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- parameter panel {"temp":{"idle":..,"load":..}}
  notes             text,                                  -- INFO TAMBAHAN dan TINDAK LANJUT
  signature_png     text,                                  -- tanda tangan mekanik
  result            text NOT NULL CHECK (result IN ('baik','temuan_a','stop_aa')),
  n_aa              int NOT NULL DEFAULT 0,
  n_a               int NOT NULL DEFAULT 0,
  filled_at         timestamptz,                           -- jam di HP saat tombol Kirim ditekan
  submitted_at      timestamptz NOT NULL DEFAULT now(),    -- jam server menerima
  edited_at         timestamptz,
  edited_by_name    text,
  sup_user_id       int REFERENCES users(id) ON DELETE SET NULL,
  sup_name          text,
  sup_nrp           text,
  sup_signature_png text,
  sup_signed_at     timestamptz,
  CONSTRAINT p2h_one_per_shift UNIQUE (unit_id, shift_date, shift)
);
CREATE INDEX p2h_forms_date_idx ON p2h_forms (shift_date DESC, shift DESC);
CREATE INDEX p2h_forms_site_idx ON p2h_forms (site_id, shift_date DESC);
CREATE INDEX p2h_forms_user_idx ON p2h_forms (user_id);

-- Jawaban per butir cek (disalin teksnya supaya arsip tidak berubah kalau daftar cek diedit)
CREATE TABLE p2h_answers (
  id            bigserial PRIMARY KEY,
  form_id       bigint NOT NULL REFERENCES p2h_forms(id) ON DELETE CASCADE,
  item_id       int REFERENCES checklist_items(id) ON DELETE SET NULL,
  section_code  text NOT NULL,
  section_title text NOT NULL,
  section_order int NOT NULL,
  item_no       int NOT NULL,
  item_text     text NOT NULL,
  hint          text,
  danger_code   text NOT NULL CHECK (danger_code IN ('AA','A')),
  condition     text NOT NULL CHECK (condition IN ('baik','rusak','perbaiki')),
  note          text,
  -- tindak lanjut (hanya untuk yang rusak / perlu diperbaiki)
  fix_status    text CHECK (fix_status IN ('open','in_progress','closed')),
  fix_note      text,
  fix_by        int REFERENCES users(id) ON DELETE SET NULL,
  fix_by_name   text,
  fix_at        timestamptz,
  CONSTRAINT p2h_answer_unique UNIQUE (form_id, section_code, item_no),
  CONSTRAINT p2h_fix_only_if_not_baik CHECK (
    (condition = 'baik' AND fix_status IS NULL) OR (condition <> 'baik' AND fix_status IS NOT NULL)
  )
);
CREATE INDEX p2h_answers_form_idx ON p2h_answers (form_id);
CREATE INDEX p2h_answers_open_idx ON p2h_answers (item_id) WHERE condition <> 'baik' AND fix_status <> 'closed';

-- Pemberitahuan di dalam aplikasi (lonceng)
CREATE TABLE notifications (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL,                -- p2h_ok, p2h_finding, p2h_stop, finding_closed
  severity      text NOT NULL DEFAULT 'info' CHECK (severity IN ('ok','info','warn','danger')),
  title         text NOT NULL,
  body          text NOT NULL,
  site_id       int REFERENCES sites(id) ON DELETE SET NULL,
  unit_id       int REFERENCES units(id) ON DELETE SET NULL,
  form_id       bigint REFERENCES p2h_forms(id) ON DELETE SET NULL,
  actor_user_id int REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_created_idx ON notifications (id DESC);

-- HP yang sudah mengaktifkan notifikasi (Web Push)
CREATE TABLE push_subscriptions (
  id         bigserial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz,
  fail_count int NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Pengaturan (jam shift, dll.)
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Catatan siapa mengubah apa
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    int,
  user_name  text,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
