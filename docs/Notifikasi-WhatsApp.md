# Kabar temuan P2H ke grup WhatsApp

Setiap P2H yang ada temuannya (kode **A** atau **STOP / AA**) dikabarkan ke satu grup WhatsApp. P2H yang semua butirnya baik tidak dikirim. Kalau P2H diubah lalu muncul temuan baru, temuan baru itu juga dikirim.

Contoh pesan:

```
🛑 *STOP OPERASI · GS-SUA-01*
Jangan jalankan unit sebelum diperbaiki.

Site: Suaran
Shift: I · Jumat, 13 November 2026
Diperiksa oleh: Budi Santoso

*Kode AA (1) · unit harus berhenti:*
1. Level oli mesin (Rusak)
   Catatan: oli merembes di seal depan

Rincian dan foto: https://alamat-aplikasi/p2h/123
```

## Cara kerjanya

Server aplikasi ini sendiri yang tersambung ke WhatsApp, sebagai **perangkat tertaut** dari nomor pengirim (seperti WhatsApp Web). Tidak ada layanan pihak ketiga, tidak ada akun lain, tidak ada token, dan tidak ada biaya atau kuota.

- **Jalur data:** isi pesan hanya berjalan dari server ke WhatsApp. Yang bisa membaca hanya anggota grup.
- **Yang dibuka server:** hanya grup tujuan. Pesan baru dari chat pribadi dan grup lain di nomor itu tidak didekripsi, riwayat lengkap tidak diminta, dan isi pesan tidak disimpan atau dicatat di log. Saat pertama tersambung, WhatsApp mengirim sinkronisasi awal yang dibutuhkan agar sesi stabil; isinya hanya lewat di memori server dan dibuang.
- **Sesi WhatsApp:** disimpan di tabel `wa_auth` di database, terenkripsi AES-256-GCM dengan kunci turunan dari `JWT_SECRET`. Tanpa `JWT_SECRET` server, isinya tidak bisa dipakai. Kalau `JWT_SECRET` diganti, nomor harus ditautkan ulang.
- **Pustaka:** [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`), versi dikunci di `package.json`. Jangan diganti dengan paket "baileys" tiruan dari npm: pernah ada yang mencuri pesan.

## Risiko yang tetap ada

- Ini **bukan jalur resmi** WhatsApp. Nomor pengirim bisa diblokir. Pakai **nomor khusus** untuk keperluan ini.
- Siapa pun yang memegang `DATABASE_URL` **dan** `JWT_SECRET` bisa mengambil alih nomor pengirim. Jaga keduanya seperti password.

## Cara memasang

1. Siapkan nomor pengirim yang aktif di sebuah HP, lalu masukkan nomor itu ke grup tujuan.
2. Masuk aplikasi sebagai admin, buka **Kelola > Pengaturan > Kabar temuan ke grup WhatsApp**.
3. Tekan **Hubungkan WhatsApp**. Kode QR muncul.
4. Di HP nomor pengirim: WhatsApp > **Perangkat tertaut** > **Tautkan perangkat**, lalu scan kode QR.
5. Setelah tersambung, tekan **Pilih grup tujuan** dan pilih grupnya.
6. Tekan **Kirim pesan tes**. Pesan tes harus muncul di grup.

Di HP, perangkatnya tercantum sebagai **P2H Genset** di daftar Perangkat tertaut.

## Kalau pesan tidak sampai

Halaman Pengaturan menampilkan keadaan sambungan dan hasil kiriman terakhir.

| Keterangan | Artinya | Yang dilakukan |
|---|---|---|
| Tautan sudah diputus | Perangkat dicabut dari HP, atau HP lama tidak online | Hubungkan lagi dan scan QR |
| Sedang tidak tersambung | Jaringan putus; server mencoba lagi sendiri | Tunggu; pastikan HP pengirim online |
| Dipakai server lain | Dua server memakai sesi yang sama | Matikan salah satunya |
| Sesi tidak bisa dibuka | `JWT_SECRET` berubah | Hubungkan lagi dan scan QR |
| Nomor ditolak | Kemungkinan diblokir WhatsApp | Ganti nomor pengirim |

Kegagalan kirim WhatsApp tidak mengganggu P2H: P2H tetap tersimpan, dan pemberitahuan di aplikasi serta notifikasi di HP tetap jalan.

## Catatan untuk Render paket gratis

Server gratis Render tidur setelah 15 menit tanpa pengunjung. Saat tidur, sambungan WhatsApp ikut tertutup, tetapi P2H juga tidak bisa dikirim, jadi tidak ada temuan yang terlewat. Saat server bangun, sambungan dibuka lagi otomatis dari sesi di database (tanpa scan ulang). WhatsApp mencabut perangkat tertaut yang tidak online sekitar 14 hari; kalau aplikasi jarang dipakai, cek halaman Pengaturan sesekali.
