# stop-scada.ps1 - Saklar OFF server R-Net. Mematikan MediaMTX + tunnel +
# Mosquitto (broker MQTT). OBS tidak disentuh (tutup sendiri kalau selesai).
Get-Process mediamtx    -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process mosquitto   -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "[OK] Server R-Net dimatikan (stream + tunnel + MQTT)." -ForegroundColor Green
