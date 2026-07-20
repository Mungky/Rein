@echo off
REM Saklar OFF R-Net. Dobel-klik = menu paket. Atau: stop.bat semua / stop.bat data
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
echo.
pause
