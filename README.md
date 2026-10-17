# P2H Genset - Berau Coal / MTL

Aplikasi web (bisa dipasang di HP seperti aplikasi biasa) untuk P2H genset: 5 site (Binungan, Suaran, Gurimbang, Lati, Sambarata), 25 genset, 30 butir cek, dashboard, unduh PDF / Word / Excel, dan notifikasi ke HP.

> Panduan Word yang lengkap belum selesai. README ini adalah panduan sementara. Semua perintah dan isian di bawah sudah dicoba di komputer ini. Yang BELUM dicoba: pasang sungguhan di Render/Vercel (butuh akun Anda) dan tes di iPhone / Android asli.

## Isi folder

| Folder / berkas | Isinya |
|---|---|
| `backend/` | Server (Express 5 + PostgreSQL). Dipasang di **Render**. |
| `frontend/` | Tampilan web / aplikasi HP (React + Vite, PWA). Dipasang di **Vercel**. |
| `docs/Template-Impor-Akun.xlsx` | Template Excel untuk membuat banyak akun sekaligus. |
| `docs/Query-DBeaver.sql` | 13 query (hanya membaca) untuk dibuka di DBeaver: rekap, temuan terbuka, genset belum P2H, dll. |

## Yang Anda perlukan

- Program di komputer: **Node.js 22 atau lebih baru (LTS)**, **Git** (atau GitHub Desktop), **DBeaver Community** (hanya untuk melihat isi database).
- Akun gratis: **GitHub**, **Render**, **Vercel** (daftar dengan akun GitHub supaya mudah).
- Email asli untuk `VAPID_SUBJECT` (dipakai layanan notifikasi).
- Izin dari IT / atasan memakai layanan cloud di luar negeri untuk data P2H.

## Coba dulu di komputer (10 menit)

Buka 3 jendela terminal. Jalankan berurutan:

```bash
# jendela 1 - database uji (biarkan terbuka)
cd backend
npm install
copy .env.example .env
npm run dev:db
```

```bash
# jendela 2 - server (biarkan terbuka)
cd backend
npm run dev
# opsional, isi akun dan P2H contoh supaya dashboard ramai (hanya jalan di localhost):
npm run demo
```

```bash
# jendela 3 - tampilan web
cd frontend
npm install
npm run dev
```

Buka http://localhost:5173. Masuk dengan ID `admin` dan password dari `backend/.env` (`ADMIN_PASSWORD`). DBeaver bisa tersambung ke `localhost`, port `5433`, database `p2h`, user `postgres`, password `postgres`.

## Pasang ke internet

Urutannya: kunci rahasia -> GitHub -> database di Render -> server di Render -> web di Vercel -> sambungkan -> cek.

### 1. Buat kunci rahasia

```bash
cd backend
npm install
npm run keys
```

Hasilnya 3 baris: `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. Simpan di tempat aman (bukan di GitHub, jangan dikirim ke grup). Kunci di `.env` komputer ini hanya untuk uji lokal; di produksi WAJIB pakai kunci baru.

### 2. Unggah ke GitHub

Buat repository **privat**, lalu unggah seluruh folder `p2h-genset` (berkas `.env`, `node_modules`, `dist` sudah dikecualikan oleh `.gitignore`).

### 3. Database di Render

New + > **Postgres**. Region **Singapore**. Setelah jadi, salin dua alamat dari halaman database:

- **Internal Database URL** -> untuk server (Langkah 4).
- **External Database URL** -> hanya untuk DBeaver.

Server dan database harus di region yang sama supaya alamat Internal bisa dipakai.

### 4. Server di Render

New + > **Web Service** > pilih repository GitHub.

| Kolom | Isi |
|---|---|
| Region | Singapore (sama dengan database) |
| Root Directory | `backend` |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path (Advanced) | `/api/health` |

Environment Variables (jangan isi `PORT`, Render mengisinya sendiri):

| Nama | Isi |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Internal Database URL dari Langkah 3 |
| `JWT_SECRET` | dari `npm run keys` |
| `VAPID_PUBLIC_KEY` | dari `npm run keys` |
| `VAPID_PRIVATE_KEY` | dari `npm run keys` |
| `VAPID_SUBJECT` | `mailto:` lalu email asli Anda |
| `CORS_ORIGINS` | alamat web Vercel, mis. `https://nama-projek.vercel.app` (tanpa `/` di ujung). Sementara isi apa saja, diganti di Langkah 6. |
| `APP_URL` | sama dengan `CORS_ORIGINS` |
| `ADMIN_NRP` | ID admin pertama, mis. `admin` |
| `ADMIN_NAME` | nama admin |
| `ADMIN_PASSWORD` | password admin, minimal 8 karakter, yang kuat |

Server menyiapkan database sendiri saat pertama hidup (tabel, 5 site, 30 butir cek, 25 genset, akun admin). Buka `https://<nama-server>.onrender.com/api/health`: harus tampil `"ok":true`. Setelah masuk pertama kali, ganti password admin di menu Akun, lalu hapus `ADMIN_PASSWORD` dari Environment.

### 5. Web di Vercel

Add New > **Project** > pilih repository yang sama.

| Kolom | Isi |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite (otomatis) |
| Environment Variable `VITE_API_URL` | alamat server Render, mis. `https://p2h-genset-api.onrender.com` (tanpa `/` di ujung) |

Kalau `VITE_API_URL` diubah kemudian, harus **Redeploy** di Vercel (nilainya ditanam saat build). Aturan keamanan di `frontend/vercel.json` hanya mengizinkan server di `*.onrender.com`; kalau server pakai domain sendiri, ubah bagian `connect-src`.

