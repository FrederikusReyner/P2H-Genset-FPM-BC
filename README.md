# P2H Genset - Berau Coal / MTL

Aplikasi web (bisa dipasang di HP seperti aplikasi biasa) untuk P2H genset: 5 site (Binungan, Suaran, Gurimbang, Lati, Sambarata), 25 genset, 30 butir cek. Ada dashboard, foto kerusakan, verifikasi pengawas, rekap mingguan / bulanan / tahunan, unduh PDF / Word / Excel, dan notifikasi ke HP.

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
| `docs/` | Panduan Word, `Template-Impor-Akun.xlsx`, `Query-DBeaver.sql` (15 query hanya-baca). |
| `Jalankan-Lokal.bat` | Coba aplikasi di komputer sendiri (klik dua kali). |
| `Hentikan-Lokal.bat` | Hentikan uji coba di komputer sendiri. |
| `Buat-Kunci.bat` | Membuat kunci rahasia untuk server (JWT dan VAPID). |

## Peran dan akses

| Peran | Bisa apa | Melihat |
|---|---|---|
| **Teknisi** | Mengisi P2H (foto wajib bila ada yang Rusak / Perbaiki), memperbarui temuan, unduh | Hanya **site-nya** |
| **Pengawas** | Memeriksa lalu **memverifikasi** P2H (tanda tangan), memperbarui temuan, unduh | Hanya **site-nya** |
| **Admin** | Membuat akun, mengelola unit genset, daftar cek, pengaturan | **Semua site** |

Akun dibuat oleh admin: **Nama, Perusahaan, Jabatan, No SID** (No SID dipakai untuk masuk), peran, dan **site** (wajib untuk teknisi dan pengawas). Banyak akun sekaligus: isi `docs/Template-Impor-Akun.xlsx`, salin, lalu tempel di Kelola > Pengguna > Impor dari Excel (di HP lewat Akun saya).

Aturan P2H:

- Butir **Rusak** atau **Perbaiki** wajib ada **catatan dan minimal 1 foto** (maksimal 3 per butir). Tanpa foto, P2H tidak bisa dikirim. Foto dikecilkan otomatis di HP dan ikut tercetak di PDF / Word / Excel (lampiran foto).
- Status P2H: **Menunggu verifikasi** -> **Terverifikasi** setelah pengawas (site yang sama, bukan pengisinya) memeriksa dan menandatangani. Setelah Terverifikasi, teknisi tidak bisa mengubahnya.
- **Rekap** (menu Rekap): pilih **Mingguan, Bulanan, atau Tahunan**, geser periode dengan tombol panah, lihat ringkasan, lalu unduh PDF / Excel / Word.

## Coba dulu di komputer (10 menit)

1. Pasang **Node.js 22 atau lebih baru (LTS)** dari nodejs.org.
2. Klik dua kali **`Jalankan-Lokal.bat`**. Pertama kali ia memasang paket (perlu internet), menyalakan database uji, server, dan tampilan web, lalu membuka http://localhost:5173.
3. Masuk dengan No SID `admin` dan password dari `backend\.env` (`ADMIN_PASSWORD`). Kalau memilih data contoh, ada akun `teknisi` dan `pengawas` (site Suaran), password `Demo12345`.
4. Selesai? Klik dua kali `Hentikan-Lokal.bat`.

Cara manual (tiga jendela terminal): `cd backend`, `npm install`, `copy .env.example .env`, `npm run dev:db` | `cd backend`, `npm run dev` (opsional `npm run demo`) | `cd frontend`, `npm install`, `npm run dev`.

## Pasang ke internet: Render + Aiven

Urutan: kunci rahasia -> GitHub -> database di Aiven -> server di Render -> cek -> akun -> HP.

### 1. Buat kunci rahasia

Klik dua kali `Buat-Kunci.bat`. Hasilnya 3 baris: `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. Salin ke Notepad dan simpan di tempat aman (bukan di GitHub, jangan dikirim ke grup). Kunci di `.env` komputer ini hanya untuk uji lokal; di internet WAJIB pakai kunci baru.

### 2. Unggah ke GitHub

Buat repository **privat**, lalu unggah seluruh isi folder `p2h-genset` (berkas `.env`, `node_modules`, `dist` sudah dikecualikan oleh `.gitignore`).

### 3. Database di Aiven

1. Daftar di aiven.io, buat service **PostgreSQL**. Pilih paket **Free** untuk mencoba (lihat batas di bawah), region terdekat (mis. Singapura bila tersedia).
2. Di halaman **Overview** service, salin **Service URI**. Bentuknya `postgres://avnadmin:...@...aivencloud.com:12345/defaultdb?sslmode=require`.
3. (Disarankan) Di halaman yang sama klik **Download** di samping **CA certificate**, lalu buka berkas `ca.pem` dengan Notepad. Isinya dipakai untuk `DATABASE_CA`.

