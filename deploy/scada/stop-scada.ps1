# stop-scada.ps1 - Saklar OFF server R-Net. Mematikan MediaMTX + tunnel video
# (:8888) + Mosquitto (broker MQTT). OBS tidak disentuh (tutup sendiri kalau
# selesai); sumber VNC (tunnel :6080) punya saklar sendiri: stop-vnc.bat.
Get-Process mediamtx    -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match ":8888" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process mosquitto   -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "[OK] Server R-Net dimatikan (stream + tunnel + MQTT)." -ForegroundColor Green
