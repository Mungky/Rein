@echo off
REM Saklar OFF sumber VNC R-Net. Dobel-klik file ini.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-vnc.ps1"
echo.
pause