### 4. Server + web di Render (satu layanan)

New + > **Web Service** > pilih repository GitHub.

| Kolom | Isi |
|---|---|
| Region | Singapore (sedekat mungkin dengan database) |
| Root Directory | kosongkan (kalau `backend` dan `frontend` ada di paling atas repository) |
| Build Command | `cd frontend && npm ci --include=dev && npm run build && cd ../backend && npm ci --omit=dev` |
| Start Command | `cd backend && npm start` |
| Health Check Path (Advanced) | `/api/health` |

Penting: `--include=dev` wajib ada. Render memasang `NODE_ENV=production`, dan tanpa itu paket pembangun tampilan web tidak ikut terpasang (build gagal; sudah dicoba).

Environment Variables (jangan isi `PORT`; alamat aplikasi terisi otomatis oleh Render):

| Nama | Isi |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Service URI dari Aiven (boleh berakhiran `?sslmode=require`) |
| `DATABASE_CA` | isi `ca.pem` dari Aiven; boleh ditulis satu baris dengan `\n` sebagai pengganti baris baru; boleh dikosongkan (tetap terenkripsi, sertifikat tidak diperiksa) |
| `JWT_SECRET` | dari `Buat-Kunci.bat` |
| `VAPID_PUBLIC_KEY` | dari `Buat-Kunci.bat` |
| `VAPID_PRIVATE_KEY` | dari `Buat-Kunci.bat` |
| `VAPID_SUBJECT` | `mailto:` lalu email asli Anda |
| `ADMIN_NRP` | No SID admin pertama, mis. `admin` |
| `ADMIN_NAME` | nama admin |
| `ADMIN_PASSWORD` | password admin, minimal 8 karakter, yang kuat |

Server menyiapkan database sendiri saat pertama hidup (tabel, 5 site, 30 butir cek, 25 genset, akun admin). Buka `https://<nama-layanan>.onrender.com/api/health`: harus tampil `"ok":true`. Setelah masuk pertama kali, ganti password admin di menu Akun, lalu hapus `ADMIN_PASSWORD` dari Environment.

### 5. Cek hasil

1. `/api/health` -> `ok: true`; alamat utama menampilkan halaman masuk.
2. Masuk sebagai admin. Buat akun pengawas dan teknisi (Kelola > Pengguna > Tambah) untuk satu site.
3. Masuk sebagai teknisi di HP, buat P2H dengan satu butir Rusak: tanpa foto harus ditolak, dengan foto terkirim.
4. Masuk sebagai pengawas site yang sama: P2H itu berstatus Menunggu verifikasi; verifikasi, statusnya jadi Terverifikasi.
5. Menu Rekap: coba Mingguan, Bulanan, Tahunan, lalu unduh PDF, Excel, Word.
6. Akun saya > Notifikasi di HP > Aktifkan > Kirim tes.

### 6. DBeaver ke Aiven

Di halaman Overview Aiven klik **Quick connect**, pilih **Java**, salin **JDBC URI**. Di DBeaver: Database > New Database Connection > PostgreSQL > pilihan **URL** > tempel > Finish. Lalu buka `docs/Query-DBeaver.sql`, klik di dalam satu query, tekan **Ctrl+Enter**.

### 7. Pasang di HP

- **Android**: buka di Chrome > menu (tiga titik) > Pasang aplikasi.
- **iPhone / iPad**: buka di **Safari** > Bagikan > **Tambah ke Layar Utama**. Notifikasi di iPhone hanya jalan kalau dibuka dari ikon di Layar Utama (iOS 16.4 ke atas).

## Kalau tampilan web ingin dipasang terpisah (tidak wajib)

Tampilan web bisa juga di tempat lain (Vercel, Netlify, dll.): bangun dengan `VITE_API_URL=https://alamat-server` lalu isi `CORS_ORIGINS` (dan `APP_URL`) di server dengan alamat web itu. Cara standar di atas tidak membutuhkannya.

