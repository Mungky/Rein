@echo off
REM Saklar manual R-Net MQTT bridge untuk tes lokal (Windows).
REM Bukan service/autostart — jalan hanya selama jendela ini terbuka.
REM Tutup jendela atau tekan Ctrl+C untuk berhenti.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1"
pause
