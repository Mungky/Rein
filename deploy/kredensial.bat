@echo off
REM ==========================================================================
REM  kredensial.bat - Perbaiki isian yang salah ketik (token, alamat, password).
REM  Tidak memasang/mengunduh apa pun. Langkah nyata ada di kredensial.ps1.
REM ==========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kredensial.ps1"
echo.
pause