## Biaya dan batas (dicek 17 Okt 2026, cek lagi di halaman harga sebelum membayar)

| Layanan | Gratis | Berbayar |
|---|---|---|
| Aiven PostgreSQL | tanpa batas waktu; 1 CPU, 1 GB RAM, **1 GB disk**; 20 koneksi; bisa **dimatikan otomatis kalau lama tidak dipakai** (ada pemberitahuan, bisa dinyalakan lagi) | naik paket lewat tombol Upgrade plan setelah menambah metode pembayaran (harga paket kecil sekitar US$5-8 per bulan; cek) |
| Render server | tidur setelah 15 menit tanpa pemakai, bangun sekitar 1 menit; 750 jam per bulan; Render menyebut gratis tidak untuk produksi | Starter sekitar US$7 per bulan (tidak tidur) |

Foto temuan disimpan di database. Perkiraan kasar: sekitar 25 KB per P2H ditambah foto (sekitar 150-300 KB per foto setelah dikecilkan). Kalau 8% P2H ada temuan dengan 1-2 foto, kira-kira **0,9 GB per tahun** untuk 25 genset diisi 2 shift setiap hari. Jadi 1 GB gratis Aiven hanya cukup sekitar setahun; untuk dipakai sungguhan pilih paket dengan disk 5 GB atau lebih. Pantau lewat query nomor 12-14 di `Query-DBeaver.sql`.

## Lupa password admin

Sudah diuji. Di DBeaver jalankan (hanya kalau benar-benar perlu):

```sql
UPDATE users SET is_active = false WHERE role = 'admin';
```

Lalu di Render ubah `ADMIN_PASSWORD` (minimal 8 karakter) dan restart layanan. Masuk dengan `ADMIN_NRP` dan password baru. Sebaiknya punya minimal 2 admin.

## Masalah umum

| Gejala | Penyebab / jalan keluar |
|---|---|
| Lama sekali saat pertama dibuka | Server gratis sedang bangun (sekitar 1 menit). Tunggu, atau pakai paket Starter. |
| Log Render: "database belum siap (percobaan ...)" | `DATABASE_URL` salah, atau database Aiven sedang dimatikan karena lama tidak dipakai: nyalakan di halaman Overview Aiven. |
| Log: "self-signed certificate" | `DATABASE_CA` terisi sertifikat yang salah. Kosongkan, atau isi dengan `ca.pem` dari service yang sama. |
| Build Render gagal ("vite: not found") | Build Command tidak memakai `npm ci --include=dev` untuk bagian frontend. |
| Notifikasi tidak muncul | iPhone belum dipasang di Layar Utama; izin notifikasi ditolak; `VAPID_*` belum diisi; kunci VAPID diganti (semua HP harus Aktifkan lagi). |
| Foto tidak bisa dikirim | Coba ambil foto lagi (ukuran dikecilkan otomatis); sinyal lemah: P2H tersimpan di HP dan terkirim otomatis begitu sinyal kembali. |
| `npm install` menampilkan "2 moderate severity vulnerabilities" | Abaikan (dari paket Excel, tidak terpakai di jalur yang berbahaya). **Jangan** jalankan `npm audit fix --force`. |
| Terlalu banyak permintaan (429) | Tunggu semenit. Batas masuk: 15 percobaan per menit. |

## Status uji

- Lulus: pengecekan tipe dan build web; **27 uji API** (foto wajib, batas site, verifikasi, rekap, unduhan, akun, impor); **37 pengecekan layar** di Chrome (foto wajib dan pengecilan foto, verifikasi, pengawas site lain ditolak, akun admin, rekap, tanpa sinyal dengan foto); latihan produksi "satu layanan" dari salinan bersih (build seperti Render, server menyajikan web, CSP, service worker, tanpa kesalahan konsol); **koneksi database ber-TLS ala Aiven** (sertifikat sendiri, `?sslmode=require`, `DATABASE_CA` benar dan salah); template impor akun; 15 query DBeaver; jalur lupa password admin; huruf besar/kecil nama berkas untuk Linux.
- Belum: pasang sungguhan di Render / Aiven; iPhone dan Android asli (termasuk kamera HP untuk foto); notifikasi di HP asli.
- Perlu Anda pastikan: "Job Site" per site (dugaan "BMO 1" untuk Binungan dan Suaran), kode dokumen form (`BC-GE-P-ex JPC`), jam shift 06:00 dan 18:00, izin IT memakai layanan cloud untuk data P2H.
