-- =====================================================================
-- Revisi 2 (Oktober 2026), bagian 2: data untuk rekap Excel PMMR
--   - data unit dilengkapi (spesifikasi mesin dan alternator, pembelian, overhaul, SKO / SLO, catatan)
--   - HM awal / akhir per bulan dan kWh per bulan per unit
--   - unit di luar 25 genset produksi (daftar "Breakdown & GOH") disimpan sebagai pmmr_group = 'arsip':
--     tidak ikut P2H dan dashboard, hanya tampil di rekap Excel
-- Dijalankan otomatis oleh server. Jangan diubah setelah dipakai.
-- =====================================================================

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS made_in           text,
  ADD COLUMN IF NOT EXISTS weight_kg         numeric(10,1),
  ADD COLUMN IF NOT EXISTS engine_serial_no  text,
  ADD COLUMN IF NOT EXISTS engine_hp         numeric(10,1),
  ADD COLUMN IF NOT EXISTS engine_rpm        numeric(10,1),
  ADD COLUMN IF NOT EXISTS alt_brand         text,              -- alternator / generator
  ADD COLUMN IF NOT EXISTS alt_made_in       text,
  ADD COLUMN IF NOT EXISTS alt_type          text,              -- tipe (frame core)
  ADD COLUMN IF NOT EXISTS alt_serial_no     text,
  ADD COLUMN IF NOT EXISTS alt_phase         numeric(4,1),
  ADD COLUMN IF NOT EXISTS alt_freq          numeric(6,1),
  ADD COLUMN IF NOT EXISTS alt_base_kva      numeric(10,1),
  ADD COLUMN IF NOT EXISTS alt_base_kw       numeric(10,1),
  ADD COLUMN IF NOT EXISTS alt_voltage       numeric(10,1),
  ADD COLUMN IF NOT EXISTS alt_ampere        numeric(10,1),
  ADD COLUMN IF NOT EXISTS alt_cos_phi       numeric(4,2),
  ADD COLUMN IF NOT EXISTS alt_rpm           numeric(10,1),
  ADD COLUMN IF NOT EXISTS alt_avr           text,
  ADD COLUMN IF NOT EXISTS purchase_year     text,              -- tahun / tanggal pembelian (teks, bentuknya beragam di data PMMR)
  ADD COLUMN IF NOT EXISTS po_number         text,
  ADD COLUMN IF NOT EXISTS recommendation    text,
  ADD COLUMN IF NOT EXISTS remark            text,              -- REMARK di lembar DATA
  ADD COLUMN IF NOT EXISTS goh_total         text,              -- jumlah GOH, mis. "2" atau "3 x"
  ADD COLUMN IF NOT EXISTS goh_po_pi         text,
  ADD COLUMN IF NOT EXISTS goh_history       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{"year","location","hm"}] maks. 3
  ADD COLUMN IF NOT EXISTS issue             text,              -- ISSUE di lembar STATUS GENSET
  ADD COLUMN IF NOT EXISTS sko_expiry       date,               -- masa berlaku SKO / SLO
  ADD COLUMN IF NOT EXISTS sko_note          text,              -- mis. "Not have yet"
  ADD COLUMN IF NOT EXISTS pmmr_group        text NOT NULL DEFAULT 'produksi' CHECK (pmmr_group IN ('produksi', 'arsip')),
  ADD COLUMN IF NOT EXISTS pmmr_status       text,              -- status bebas dari PMMR untuk unit arsip (mis. "W/O WS LMO")
  ADD COLUMN IF NOT EXISTS pmmr_sort         int,
  ADD COLUMN IF NOT EXISTS bib_location      text;              -- lokasi di daftar BIB (mis. "BIB TO BIN")

-- HM awal / akhir tiap bulan (bulan lama diimpor dari Excel PMMR; bulan berjalan dihitung dari P2H)
CREATE TABLE IF NOT EXISTS unit_hm_monthly (
  unit_id  int      NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  year     smallint NOT NULL,
  month    smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  hm_start numeric(12,2),
  hm_end   numeric(12,2),
  source   text NOT NULL DEFAULT 'import',
  PRIMARY KEY (unit_id, year, month)
);

-- kWh tiap bulan (diisi admin / pengawas; dipakai lembar PH untuk rata-rata kW dan % serapan)
CREATE TABLE IF NOT EXISTS unit_kwh_monthly (
  unit_id    int      NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  year       smallint NOT NULL,
  month      smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  kwh        numeric(14,1) CHECK (kwh IS NULL OR kwh >= 0),
  updated_by int REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, year, month)
);
