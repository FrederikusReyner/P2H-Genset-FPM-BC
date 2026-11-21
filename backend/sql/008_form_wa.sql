-- Kabar form digital ke grup WhatsApp: saklar per jenis form
ALTER TABLE form_types ADD COLUMN IF NOT EXISTS wa_findings boolean NOT NULL DEFAULT true;  -- semua temuan & temuan selesai
ALTER TABLE form_types ADD COLUMN IF NOT EXISTS wa_verify boolean NOT NULL DEFAULT true;    -- saat diverifikasi (form per shift: rekap per site per shift)

-- Rekap per site per shift (form per shift, mis. P2H LV) yang sudah dikirim, supaya tidak dobel
CREATE TABLE IF NOT EXISTS form_wa_reports (
  form_type_id int      NOT NULL REFERENCES form_types(id) ON DELETE CASCADE,
  site_id      int      NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  record_date  date     NOT NULL,
  shift        smallint NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_type_id, site_id, record_date, shift)
);
