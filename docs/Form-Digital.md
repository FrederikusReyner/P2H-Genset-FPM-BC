# Form digital (selain P2H Genset)

Sesudah masuk, aplikasi membuka layar **Pilih form**. P2H Genset tetap seperti sebelumnya (sekarang di menu *P2H Genset*). Form lain memakai alur yang sama:

1. **Pengisi** (teknisi / operator) memilih objek, mengisi butir, melampirkan foto bila ada yang tidak baik, lalu tanda tangan.
2. **Pemeriksa** (pengawas) memverifikasi dan menandatangani, bisa menulis catatan / rekomendasi (mis. "Stop / tetap beroperasi").
3. **Temuan** dipantau sampai ditutup: Terbuka → Sedang diperbaiki (dengan rencana penyelesaian) → Selesai (dengan tindakan perbaikan).

## Form yang sudah tersedia (disalin dari form kertas)

| Form | Periode | Objek | Isi awal |
|---|---|---|---|
| Inspeksi Tools & Equipment | per kuartal | Electric Suaran (ESUA) | 72 tools, kondisi Ya/Tidak |
| Pengukuran Arus Motor | bulanan | Suaran | 40 motor, arus R/S/T kosongan & muatan, batas = arus maks |
| Safety Device Mingguan | mingguan | CV-10, 11, 12, 13, 14, 15, 18, 19 | daftar safety device per conveyor, Fungsi/Tidak |
| Pengujian Metal Catcher | mingguan | Unit (admin menambahkan) | 5 ukuran plat, Ketarik/Tidak |
| Pengukuran Pentanahan (Grounding) | per semester (bisa diganti kuartal di Kelola) | Suaran - BMO 1 | 21 titik grounding & penyalur petir, tahanan Ohm, batas maks 5 Ohm |
| Pemeriksaan Jembatan Timbang | mingguan | Jembatan Timbang | plat, penerangan, traffic light, 7 load cell (posisi / kebersihan / kabel), control room, Baik/Buruk |
| Pemeriksaan Transformator | bulanan | KM-30, KM-28 | bulanan: tegangan, load, oli, tangki, sirip pendingin, bushing, suara / bau (Good/Bad); butir tahunan (boleh dilewati): megger R/S/T-PE, tahanan grounding maks 5 Ohm, cleaning & re-torque bushing, gauge |
| Checklist Pemeriksaan Oil Trap | mingguan | Power House | bak oil trap (tidak tercampur air hujan, bangunan tidak bocor, bersih dari lumpur / minyak) dan saluran oil trap, Y/N, rencana perbaikan / pembersihan |
| Pemeriksaan Panel Room / MCC | tiap 2 minggu | MCC 1, 2, 4, 5, panel Metal Catcher CV-14 & CV-15 | AC, kebersihan, APAR (khusus panel dalam ruangan, boleh dilewati), wiring diagram, kondisi fisik (kabel gland, lubang, karat, hancur), kebersihan dalam panel, kekencangan koneksi, kerapian & isolasi kabel; panel metal catcher + metering & lampu indikasi; Baik/Buruk |
| Pemeriksaan Motor Listrik (koneksi terminal) | per kuartal | 20 motor utama (inloading, outloading, pompa) | koneksi terminal (terminal box, plat isolator, baut & mur, jumper), fisik motor, uji tahanan isolasi (min 1 MOhm), tahanan belitan, uji tanpa beban (boleh dilewati bila tidak diuji) |

Catatan: satuan Ω ditulis "Ohm" / "MOhm" (dan simbol khusus lain dihindari) supaya aman di semua jenis database.

Periode "tiap 2 minggu" dihitung per blok 14 hari mulai Senin (blok yang sama untuk semua form). Periode tiap form bisa diubah di **Kelola > Pengaturan form**.

## Jenis butir

