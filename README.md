# P2H Genset - Berau Coal / MTL

Aplikasi web (bisa dipasang di HP seperti aplikasi biasa) untuk P2H genset: 5 site (Binungan, Suaran, Gurimbang, Lati, Sambarata), 25 genset produksi (ditambah 20 unit arsip PMMR yang hanya ikut di rekap Excel), 30 butir cek. Ada dashboard, foto kerusakan, verifikasi pengawas, rekap mingguan / bulanan / tahunan, **rekap Excel PMMR** (status genset, data unit, PH, hour meter), unduh PDF / Word / Excel, dan notifikasi ke HP.

> Panduan Word yang lengkap ada di folder `docs` (Panduan Deploy dan Panduan Singkat Pemakai). README ini ringkasannya. Semua perintah dan isian di bawah sudah dicoba di komputer ini. Yang BELUM dicoba: pasang sungguhan di Render / Aiven (butuh akun Anda), dan tes di iPhone / Android asli.

## Susunan sistem

```
HP / komputer  -->  Render (satu layanan: tampilan web + server)  -->  Aiven (database PostgreSQL)
                                                                         ^
                                                    DBeaver (hanya untuk melihat isi database)
```

Tampilan web dan server dipasang **bersama dalam satu layanan di Render**, jadi tidak perlu Vercel dan tidak perlu mengatur CORS. Database ada di **Aiven**.

## Isi folder

| Folder / berkas | Isinya |
|---|---|
| `backend/` | Server (Express 5 + PostgreSQL). Juga menyajikan tampilan web hasil build. |
| `frontend/` | Tampilan web / aplikasi HP (React + Vite, PWA). |
| `docs/` | Panduan Word, `Template-Impor-Akun.xlsx`, `Query-DBeaver.sql` (16 query hanya-baca). |
| `Jalankan-Lokal.bat` | Coba aplikasi di komputer sendiri (klik dua kali). |
| `Hentikan-Lokal.bat` | Hentikan uji coba di komputer sendiri. |
| `Buat-Kunci.bat` | Membuat kunci rahasia untuk server (JWT dan VAPID). |

## Peran dan akses

| Peran | Bisa apa | Melihat |
|---|---|---|
| **Teknisi** | Mengisi P2H (foto wajib bila ada yang Rusak / Perbaiki), memperbarui temuan, unduh | Hanya **site-nya** |
| **Pengawas** | Memeriksa lalu **memverifikasi** P2H (tanda tangan), memperbarui temuan, mengisi kWh bulanan, unduh | Hanya **site-nya** |
| **Teknisi & Pengawas** | **Gabungan keduanya**: mengisi P2H dan memverifikasi P2H orang lain. P2H yang ia isi sendiri **tidak bisa** ia verifikasi sendiri | Hanya **site-nya** |
| **Admin** | Membuat akun, mengelola unit genset (termasuk data lengkap dan arsip PMMR), daftar cek, pengaturan | **Semua site** |

Akun dibuat oleh admin: **Nama, Perusahaan, Jabatan, No SID** (No SID dipakai untuk masuk), peran, dan **site** (wajib untuk semua peran selain admin). Banyak akun sekaligus: isi `docs/Template-Impor-Akun.xlsx`, salin, lalu tempel di Kelola > Pengguna > Impor dari Excel (di HP lewat Akun saya). Di kolom Peran boleh ditulis `Teknisi & Pengawas`.

Aturan P2H:

- Butir **Rusak** atau **Perbaiki** wajib ada **catatan dan minimal 1 foto** (maksimal 3 per butir). Tanpa foto, P2H tidak bisa dikirim. Foto dikecilkan otomatis di HP dan ikut tercetak di PDF / Word / Excel (lampiran foto).
- Status P2H: **Menunggu verifikasi** -> **Terverifikasi** setelah pengawas (site yang sama, bukan pengisinya) memeriksa dan menandatangani. Setelah Terverifikasi, teknisi tidak bisa mengubahnya.
- **Rekap** (menu Rekap): pilih **Mingguan, Bulanan, atau Tahunan**, geser periode dengan tombol panah, lihat ringkasan, lalu unduh PDF / Excel / Word.
- **Form P2H baru selalu kosong**: tidak ada draf lama yang muncul dan tidak ada angka yang terisi sendiri. Yang terisi hanya data dari pengaturan awal (nama pengisi, tanggal, shift, lokasi, job site). Angka HM terakhir hanya tampil sebagai petunjuk.

## Rekap Excel PMMR dan data bulanan

Menu **Rekap > Rekap PMMR (Excel)**: pilih bulan, tekan **Unduh Excel PMMR**. Hasilnya `PMMR_<tahun>.<bulan>_DATA_GENSET_<site>.xlsx` dengan 4 lembar seperti berkas PMMR yang lama:

| Lembar | Isi |
|---|---|
| STATUS GENSET | Per site: grafik batang (AC. limit, kWh, rata-rata kWh), status, issue, masa SKO / SLO dan sisa harinya |
| DATA | Data lengkap tiap unit (mesin, alternator, pembelian, overhaul), plus daftar BIB dan Breakdown & GOH (unit arsip) |
| PH | Per site: HM awal, HM akhir, HM jalan, kWh, rata-rata kW, % serapan (pakai rumus Excel) dan grafik ringkasan |
| HM | Hour meter awal / akhir tiap bulan sepanjang tahun, per unit |

- **HM** terisi sendiri. HM akhir bulan = pembacaan terakhir di P2H bulan itu; HM awal = HM akhir bulan sebelumnya. Januari sampai September 2026 diambil dari berkas PMMR lama (`backend/seed/pmmr.json`, dimuat sekali saat server pertama hidup); mulai Oktober dihitung dari P2H.
- **kWh** diisi manual di menu **Data bulanan** (hanya pengawas, teknisi & pengawas, dan admin): total listrik yang dihasilkan genset bulan itu, dari meter kWh. Kosong = dianggap belum ada.
- Admin mengunduh **semua site** dan unit arsip; peran lain hanya genset produksi di **site-nya**.
- **Unit arsip** (20 unit: BIB, Breakdown & GOH): hanya tampil di Excel dan di daftar Unit genset bagi admin (centang "Tampilkan arsip PMMR"). Tidak ikut P2H dan dashboard.
- Data lengkap unit (spesifikasi, pembelian, overhaul, SKO) diubah admin lewat Unit genset > Ubah data unit > "Data lengkap untuk rekap Excel PMMR".
- Tanggal SKO berakhir dan "Days remaining" dihitung Excel dari tanggal hari ini saat berkas dibuka.
