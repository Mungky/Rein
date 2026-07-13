@echo off
rem Pengaturan MQTT - buka UI pengaturan broker Mosquitto R-Net.
rem Dobel-klik file ini dari File Explorer.
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0mqtt-setting.ps1"
