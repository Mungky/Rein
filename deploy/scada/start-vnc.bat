@echo off
REM Saklar ON sumber VNC R-Net (spion layar PC ini). Dobel-klik file ini.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-vnc.ps1"
echo.
pause
