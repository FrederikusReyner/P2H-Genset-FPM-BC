-- Rekap ringkas P2H Genset semua site, satu pesan tiap akhir shift. Tabel ini menandai shift yang sudah direkap
-- supaya tidak terkirim dua kali (juga bila server dijalankan lebih dari satu).
CREATE TABLE IF NOT EXISTS wa_shift_summaries (
  shift_date date     NOT NULL,
  shift      smallint NOT NULL CHECK (shift IN (1, 2)),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shift_date, shift)
);
