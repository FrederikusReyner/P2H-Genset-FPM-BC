-- =====================================================================
-- P2H GENSET - kumpulan query untuk DBeaver (HANYA MEMBACA, tidak mengubah data)
--
-- Cara pakai:
--   1. Sambungkan DBeaver ke database (lihat Panduan Deploy, Langkah 10).
--   2. Klik kanan database "p2h" > SQL Editor > Open SQL script, atau buka berkas ini:
--      menu File > Open File...
--   3. Klik di dalam SATU query, lalu tekan Ctrl+Enter. Hasilnya muncul di bawah.
--      (Jangan tekan Alt+X: itu menjalankan SEMUA query sekaligus dan membuka banyak tab.)
--   4. Hasil bisa disalin ke Excel: klik kanan hasil > Advanced Copy, atau Export data.
--
-- Catatan:
--   - Semua jam ditampilkan dalam WITA.
--   - Query "shift sekarang" memakai jam shift standar: Shift I 06:00-18:00, Shift II 18:00-06:00.
--     Kalau jam shift diubah di menu Pengaturan aplikasi, ganti angka 6 dan 18 di query itu.
--   - Jangan menjalankan perintah UPDATE / DELETE di DBeaver kecuali Anda yakin.
--     Untuk mengubah data, pakai aplikasinya.
--   - Kolom "password_hash" di tabel users sengaja TIDAK ditampilkan. Jangan dibuka atau disalin.
-- =====================================================================


-- 1. SHIFT SEKARANG: berapa genset yang sudah / belum P2H, per site
WITH w AS (
  SELECT now() AT TIME ZONE 'Asia/Makassar' AS t
), cur AS (
  SELECT (t - interval '6 hours')::date AS tgl,
         CASE WHEN extract(hour FROM t) >= 6 AND extract(hour FROM t) < 18 THEN 1 ELSE 2 END AS shift
    FROM w
)
SELECT s.name AS "Site",
       count(u.id) AS "Genset wajib P2H",
       count(f.id) AS "Sudah P2H",
       count(u.id) - count(f.id) AS "Belum P2H",
       count(*) FILTER (WHERE f.result = 'baik') AS "Baik",
       count(*) FILTER (WHERE f.result = 'temuan_a') AS "Temuan A",
       count(*) FILTER (WHERE f.result = 'stop_aa') AS "STOP (AA)"
  FROM sites s
 CROSS JOIN cur
  JOIN units u ON u.site_id = s.id AND u.status IN ('running', 'standby')
  LEFT JOIN p2h_forms f ON f.unit_id = u.id AND f.shift_date = cur.tgl AND f.shift = cur.shift
 GROUP BY s.id, s.name, s.sort_order
 ORDER BY s.sort_order;


-- 2. SHIFT SEKARANG: genset yang BELUM di-P2H (siapa yang perlu diingatkan)
WITH w AS (
  SELECT now() AT TIME ZONE 'Asia/Makassar' AS t
), cur AS (
  SELECT (t - interval '6 hours')::date AS tgl,
         CASE WHEN extract(hour FROM t) >= 6 AND extract(hour FROM t) < 18 THEN 1 ELSE 2 END AS shift
    FROM w
)
SELECT s.name AS "Site",
       u.code AS "Kode unit",
       trim(coalesce(u.brand, '') || ' ' || coalesce(u.model, '')) AS "Merek / model",
       u.location AS "Lokasi",
       CASE u.status WHEN 'running' THEN 'Jalan' ELSE 'Standby' END AS "Status unit"
  FROM units u
  JOIN sites s ON s.id = u.site_id
 CROSS JOIN cur
  LEFT JOIN p2h_forms f ON f.unit_id = u.id AND f.shift_date = cur.tgl AND f.shift = cur.shift
 WHERE u.status IN ('running', 'standby') AND f.id IS NULL
 ORDER BY s.sort_order, u.code;


-- 3. TEMUAN YANG MASIH TERBUKA (rusak / perlu diperbaiki, belum ditutup). AA = STOP OPERASI.
SELECT *
  FROM (
    SELECT DISTINCT ON (b.unit_id, b.item_key)
           b.site_name AS "Site",
           b.unit_code AS "Unit",
           b.danger_code AS "Kode",
           replace(b.item_text, '**', '') AS "Butir",
           CASE b.condition WHEN 'rusak' THEN 'Rusak' ELSE 'Perbaiki' END AS "Kondisi",
           b.note AS "Catatan mekanik",
           count(*) OVER w AS "Dilaporkan (kali)",
           to_char(min(b.seen_at) OVER w AT TIME ZONE 'Asia/Makassar', 'DD-MM-YYYY HH24:MI') AS "Pertama dilaporkan",
           round(extract(epoch FROM now() - min(b.seen_at) OVER w) / 3600) AS "Sudah terbuka (jam)",
           CASE WHEN bool_or(b.fix_status = 'in_progress') OVER w THEN 'Sedang diperbaiki' ELSE 'Terbuka' END AS "Status"
      FROM (
        SELECT a.id, f.unit_id, f.unit_code, f.site_name, f.shift_date, f.shift,
               a.danger_code, a.item_text, a.condition, a.note, a.fix_status,
               COALESCE(a.item_id::text, a.section_code || ':' || a.item_no::text) AS item_key,
               COALESCE(f.filled_at, f.submitted_at) AS seen_at
          FROM p2h_answers a
          JOIN p2h_forms f ON f.id = a.form_id
         WHERE a.condition <> 'baik' AND a.fix_status <> 'closed'
      ) b
    WINDOW w AS (PARTITION BY b.unit_id, b.item_key)
     ORDER BY b.unit_id, b.item_key, b.shift_date DESC, b.shift DESC, b.id DESC
  ) x
 ORDER BY ("Kode" = 'AA') DESC, "Sudah terbuka (jam)" DESC;


