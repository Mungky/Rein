# stop-vnc.ps1 - Saklar OFF sumber VNC. Mematikan TightVNC (mode aplikasi) +
# websocat + tunnel VNC (:6080). Tunnel video (:8888) di PC yang sama -
# kalau ada - tidak disentuh.
Get-Process tvnserver -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process websocat  -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match ":6080" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "[OK] Sumber VNC dimatikan (TightVNC + websocat + tunnel)." -ForegroundColor Green
