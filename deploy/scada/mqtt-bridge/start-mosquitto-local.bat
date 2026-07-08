@echo off
REM Menyalakan Mosquitto untuk tes lokal (tanpa password, port 1883).
REM Biarkan jendela ini terbuka selama mengetes. Ctrl+C untuk berhenti.

set "MOSQ=C:\Program Files\mosquitto\mosquitto.exe"
if not exist "%MOSQ%" set "MOSQ=mosquitto"

echo === Mosquitto (tes lokal, tanpa password) ===
echo Biarkan jendela ini terbuka. Tekan Ctrl+C untuk berhenti.
echo.
"%MOSQ%" -c "%~dp0mosquitto-local-test.conf" -v
pause