-- 4. 50 P2H TERBARU
SELECT f.shift_date AS "Tanggal",
       CASE f.shift WHEN 1 THEN 'I' ELSE 'II' END AS "Shift",
       f.site_name AS "Site",
       f.unit_code AS "Unit",
       f.inspector_name AS "Teknisi",
       f.inspector_company AS "Perusahaan",
       CASE f.result WHEN 'baik' THEN 'Baik' WHEN 'temuan_a' THEN 'Temuan A' ELSE 'STOP (AA)' END AS "Hasil",
       f.n_aa AS "Temuan AA",
       f.n_a AS "Temuan A",
       (SELECT count(*) FROM p2h_photos ph WHERE ph.form_id = f.id) AS "Jumlah foto",
       CASE WHEN f.sup_signed_at IS NULL THEN 'Menunggu verifikasi' ELSE 'Terverifikasi: ' || f.sup_name END AS "Status verifikasi",
       to_char(COALESCE(f.filled_at, f.submitted_at) AT TIME ZONE 'Asia/Makassar', 'DD-MM-YYYY HH24:MI') AS "Waktu isi (WITA)"
  FROM p2h_forms f
 ORDER BY f.shift_date DESC, f.shift DESC, f.id DESC
 LIMIT 50;


-- 5. REKAP PER BULAN PER SITE
SELECT to_char(f.shift_date, 'YYYY-MM') AS "Bulan",
       s.name AS "Site",
       count(*) AS "Jumlah P2H",
       count(*) FILTER (WHERE f.result = 'baik') AS "Baik",
       count(*) FILTER (WHERE f.result = 'temuan_a') AS "Temuan A",
       count(*) FILTER (WHERE f.result = 'stop_aa') AS "STOP (AA)",
       round(100.0 * count(*) FILTER (WHERE f.result = 'baik') / count(*), 1) AS "% baik"
  FROM p2h_forms f
  JOIN sites s ON s.id = f.site_id
 GROUP BY to_char(f.shift_date, 'YYYY-MM'), s.name, s.sort_order
 ORDER BY 1 DESC, s.sort_order;


-- 6. KEPATUHAN P2H PER GENSET, 30 HARI TERAKHIR (seharusnya 60 kali = 2 shift x 30 hari)
SELECT s.name AS "Site",
       u.code AS "Unit",
       count(f.id) AS "P2H masuk",
       60 AS "Seharusnya",
       round(100.0 * count(f.id) / 60) AS "% patuh"
  FROM units u
  JOIN sites s ON s.id = u.site_id
  LEFT JOIN p2h_forms f ON f.unit_id = u.id
                       AND f.shift_date > (now() AT TIME ZONE 'Asia/Makassar')::date - 30
 WHERE u.status IN ('running', 'standby')
 GROUP BY s.sort_order, s.name, u.code
 ORDER BY s.sort_order, u.code;


-- 7. BUTIR YANG PALING SERING RUSAK, 30 HARI TERAKHIR
SELECT replace(a.item_text, '**', '') AS "Butir",
       a.danger_code AS "Kode",
       count(*) AS "Berapa kali",
       count(DISTINCT f.unit_id) AS "Berapa genset"
  FROM p2h_answers a
  JOIN p2h_forms f ON f.id = a.form_id
 WHERE a.condition <> 'baik'
   AND f.shift_date > (now() AT TIME ZONE 'Asia/Makassar')::date - 30
 GROUP BY 1, 2
 ORDER BY 3 DESC, 1
 LIMIT 15;


-- 8. P2H LAMA YANG BELUM DIVERIFIKASI PENGAWAS (belum berstatus Terverifikasi)
SELECT f.shift_date AS "Tanggal",
       CASE f.shift WHEN 1 THEN 'I' ELSE 'II' END AS "Shift",
       f.site_name AS "Site",
       f.unit_code AS "Unit",
       f.inspector_name AS "Teknisi",
       CASE f.result WHEN 'baik' THEN 'Baik' WHEN 'temuan_a' THEN 'Temuan A' ELSE 'STOP (AA)' END AS "Hasil"
  FROM p2h_forms f
 WHERE f.sup_signed_at IS NULL
   AND f.shift_date < (now() AT TIME ZONE 'Asia/Makassar')::date
 ORDER BY f.shift_date DESC, f.shift DESC, f.site_name, f.unit_code
 LIMIT 200;