- **Pilihan baik / tidak**: labelnya bebas (Baik/Rusak, Ya/Tidak, Fungsi/Tidak, Ketarik/Tidak). Bila tidak baik: catatan wajib, foto wajib (bisa dimatikan per butir).
- **Angka ukur**: satu nilai, R/S/T, atau R/S/T kosongan & muatan, dengan batas minimum / maksimum. Angka di luar batas otomatis jadi temuan.
- **Isian bebas**: teks, tanggal, atau angka (mis. expired SIMPER).

Tingkat temuan per butir: **STOP** (objek tidak boleh dioperasikan), **Perbaiki** (dalam batas jam di pengaturan form), atau **Dicatat saja**.

## Rekap & grafik

Tiap form punya menu **Rekap** (juga tombol *Rekap & grafik* di Ringkasan). Pilih rentang **7 hari / 30 hari / 90 hari / 12 bulan** dan (untuk admin) site-nya:

- **Angka utama**: jumlah isian, persen isian yang ada temuan, kepatuhan periode terakhir, temuan terbuka (STOP / perbaiki / lewat batas), temuan selesai dan rata-rata waktu perbaikannya, persen terverifikasi dan rata-rata waktu verifikasi.
- **Tren isian**: batang bertumpuk Baik / Ada temuan / STOP per hari (≤ 45 hari), per minggu (≤ 200 hari), atau per bulan.
- **Kepatuhan pemeriksaan**: persen objek yang sudah diperiksa per hari (form per shift / harian, dihitung 2 shift), per minggu, atau per bulan. Tidak tampil untuk form "sesuai kebutuhan".
- **Butir paling sering bermasalah** dan **temuan per objek**.
- **Per site** (admin, semua site): isian dan temuan tiap site, dengan tombol untuk langsung menyaring ke site itu.

Semua grafik bisa dibuka sebagai tabel ("Lihat sebagai tabel") dan menampilkan angka saat disentuh / diarahkan.

Tombol **Unduh rekap** (PDF / Excel / Word) ada di kanan atas halaman **Rekap** (memakai rentang dan site yang sedang tampil) dan di halaman **Riwayat** (memakai tanggal *Dari / s.d.* dan site di Riwayat; tanpa tanggal = 30 hari terakhir). Isinya bergaya dashboard, sama dengan layar:

- **PDF**: halaman pertama berisi kotak angka utama (dengan cincin persen), grafik tren isian, grafik kepatuhan, butir paling sering bermasalah, temuan per objek, dan per site; halaman berikutnya daftar isian dan daftar temuan.
- **Word**: angka utama dan grafik batang berwarna (tampil sama di Word, LibreOffice, Google Docs), lalu daftar isian dan temuan.
- **Excel**: sheet *Ringkasan* (angka utama dan tabel tren, kepatuhan, butir & objek bermasalah, per site, masing-masing dengan kolom **Grafik** berwarna), *Isian* (semua isian) dan *Temuan* (butir, tingkat, hasil / angka ukur, catatan, foto, status, rencana selesai, tindakan perbaikan, ditutup oleh). Ada penyaring di tiap kolom.
- PDF / Word paling banyak 2.000 isian dan 600 temuan; selebihnya diberi catatan untuk mengunduh Excel. Kolom yang panjang (rencana & tindakan perbaikan) hanya di Excel.
- Hak akses form dicek lagi saat file diunduh.

Rekap **P2H Genset** (menu *Rekap* di P2H Genset) memakai tampilan dan unduhan bergaya dashboard yang sama, dengan pilihan mingguan / bulanan / tahunan.

## Hak akses form per akun

Di **Kelola > Pengguna**, setiap akun (selain admin) punya pilihan **Akses form**: *Semua form* (bawaan) atau *Pilih form* (centang P2H Genset dan / atau form digital tertentu).

- Form yang tidak diizinkan tidak tampil di layar Pilih form, dan server menolak bila dibuka langsung (termasuk P2H Genset: dashboard, riwayat, rekap, unduhan).
- Pemberitahuan di aplikasi dan notifikasi HP hanya untuk form yang diizinkan.
- Admin selalu bisa membuka semua form.

