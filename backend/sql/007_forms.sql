-- Form digital serbaguna (P2H LV, inspeksi tools, arus motor, safety device, metal catcher, generator, ...).
-- P2H Genset tetap memakai tabel p2h_* sendiri; tabel di bawah untuk form lainnya.

-- Jenis form (template)
CREATE TABLE form_types (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,                  -- p2h_lv, tools_monthly, ...
  name           text NOT NULL,                         -- judul lengkap form
  short_name     text NOT NULL,                         -- nama di menu
  description    text,
  icon           text NOT NULL DEFAULT 'list',
  period         text NOT NULL DEFAULT 'none' CHECK (period IN ('shift','day','week','month','none')),
  subject_label  text NOT NULL DEFAULT 'Unit',          -- sebutan objek yang diperiksa (Unit LV, Conveyor, ...)
  header_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,    -- isian kepala form: [{key,label,type,options,unit,placeholder}]
  fix_hours      int NOT NULL DEFAULT 24,               -- tenggat perbaikan temuan biasa
  photo_required boolean NOT NULL DEFAULT true,         -- butir tidak baik wajib foto
  filler_label   text NOT NULL DEFAULT 'Pelaksana',
  verifier_label text NOT NULL DEFAULT 'Pengawas',
  doc_no         text,                                  -- nomor dokumen form kertas
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Objek yang diperiksa: unit LV, area tools, lokasi, conveyor, generator, ...
CREATE TABLE form_subjects (
  id           serial PRIMARY KEY,
  form_type_id int NOT NULL REFERENCES form_types(id) ON DELETE CASCADE,
  site_id      int NOT NULL REFERENCES sites(id),
  name         text NOT NULL,                           -- mis. LV-012, CV-11, Electric Suaran (ESUA)
  detail       text,                                    -- mis. merek / tipe / lokasi
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_subjects_type_idx ON form_subjects (form_type_id, site_id);
CREATE UNIQUE INDEX form_subjects_name_key ON form_subjects (form_type_id, site_id, lower(name));

-- Bagian daftar cek. subject_id NULL = berlaku untuk semua objek jenis form itu.
CREATE TABLE form_sections (
  id           serial PRIMARY KEY,
  form_type_id int NOT NULL REFERENCES form_types(id) ON DELETE CASCADE,
  subject_id   int REFERENCES form_subjects(id) ON DELETE CASCADE,
  title        text NOT NULL,
  note         text,                                    -- mis. "STOP bekerja jika ada jawaban Tidak"
  sort_order   int NOT NULL DEFAULT 0
);
CREATE INDEX form_sections_type_idx ON form_sections (form_type_id);

-- Butir cek
--  kind 'check'  : pilihan baik / tidak (label bebas: Baik-Rusak, Ya-Tidak, Fungsi-Tidak, Ketarik-Tidak)
--  kind 'measure': angka ukur, satu atau beberapa kolom (mis. R S T kosongan & muatan), dengan batas min / maks
--  kind 'input'  : isian teks / tanggal / angka tanpa penilaian (mis. expired SIMPER)
--  severity      : stop = unit harus berhenti, fix = perbaiki dalam fix_hours, note = dicatat saja
CREATE TABLE form_items (
  id           serial PRIMARY KEY,
  form_type_id int NOT NULL REFERENCES form_types(id) ON DELETE CASCADE,
  section_id   int NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
  sort_order   int NOT NULL DEFAULT 0,
  label        text,                                    -- nomor tampilan (1, 2, a, b, ...)
  text         text NOT NULL,
  spec         text,                                    -- keterangan tambahan (model, merek, jumlah, KW, ...)
  kind         text NOT NULL DEFAULT 'check' CHECK (kind IN ('check','measure','input')),
  severity     text NOT NULL DEFAULT 'fix' CHECK (severity IN ('stop','fix','note')),
  good_label   text NOT NULL DEFAULT 'Baik',
  bad_label    text NOT NULL DEFAULT 'Rusak',
  input_type   text NOT NULL DEFAULT 'text' CHECK (input_type IN ('text','date','number')),
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,      -- kolom ukur: [{key,label}]
  unit         text,                                    -- satuan ukur (A, MOhm, Ohm, ...)
  min_value    numeric(14,4),
  max_value    numeric(14,4),
  required     boolean NOT NULL DEFAULT true,           -- false = boleh dilewati (mis. "khusus Bus")
  needs_photo  boolean NOT NULL DEFAULT true,           -- bila tidak baik: wajib foto
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_items_section_idx ON form_items (section_id);

-- Satu form yang diisi
CREATE TABLE form_records (
  id                bigserial PRIMARY KEY,
  client_uuid       uuid UNIQUE,
  form_type_id      int NOT NULL REFERENCES form_types(id),
  subject_id        int NOT NULL REFERENCES form_subjects(id),
  site_id           int NOT NULL REFERENCES sites(id),
  record_date       date NOT NULL,
  shift             smallint NOT NULL DEFAULT 0 CHECK (shift IN (0,1,2)),   -- 0 = tidak per shift
  user_id           int NOT NULL REFERENCES users(id),
  filler_name       text NOT NULL,
  filler_nrp        text,
  subject_name      text NOT NULL,                      -- salinan saat diisi
  subject_detail    text,
  site_name         text NOT NULL,
  header            jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes             text,
  signature_png     text,
  result            text NOT NULL CHECK (result IN ('ok','finding','stop')),
  n_stop            int NOT NULL DEFAULT 0,
  n_fix             int NOT NULL DEFAULT 0,
  filled_at         timestamptz,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  edited_by_name    text,
  sup_user_id       int REFERENCES users(id) ON DELETE SET NULL,
  sup_name          text,
  sup_nrp           text,
  sup_signature_png text,
  sup_note          text,
  sup_signed_at     timestamptz,
  CONSTRAINT form_one_per_period UNIQUE (form_type_id, subject_id, record_date, shift)
);
CREATE INDEX form_records_type_idx ON form_records (form_type_id, record_date DESC);
CREATE INDEX form_records_site_idx ON form_records (site_id, record_date DESC);

-- Jawaban per butir (teks butir disalin supaya arsip tidak berubah kalau daftar cek diedit)
CREATE TABLE form_answers (
  id            bigserial PRIMARY KEY,
  record_id     bigint NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  item_id       int REFERENCES form_items(id) ON DELETE SET NULL,
  section_title text NOT NULL,
  section_order int NOT NULL DEFAULT 0,
  item_order    int NOT NULL DEFAULT 0,
  item_label    text,
  item_text     text NOT NULL,
  item_spec     text,
  kind          text NOT NULL,
  severity      text NOT NULL,
  good_label    text,
  bad_label     text,
  unit          text,
  min_value     numeric(14,4),
  max_value     numeric(14,4),
  condition     text CHECK (condition IN ('good','bad')),
  values        jsonb,                                  -- angka ukur {R: 12.3, ...} atau {value: '2027-01-01'}
  note          text,
  is_finding    boolean NOT NULL DEFAULT false,
  fix_status    text CHECK (fix_status IN ('open','in_progress','closed')),
  fix_plan_date date,                                   -- rencana penyelesaian
  fix_note      text,
  fix_by        int REFERENCES users(id) ON DELETE SET NULL,
  fix_by_name   text,
  fix_at        timestamptz,
  CONSTRAINT form_fix_only_if_finding CHECK ((is_finding AND fix_status IS NOT NULL) OR (NOT is_finding AND fix_status IS NULL))
);
CREATE INDEX form_answers_record_idx ON form_answers (record_id);
CREATE INDEX form_answers_open_idx ON form_answers (record_id) WHERE is_finding AND fix_status <> 'closed';

CREATE TABLE form_photos (
  id         bigserial PRIMARY KEY,
  answer_id  bigint NOT NULL REFERENCES form_answers(id) ON DELETE CASCADE,
  record_id  bigint NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  size       int NOT NULL,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_photos_answer_idx ON form_photos (answer_id);

-- Pemberitahuan dari form lain membawa alamat halamannya sendiri
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS path text;
