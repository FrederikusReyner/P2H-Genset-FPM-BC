@echo off
setlocal EnableExtensions
title P2H Genset - buat kunci rahasia
cd /d "%~dp0backend"

where node >nul 2>nul
if errorlevel 1 goto nonode
if exist "node_modules\web-push\" goto adapaket
echo Memasang paket, pertama kali saja. Perlu internet...
call npm install
if errorlevel 1 goto gagalpasang

:adapaket
set "TMPF=%TEMP%\p2h-kunci-%RANDOM%.txt"
call npm run keys --silent > "%TMPF%"
echo.
type "%TMPF%"
echo.
echo PENTING: kunci ini RAHASIA. Simpan di tempat aman, misalnya Notepad di komputer Anda.
echo JANGAN dikirim ke grup, JANGAN diunggah ke GitHub.
echo Tidak ada berkas kunci yang disimpan di folder proyek.
echo.
choice /c YT /n /m "Salin tiga baris kunci ke clipboard supaya bisa ditempel? Y = ya, T = tidak: "
if errorlevel 2 goto selesai
findstr /b /c:"JWT_SECRET=" /c:"VAPID_PUBLIC_KEY=" /c:"VAPID_PRIVATE_KEY=" "%TMPF%" | clip
echo Tersalin. Tempel dengan Ctrl+V ke Notepad, lalu simpan.

:selesai
del "%TMPF%" >nul 2>nul
echo.
pause
exit /b 0

:nonode
echo [GAGAL] Node.js belum terpasang. Pasang dulu dari https://nodejs.org, pilih versi LTS.
echo.
pause
exit /b 1

:gagalpasang
echo.
echo [GAGAL] Pemasangan paket tidak berhasil. Periksa sambungan internet lalu coba lagi.
echo.
pause
exit /b 1
