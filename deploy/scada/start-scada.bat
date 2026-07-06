@echo off
REM Saklar ON pemancar R-Net. Dobel-klik file ini.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-scada.ps1"
echo.
pause
