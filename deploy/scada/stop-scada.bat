@echo off
REM Saklar OFF pemancar R-Net. Dobel-klik file ini.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-scada.ps1"
echo.
pause
