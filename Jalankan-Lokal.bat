@echo off
setlocal EnableExtensions
title P2H Genset - uji coba di komputer sendiri
cd /d "%~dp0"

set "DEMO=ASK"
set "SOPT="
if defined P2H_MIN set "SOPT=/min"
if /i "%~1"=="/demo" set "DEMO=YES"
if /i "%~1"=="/tanpa-demo" set "DEMO=NO"

echo ============================================================
echo   P2H GENSET - uji coba di komputer sendiri
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 goto oldnode
for /f "delims=" %%v in ('node --version') do echo Node.js terpasang: %%v

rem --- jangan jalan dua kali ---
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 4000,5173,5433 -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 goto sudahjalan

rem --- pemasangan paket (hanya pertama kali) ---
if not exist "backend\node_modules\" (
  echo.
  echo Memasang paket server. Pertama kali saja, sekitar 1-3 menit, perlu internet...
  pushd backend
  call npm install
  if errorlevel 1 ( popd & goto gagalpasang )
  popd
)
if not exist "frontend\node_modules\" (
  echo.
  echo Memasang paket tampilan web. Pertama kali saja, sekitar 1-3 menit...
  pushd frontend
  call npm install
  if errorlevel 1 ( popd & goto gagalpasang )
  popd
)

rem --- berkas pengaturan uji coba ---
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo Berkas pengaturan uji coba dibuat: backend\.env
)

set "FIRST=0"
if not exist "backend\.devdb\" set "FIRST=1"

echo.
echo [1/3] Menyalakan database uji...
start "P2H - Database" %SOPT% /D "%~dp0backend" cmd /k npm run dev:db
call :waitport 5433 180
if errorlevel 1 goto gagalstart

echo [2/3] Menyalakan server...
start "P2H - Server" %SOPT% /D "%~dp0backend" cmd /k npm run dev
call :waithealth
if errorlevel 1 goto gagalstart

if "%FIRST%"=="1" (
  if "%DEMO%"=="ASK" (
    echo.
    choice /c YT /n /m "Isi akun dan P2H contoh 7 hari supaya dashboard ramai? Y = ya, T = tidak: "
    if not errorlevel 2 set "DEMO=YES"
  )
  if "%DEMO%"=="YES" (
    echo Mengisi data contoh, sekitar 1-2 menit...
    pushd backend
    call npm run demo
    popd
  )
)

echo [3/3] Menyalakan tampilan web...
start "P2H - Web" %SOPT% /D "%~dp0frontend" cmd /k npm run dev
call :waitport 5173 90
if errorlevel 1 goto gagalstart

echo.
echo ============================================================
echo   SIAP. Membuka http://localhost:5173 di browser Anda.
echo ============================================================
echo.
echo   Masuk dengan No SID  : admin
echo   Password             : lihat ADMIN_PASSWORD di backend\.env (bawaan: GantiPasswordIni123)
echo.
echo   Kalau tadi memilih data contoh, ada juga akun: teknisi dan pengawas
echo   (site Suaran), password Demo12345.
echo.
echo   JANGAN tutup 3 jendela hitam (Database, Server, Web) selama dipakai.
echo   Untuk berhenti: jalankan Hentikan-Lokal.bat
echo.
if not defined P2H_NO_BROWSER start "" http://localhost:5173
pause
exit /b 0

:waitport
powershell -NoProfile -Command "$t=Get-Date; while(((Get-Date)-$t).TotalSeconds -lt %2){ try{ $c=New-Object Net.Sockets.TcpClient('localhost',%1); $c.Close(); exit 0 }catch{ Start-Sleep -Milliseconds 700 } }; exit 1"
exit /b %errorlevel%

:waithealth
powershell -NoProfile -Command "$t=Get-Date; while(((Get-Date)-$t).TotalSeconds -lt 120){ try{ $r=Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health; if($r.StatusCode -eq 200){ exit 0 } }catch{ Start-Sleep -Seconds 1 } }; exit 1"
exit /b %errorlevel%

:nonode
echo [GAGAL] Node.js belum terpasang.
echo Pasang dulu dari https://nodejs.org (pilih versi LTS), tutup jendela ini, lalu jalankan file ini lagi.
echo.
pause
exit /b 1

:oldnode
echo [GAGAL] Versi Node.js terlalu lama. Dibutuhkan versi 22 atau lebih baru (LTS).
echo Pasang yang terbaru dari https://nodejs.org lalu jalankan file ini lagi.
echo.
pause
exit /b 1

:sudahjalan
echo Sepertinya aplikasi uji coba sudah berjalan (port 4000, 5173, atau 5433 sedang dipakai).
echo - Buka http://localhost:5173 di browser, atau
echo - jalankan Hentikan-Lokal.bat dulu, lalu jalankan file ini lagi.
echo.
pause
exit /b 1

:gagalpasang
echo.
echo [GAGAL] Pemasangan paket tidak berhasil. Periksa sambungan internet lalu coba lagi.
echo.
pause
exit /b 1

:gagalstart
echo.
echo [GAGAL] Ada bagian yang belum menyala. Lihat pesan di jendela hitam yang terbuka
echo (Database / Server / Web), lalu coba lagi setelah Hentikan-Lokal.bat.
echo.
pause
exit /b 1
