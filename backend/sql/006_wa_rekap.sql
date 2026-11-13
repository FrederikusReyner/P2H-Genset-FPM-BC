-- Rekap P2H per site per shift yang sudah dikirim ke grup WhatsApp (supaya tidak terkirim dua kali)
CREATE TABLE IF NOT EXISTS wa_site_reports (
  site_id    int      NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  shift_date date     NOT NULL,
  shift      smallint NOT NULL CHECK (shift IN (1,2)),
  complete   boolean  NOT NULL,             -- false = dikirim karena shift sudah lewat tetapi belum lengkap
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, shift_date, shift)
);
