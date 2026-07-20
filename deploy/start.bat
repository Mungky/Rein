@echo off
REM Saklar ON R-Net. Dobel-klik = menu paket. Atau: start.bat semua / start.bat stream
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
echo.
pause