-- 9. DAFTAR PENGGUNA (tanpa password)
SELECT u.nrp AS "No SID",
       u.name AS "Nama",
       u.company AS "Perusahaan",
       u.job_title AS "Jabatan",
       u.role AS "Peran",
       s.name AS "Site",
       CASE WHEN u.is_active THEN 'Aktif' ELSE 'Nonaktif' END AS "Status",
       to_char(u.last_login_at AT TIME ZONE 'Asia/Makassar', 'DD-MM-YYYY HH24:MI') AS "Terakhir masuk",
       (SELECT count(*) FROM push_subscriptions p WHERE p.user_id = u.id) AS "HP dengan notifikasi",
       CASE WHEN u.must_change_password THEN 'Ya' ELSE '' END AS "Belum ganti password awal"
  FROM users u
  LEFT JOIN sites s ON s.id = u.site_id
 ORDER BY u.is_active DESC, u.role, u.name;


-- 10. CATATAN AKTIVITAS: siapa mengubah apa (100 terakhir)
SELECT to_char(created_at AT TIME ZONE 'Asia/Makassar', 'DD-MM-YYYY HH24:MI') AS "Waktu (WITA)",
       user_name AS "Siapa",
       action AS "Apa",
       entity AS "Objek",
       entity_id AS "No.",
       detail AS "Rincian"
  FROM audit_log
 ORDER BY id DESC
 LIMIT 100;


-- 11. HP YANG TERDAFTAR UNTUK NOTIFIKASI (fail_count tinggi = HP tidak terjangkau lagi)
SELECT u.nrp AS "No SID",
       u.name AS "Nama",
       left(coalesce(p.user_agent, ''), 60) AS "Jenis HP / browser",
       to_char(p.created_at AT TIME ZONE 'Asia/Makassar', 'DD-MM-YYYY HH24:MI') AS "Didaftarkan",
       to_char(p.last_ok_at AT TIME ZONE 'Asia/Makassar', 'DD-MM-YYYY HH24:MI') AS "Terakhir berhasil",
       p.fail_count AS "Gagal berturut-turut"
  FROM push_subscriptions p
  JOIN users u ON u.id = p.user_id
 ORDER BY p.fail_count DESC, u.name;


-- 12. UKURAN DATA (supaya tahu kapan perlu menambah ruang di Render)
SELECT relname AS "Tabel",
       n_live_tup AS "Jumlah baris (perkiraan)",
       pg_size_pretty(pg_total_relation_size(relid)) AS "Ukuran"
  FROM pg_stat_user_tables
 ORDER BY pg_total_relation_size(relid) DESC;


-- 13. UKURAN SELURUH DATABASE
SELECT pg_size_pretty(pg_database_size(current_database())) AS "Ukuran seluruh database";


-- 14. FOTO TEMUAN: jumlah dan ukuran per bulan (foto disimpan di database, jadi ikut memakan ruang)
SELECT to_char(created_at AT TIME ZONE 'Asia/Makassar', 'YYYY-MM') AS "Bulan",
       count(*) AS "Jumlah foto",
       pg_size_pretty(sum(size)::bigint) AS "Total ukuran",
       pg_size_pretty(avg(size)::bigint) AS "Rata-rata per foto"
  FROM p2h_photos
 GROUP BY 1
 ORDER BY 1 DESC;


-- 15. HAK PER SITE: pengguna aktif per site dan peran (teknisi, pengawas, dan teknisi & pengawas hanya melihat site-nya)
SELECT coalesce(s.name, '(semua site: admin)') AS "Site",
       count(*) FILTER (WHERE u.role = 'teknisi') AS "Teknisi",
       count(*) FILTER (WHERE u.role = 'pengawas') AS "Pengawas",
       count(*) FILTER (WHERE u.role = 'teknisi_pengawas') AS "Teknisi & Pengawas",
       count(*) FILTER (WHERE u.role = 'admin') AS "Admin"
  FROM users u
  LEFT JOIN sites s ON s.id = u.site_id
 WHERE u.is_active
 GROUP BY s.name, s.sort_order
 ORDER BY s.sort_order NULLS LAST;


-- 16. KWH DAN HM BULANAN UNTUK REKAP EXCEL PMMR (kWh diisi pengawas di menu Data bulanan)
SELECT s.name AS "Site",
       u.code AS "Unit",
       k.year AS "Tahun",
       k.month AS "Bulan",
       k.kwh AS "kWh",
       h.hm_start AS "HM awal (data lama)",
       h.hm_end AS "HM akhir (data lama)",
       k.updated_at AS "Diisi pada"
  FROM unit_kwh_monthly k
  JOIN units u ON u.id = k.unit_id
  JOIN sites s ON s.id = u.site_id
  LEFT JOIN unit_hm_monthly h ON h.unit_id = k.unit_id AND h.year = k.year AND h.month = k.month
 ORDER BY k.year DESC, k.month DESC, s.sort_order, u.code;
