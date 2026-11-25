# Kabar P2H ke grup WhatsApp

Supaya grup tidak terlalu ramai, yang dikirim hanya temuan, perbaikannya, dan **satu rekap ringkas semua site tiap akhir shift** (rekap per site per shift tidak dikirim lagi).

| Pesan | Kapan dikirim |
|---|---|
| **Temuan A / STOP AA** | Langsung saat P2H yang ada temuannya dikirim, satu pesan per P2H. Temuan A dan AA di P2H yang sama masuk dalam satu pesan; judulnya "STOP OPERASI" bila ada AA. P2H yang semua baik tidak dikabarkan. |
| **Temuan selesai** | Saat temuan ditutup di menu Temuan. Kalau itu temuan STOP terakhir di unit itu, judulnya "Boleh jalan lagi". |
| **Rekap akhir shift** | Sekali tiap shift berakhir (jam ganti shift di Pengaturan), satu pesan untuk semua site: jumlah P2H per site, unit STOP AA / temuan A, dan genset wajib (running / standby) yang belum P2H. Server memeriksa tiap 5 menit dan setiap ada P2H masuk, jadi kalau server sempat tidur, rekap shift terakhir tetap disusulkan. Shift yang berakhir sebelum grup dipilih tidak direkap. |

Aturan lain:

- Kalau P2H diubah dan muncul temuan baru, temuan itu dikabarkan juga.
- Status "Sedang diperbaiki" dan verifikasi pengawas tidak dikirim ke grup (tetap ada di aplikasi dan notifikasi HP).
- Form digital lain mengikuti aturan yang sama: bawaannya hanya temuan dan perbaikannya; kabar verifikasi bisa dinyalakan per form di **Kelola > Pengaturan form**.

Contoh rekap akhir shift:

```
📋 *Rekap P2H Genset · Shift I*
Selasa, 10 November 2026
P2H: 21/22 genset · terverifikasi 18

✅ Binungan 5/5
✅ Suaran 5/5 · 1 STOP
✅ Gurimbang 4/4 · 1 temuan
⏳ Lati 3/4
✅ Sambarata 4/4

🛑 STOP AA: GS-SUA-01
⚠️ Temuan A: GS-GRB-02
❌ Belum P2H: GS-LTI-04
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

Server gratis Render tidur setelah 15 menit tanpa pengunjung. Saat tidur, sambungan WhatsApp ikut tertutup, tetapi P2H juga tidak bisa dikirim, jadi tidak ada temuan yang terlewat. Kabar temuan dipicu oleh kegiatan di aplikasi (P2H dikirim, temuan ditutup). Rekap akhir shift diperiksa tiap 5 menit dan setiap ada P2H masuk, jadi bila server sempat tidur saat shift berakhir, rekapnya keluar begitu server bangun. Saat server bangun, sambungan dibuka lagi otomatis dari sesi di database (tanpa scan ulang). WhatsApp mencabut perangkat tertaut yang tidak online sekitar 14 hari; kalau aplikasi jarang dipakai, cek halaman Pengaturan sesekali.