## Kelola (admin)

Buka form → menu **Kelola**:

- **Pengaturan form**: nama, periode (shift / harian / mingguan / bulanan / per kuartal / per semester / sesuai kebutuhan), batas jam perbaikan, sebutan pengisi & pemeriksa, aktif / tidak.
- **Objek**: tambah / ubah / nonaktifkan (unit LV, conveyor, generator, ...). Objek baru bisa **menyalin daftar butir** dari objek lain (mis. conveyor baru menyalin CV-11).
- **Daftar butir cek**: bagian umum (berlaku untuk semua objek) atau khusus satu objek. Tambah bagian, tambah / ubah butir, ubah urutan, nonaktifkan. Butir yang dinonaktifkan tidak muncul di form baru; isian lama tetap utuh.

## Pemberitahuan

- Di aplikasi dan notifikasi HP: setiap isian (ditandai bila ada temuan) dan saat temuan ditutup.
- Grup WhatsApp (bila WhatsApp sudah ditautkan; saklarnya per form di **Kelola > Pengaturan form**):
  - **Grup per form**: nomor WhatsApp cukup ditautkan (scan QR) sekali di Pengaturan. Tiap form bisa mengirim ke grup yang berbeda lewat **Kelola > Pengaturan form > Grup WhatsApp form ini**; bila tidak dipilih, memakai grup utama. Nomor yang ditautkan harus sudah menjadi anggota grup tujuan.
  - **Temuan**: setiap isian yang ada temuannya langsung dikabarkan (STOP dan yang perlu diperbaiki dalam satu pesan), juga saat temuan selesai diperbaiki ("Boleh jalan lagi" bila STOP terakhir di objek itu selesai).
  - **Verifikasi**: satu pesan per isian yang diverifikasi, berisi hasil, pengisi, pemeriksa, dan rekomendasi.
  - **Form per shift** (bila ada form yang periodenya diatur "tiap shift" di Kelola): tidak per isian, tetapi **satu rekap per site per shift** setelah semua isian shift itu terverifikasi. Rekap dikirim begitu semua unit sudah diisi dan diverifikasi, atau setelah shift berakhir (unit yang tidak dipakai tidak ditunggu, tercantum sebagai "Tidak diperiksa"). Tiap rekap hanya dikirim sekali.

## Tanpa sinyal di site

Sama seperti P2H Genset, semua form digital tetap bisa dipakai saat sinyal hilang:

- **Membuka form**: daftar form, daftar objek, dan daftar butir cek yang pernah dibuka disimpan di HP, dan semua halaman aplikasi diunduh di latar begitu aplikasi dibuka saat ada sinyal. Saat tanpa sinyal, form tetap bisa dibuka dan diisi.
- **Mengirim**: bila sinyal tidak ada saat menekan **Kirim**, isian (termasuk foto & tanda tangan) **disimpan di HP** dan muncul layar *Tersimpan di HP*. Di atas layar ada pita "N isian menunggu sinyal" dengan tombol *Kirim sekarang*.
- **Terkirim otomatis** begitu ada sinyal lagi (saat HP tersambung, saat aplikasi dibuka, dan tiap 30 detik selama aplikasi terbuka). Muncul pesan "N isian terkirim". Kalau sinyal putus di tengah pengiriman lalu dikirim ulang, server mengenali isian yang sama sehingga **tidak tercatat dua kali**.
- Antrean milik akun yang mengisi: bila HP dipakai bergantian, isian hanya dikirim saat akun itu yang masuk.
- Jangan hapus data browser / aplikasi sebelum isian terkirim. Bila server menolak isian (mis. objek itu sudah diisi orang lain untuk periode yang sama), pitanya berwarna merah dengan alasannya.
- Mengubah isian yang sudah terkirim tetap butuh sinyal.

## Cetak

Halaman hasil isian punya tombol **Cetak / PDF** (pakai fitur cetak browser, pilih "Simpan sebagai PDF").
