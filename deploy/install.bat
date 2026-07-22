@echo off
REM ==========================================================================
REM  install.bat - Pemasang R-Net (pilih paket: stream / mirror / data).
REM  Dobel-klik = menu. Atau dari terminal:  install.bat stream data
REM  Semua langkah nyata ada di install.ps1 (bisa dibaca).
REM ==========================================================================
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Paket %*
)
echo.
pause
