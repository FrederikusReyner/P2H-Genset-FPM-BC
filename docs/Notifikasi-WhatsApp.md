# Kabar P2H ke grup WhatsApp

Ada tiga jenis pesan ke satu grup WhatsApp. Untuk 5 site dan 2 shift, totalnya sekitar 10 sampai 15 pesan sehari.

| Pesan | Kapan dikirim |
|---|---|
| **Rekap per site per shift** | Begitu semua genset wajib di site itu (status running / standby) sudah di-P2H **dan** semua P2H-nya diverifikasi pengawas. Satu pesan per site per shift. |
| **Rekap belum lengkap** | Kalau sampai 3 jam setelah shift berakhir rekapnya belum lengkap. Dikirim pada kegiatan berikutnya di site itu (P2H baru atau verifikasi), berisi daftar genset yang belum P2H / belum diverifikasi. |
| **STOP AA** | Langsung saat P2H dengan temuan AA dikirim, tidak menunggu rekap. |
| **Temuan selesai** | Saat temuan ditutup di menu Temuan. Kalau itu temuan STOP terakhir di unit itu, judulnya "Boleh jalan lagi". |

Aturan lain:

- Temuan kode A cukup tercantum di rekap. Kalau rekap shift itu sudah terkirim lalu muncul temuan A baru (mis. P2H diubah), temuan itu dikabarkan langsung.
- Tiap rekap hanya dikirim sekali. Verifikasi dibatalkan lalu diulang tidak mengirim rekap baru.
- Shift yang berakhir sebelum grup tujuan dipilih tidak direkap, supaya grup baru tidak dibanjiri rekap lama.
- Status "Sedang diperbaiki" tidak dikirim ke grup.

Contoh rekap:

```
📋 *Rekap P2H Suaran · Shift I*
Jumat, 13 November 2026
✅ 5 dari 5 genset sudah P2H dan diverifikasi

*Temuan (1):*
⚠️ GS-SUA-02
   A, perbaiki dalam 12 jam · Lampu panel (Perbaiki): satu lampu mati
   Rincian: https://alamat-aplikasi/p2h/124

Baik: GS-SUA-01, GS-SUA-03, GS-SUA-04, GS-SUA-05
Diverifikasi oleh: Andi Pratama
```

Contoh temuan selesai:

```
✅ *Boleh jalan lagi · GS-SUA-01*
Tidak ada lagi temuan STOP di unit ini.

Site: Suaran
Butir: Level oli mesin (kode AA)
Perbaikan: ganti seal depan, oli ditambah
Ditutup oleh: Andi Pratama (Pengawas)
Lama terbuka: 6 jam
```

Contoh STOP AA:

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

Sebaiknya pakai **grup khusus kabar P2H**. Server membuka pesan di grup tujuan (dibutuhkan agar sesi kirim ke grup tetap sah; isinya hanya lewat di memori dan tidak disimpan), jadi diskusi lebih baik di grup lain.

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

Server gratis Render tidur setelah 15 menit tanpa pengunjung. Saat tidur, sambungan WhatsApp ikut tertutup, tetapi P2H juga tidak bisa dikirim, jadi tidak ada temuan yang terlewat. Rekap tidak memakai jadwal: semuanya dipicu oleh kegiatan di aplikasi (P2H dikirim, verifikasi, temuan ditutup), jadi tetap jalan walau server sempat tidur. Akibatnya, rekap "belum lengkap" baru keluar saat ada kegiatan berikutnya di site itu. Saat server bangun, sambungan dibuka lagi otomatis dari sesi di database (tanpa scan ulang). WhatsApp mencabut perangkat tertaut yang tidak online sekitar 14 hari; kalau aplikasi jarang dipakai, cek halaman Pengaturan sesekali.
