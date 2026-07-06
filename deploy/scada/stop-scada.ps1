# stop-scada.ps1 - Saklar OFF pemancar R-Net. Mematikan MediaMTX + tunnel.
# OBS tidak disentuh (tutup sendiri kalau sudah selesai).
Get-Process mediamtx    -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "[OK] Pemancar R-Net dimatikan." -ForegroundColor Green
