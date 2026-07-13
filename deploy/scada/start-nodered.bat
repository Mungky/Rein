@echo off
rem Saklar ON Node-RED (R-Net) - saklar manual, bukan service.
rem Tutup jendela ini (atau Ctrl+C) untuk mematikan Node-RED.
title Node-RED (R-Net)
echo Menyalakan Node-RED ...
echo Editor: http://127.0.0.1:1880
echo Tutup jendela ini untuk mematikan Node-RED.
echo.
where node-red >nul 2>nul
if %errorlevel%==0 (
    node-red
) else if exist "%APPDATA%\npm\node-red.cmd" (
    "%APPDATA%\npm\node-red.cmd"
) else (
    echo [GAGAL] Node-RED belum terpasang. Jalankan install.ps1 dan pilih komponen [3].
    pause
)
