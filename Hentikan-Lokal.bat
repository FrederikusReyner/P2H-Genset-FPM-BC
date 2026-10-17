@echo off
title Hentikan P2H Genset uji coba
echo Menghentikan tampilan web, server, dan database uji coba...
powershell -NoProfile -Command "foreach($p in 5173,4000,5433){ Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { taskkill /PID $_ /T /F 2>$null | Out-Null } }"
taskkill /FI "WINDOWTITLE eq P2H - *" /T /F >nul 2>nul
echo.
echo Selesai. Data uji tetap tersimpan di backend\.devdb dan muncul lagi saat Jalankan-Lokal.bat dijalankan.
echo.
pause