### 6. Sambungkan

Kembali ke Render > server > Environment: isi `CORS_ORIGINS` dan `APP_URL` dengan alamat web Vercel yang sebenarnya (alamat pendek, bukan yang berkode acak), simpan. Server otomatis dipasang ulang.

### 7. Cek hasil

1. `/api/health` -> `ok: true`.
2. Buka alamat Vercel, masuk sebagai admin.
3. Akun saya > Pengguna: buat akun uji, atau impor dari Excel (lihat di bawah).
4. Masuk dengan akun mekanik di HP, kirim satu P2H, lihat muncul di Beranda.
5. Buka P2H itu, coba unduh PDF, Excel, Word.
6. Akun saya > Notifikasi di HP > Aktifkan > Kirim tes.

### 8. DBeaver ke database Render

Database > New Database Connection > PostgreSQL. Isi Host, Port (5432), Database, Username, Password dari **External Database URL**. Tab **SSL**: centang **Use SSL**, mode **require**. Lalu buka `docs/Query-DBeaver.sql`, klik di dalam satu query, tekan **Ctrl+Enter**.

### 9. Impor akun dari Excel

Isi lembar `Akun` di `docs/Template-Impor-Akun.xlsx` (ID karyawan, Nama, Peran, Site, Jabatan; password boleh kosong). Salin semua barisnya (Ctrl+C), lalu di aplikasi: Akun saya > Pengguna > **Impor dari Excel** > tempel > **Buat akun**. Password awal muncul SATU KALI; bagikan lewat pesan pribadi. Setiap orang wajib menggantinya saat masuk pertama.

### 10. Pasang di HP

- **Android**: buka di Chrome > menu (tiga titik) > Pasang aplikasi.
- **iPhone / iPad**: buka di **Safari** > Bagikan > **Tambah ke Layar Utama**. Notifikasi di iPhone hanya jalan kalau dibuka dari ikon di Layar Utama (iOS 16.4 ke atas).

## Biaya dan batas (dicek 17 Okt 2026, cek lagi di halaman harga sebelum membayar)

| Layanan | Gratis | Berbayar |
|---|---|---|
| Render server | tidur setelah 15 menit tanpa pemakai, bangun sekitar 1 menit; 750 jam per bulan; Render menyebut gratis tidak untuk produksi | Starter sekitar US$7 per bulan (tidak tidur) |
| Render database | **kedaluwarsa 30 hari setelah dibuat** (lalu 14 hari masa tenggang, setelah itu data DIHAPUS); 1 GB; tanpa cadangan | Basic-256mb sekitar US$6 per bulan + US$0,30 per GB per bulan (sumber berbeda-beda, cek di halaman harga) |
| Vercel | Hobby: **hanya untuk pemakaian pribadi / non-komersial** | Pro: US$20 per pengguna per bulan |

Untuk dipakai sungguhan oleh perusahaan, siapkan database berbayar sejak awal. Perkiraan pertumbuhan data: sekitar 24,5 KB per P2H (diukur dari data contoh) = sekitar 0,45 GB per tahun kalau semua 25 genset diisi 2 shift setiap hari. Soal Vercel Hobby untuk pemakaian perusahaan: tanyakan ke IT.

## Lupa password admin

Sudah diuji. Di DBeaver jalankan (hanya kalau benar-benar perlu):

```sql
UPDATE users SET is_active = false WHERE role = 'admin';
```

Lalu di Render ubah `ADMIN_PASSWORD` (minimal 8 karakter) dan restart server. Masuk dengan `ADMIN_NRP` dan password baru. Sebaiknya punya minimal 2 admin supaya jalur ini jarang dipakai.

## Masalah umum

| Gejala | Penyebab / jalan keluar |
|---|---|
| Lama sekali saat pertama dibuka | Server gratis sedang bangun (sekitar 1 menit). Tunggu, atau pakai paket Starter. |
| Banner "Tidak ada sinyal" padahal internet ada | `VITE_API_URL` salah, atau `CORS_ORIGINS` tidak sama persis dengan alamat web (harus https, tanpa `/` di ujung). Ubah lalu pasang ulang. |
| Log Render: "database belum siap (percobaan ...)" | `DATABASE_URL` salah, atau beda region dengan database. Kalau perlu pakai External URL (tetap jalan). |
| Notifikasi tidak muncul | iPhone belum dipasang di Layar Utama; izin notifikasi ditolak; `VAPID_*` belum diisi; kunci VAPID diganti (semua HP harus Aktifkan lagi). |
| `npm install` menampilkan "2 moderate severity vulnerabilities" | Abaikan (dari paket Excel, tidak terpakai di jalur yang berbahaya). **Jangan** jalankan `npm audit fix --force`. |
| Terlalu banyak permintaan (429) | Tunggu semenit. Batas masuk: 15 percobaan per menit. |

## Status uji

- Lulus: pengecekan tipe dan build web, 24 uji API, 14 pengecekan alur layar di Chrome (ubah P2H, tanda tangan, tutup temuan, hak akses), notifikasi push sungguhan lewat Chrome, mode tanpa sinyal, pasang bersih dari nol (`npm ci`) dan jalan sebagai produksi dari database kosong, pengecekan huruf besar/kecil nama berkas untuk Linux.
- Belum: pasang sungguhan di Render / Vercel, iPhone dan Android asli, notifikasi di HP asli.
- Perlu Anda pastikan: "Job Site" per site (dugaan "BMO 1" untuk Binungan dan Suaran), kode dokumen form (`BC-GE-P-ex JPC`), jam shift 06:00 dan 18:00.
