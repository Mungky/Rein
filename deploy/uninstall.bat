@echo off
REM Uninstall R-Net dari PC ini (matikan + hapus program + opsional hapus config).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause
