# ==========================================================================
#  start.ps1  -  Saklar ON R-Net (pilih paket)
# ==========================================================================
#  Pemakaian:
#    start.bat            -> menu (paket yang terpasang di PC ini)
#    start.bat semua      -> semua paket terpasang
#    start.bat stream     -> hanya STREAM ; juga: mirror / data (bisa gabung)
#
#  MODE TUNNEL:
#    - TUNNEL_TOKEN terisi  = PRODUKSI : satu named tunnel, alamat PERMANEN
#      (diatur di dashboard Cloudflare; tidak menyentuh database).
#    - TUNNEL_TOKEN kosong  = TES      : Quick Tunnel (URL acak tiap start);
#      alamat baru ditulis ke R-Net otomatis kalau kredensial Supabase diisi.
# ==========================================================================

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paket)

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib\common.ps1")
$P = Get-ReinPaths $Here

$installed = Get-InstalledPackages $P
if ($installed.Count -eq 0) { Die "Belum ada paket terpasang. Jalankan install.bat dulu." }

$sel = Select-Packages $Paket $installed "nyalakan"
if ($sel.Count -eq 0) { Warn "Tidak ada paket dipilih."; exit 0 }

$cfg = Read-Config $P.Config
$tunnelToken = Get-Cfg $cfg "TUNNEL_TOKEN"
$useNamed = [bool]$tunnelToken
$needTunnel = ($sel -contains "stream") -or ($sel -contains "mirror")

Info ("Menyalakan: " + (($sel | ForEach-Object { $_.ToUpper() }) -join " + "))
if ($needTunnel) {
    if ($useNamed) { Info "Tunnel: NAMED (produksi, alamat permanen)." }
    else           { Info "Tunnel: QUICK (mode tes, URL acak)." }
}

# ==========================================================================
#  Layanan lokal per paket
# ==========================================================================

# --- STREAM: MediaMTX -------------------------------------------------------
if ($sel -contains "stream") {
    if (-not (Test-Path $P.MediaMtxExe)) { Warn "mediamtx.exe tidak ada - lewati STREAM." }
    elseif (Get-Process mediamtx -ErrorAction SilentlyContinue) { Good "MediaMTX sudah jalan." }
    else {
        Start-Process -FilePath $P.MediaMtxExe -WorkingDirectory $P.MediaMtxDir `
            -RedirectStandardOutput (Join-Path $P.MediaMtxDir "log.txt") `
            -RedirectStandardError  (Join-Path $P.MediaMtxDir "err.txt") `
            -WindowStyle Hidden
        Good "MediaMTX dinyalakan (RTMP 127.0.0.1:1935 -> HLS 127.0.0.1:8888)."
    }
}

# --- MIRROR: TightVNC (mode aplikasi) + websocat ----------------------------
if ($sel -contains "mirror") {
    $svc = Get-Service tvnserver -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Warn "Service TightVNC sedang jalan - dipakai itu (membaca setting HKLM)."
    } elseif (Get-Process tvnserver -ErrorAction SilentlyContinue) {
        Good "TightVNC sudah jalan."
    } elseif (Test-Path $P.TvnExe) {
        Start-Process -FilePath $P.TvnExe -ArgumentList "-run" -WindowStyle Hidden
        Good "TightVNC dinyalakan (mode aplikasi - ikon di tray)."
    } else { Warn "TightVNC tidak ada - lewati MIRROR." }

    if (Test-Path $P.WebsocatExe) {
        if (Get-Process websocat -ErrorAction SilentlyContinue) { Good "websocat sudah jalan." }
        else {
            Start-Process -FilePath $P.WebsocatExe -WindowStyle Hidden -ArgumentList `
                "--binary", "ws-l:127.0.0.1:6080", "tcp:127.0.0.1:5900"
            Good "websocat dinyalakan (ws 127.0.0.1:6080 -> vnc 127.0.0.1:5900)."
        }
    }
}

# --- DATA: Mosquitto + Node-RED + bridge ------------------------------------
if ($sel -contains "data") {
    # Mosquitto
    if ((Test-Path $P.MosqConf) -and (Test-Path $P.MosqExe)) {
        if (Get-Process mosquitto -ErrorAction SilentlyContinue) { Good "Mosquitto sudah jalan." }
        else {
            Start-Process -FilePath $P.MosqExe -ArgumentList "-c", "`"$($P.MosqConf)`"" -WindowStyle Hidden
            Good "Mosquitto (broker MQTT) dinyalakan - port 1883."
        }
    } else { Warn "mosquitto.conf/exe tidak ada - lewati broker." }

    # Node-RED (jendela sendiri; tutup jendela = mati)
    if (Test-ProcessCommandLine "node.exe" "node-red") {
        Good "Node-RED sudah jalan (http://127.0.0.1:1880)."
    } elseif (Test-Path $P.NodeRedCmd) {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "title Node-RED (R-Net) & `"$($P.NodeRedCmd)`""
        Good "Node-RED dinyalakan - editor http://127.0.0.1:1880 (jendela terpisah)."
    } else { Warn "Node-RED belum terpasang - lewati." }

    # Bridge (jendela sendiri; membaca DATABASE_URL dari config.env)
    $runBridge = Join-Path $P.DataDir "run-bridge.ps1"
    if (Test-ProcessCommandLine "python.exe" "bridge\.py") {
        Good "Bridge sudah jalan."
    } elseif ((Test-Path $runBridge) -and (Get-Cfg $cfg "DATABASE_URL")) {
        Start-Process -FilePath "powershell.exe" -ArgumentList `
            "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$runBridge`""
        Good "Bridge dinyalakan (jendela terpisah - kurir broker -> database)."
    } elseif (-not (Get-Cfg $cfg "DATABASE_URL")) {
        Warn "DATABASE_URL kosong di config.env - bridge tidak dinyalakan."
    } else { Warn "run-bridge.ps1 tidak ada - lewati bridge." }
}

# ==========================================================================
#  Tunnel
# ==========================================================================
if ($needTunnel) {
    if (-not (Test-Path $P.Cloudflared)) { Warn "cloudflared.exe tidak ada - tunnel dilewati." }
    elseif ($useNamed) {
        # --- NAMED TUNNEL (produksi): satu proses melayani semua hostname -----
        # Ingress (hostname -> 127.0.0.1:8888 / :6080) diatur di dashboard
        # Cloudflare. Alamat permanen -> tidak perlu update database.
        if (Test-ProcessCommandLine "cloudflared.exe" "tunnel\s+run") {
            Good "Named tunnel sudah jalan."
        } else {
            $log = Join-Path (Split-Path -Parent $P.Cloudflared) "tunnel.log"
            Remove-Item $log -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $P.Cloudflared `
                -ArgumentList "tunnel", "run", "--token", $tunnelToken `
                -RedirectStandardError $log -WindowStyle Hidden
            Good "Named tunnel dinyalakan."
        }
        Write-Host ""
        Write-Host "=== R-NET SIAP (mode produksi) ===" -ForegroundColor Green
        if ($sel -contains "stream") {
            $h = Get-Cfg $cfg "STREAM_HOSTNAME"
            $sp = if (Get-Cfg $cfg "STREAM_PATH") { Get-Cfg $cfg "STREAM_PATH" } else { "scada" }
            if ($h) { Write-Host "Stream : https://$h/$sp/index.m3u8  (isi sekali di Kelola Screen)" }
            else    { Write-Host "Stream : atur ingress di dashboard Cloudflare -> http://localhost:8888" }
        }
        if ($sel -contains "mirror") {
            $h = Get-Cfg $cfg "MIRROR_HOSTNAME"
            if ($h) { Write-Host "Mirror : https://$h  (isi sekali di Kelola Screen sumber VNC)" }
            else    { Write-Host "Mirror : atur ingress di dashboard Cloudflare -> http://localhost:6080" }
        }
    }
    else {
        # --- QUICK TUNNEL (tes): URL acak per layanan + patch database --------
        $hasSup = (Get-Cfg $cfg "SUPABASE_URL") -and (Get-Cfg $cfg "SUPABASE_SERVICE_KEY")
        if ($sel -contains "stream") {
            $u = Start-QuickTunnel $P.Cloudflared 8888 "tunnel.log"
            $sp = if (Get-Cfg $cfg "STREAM_PATH") { Get-Cfg $cfg "STREAM_PATH" } else { "scada" }
            $streamUrl = "$u/$sp/index.m3u8"
            Good "Tunnel stream: $u"
            if ($hasSup) {
                Update-SupabaseStream $cfg $streamUrl (Get-Cfg $cfg "STREAM_NAME")
            } else {
                Warn "Tempel manual ke R-Net > Kelola Screen > URL HLS:"
                Write-Host "   $streamUrl" -ForegroundColor White
            }
        }
        if ($sel -contains "mirror") {
            $u = Start-QuickTunnel $P.Cloudflared 6080 "tunnel-vnc.log"
            Good "Tunnel mirror: $u"
            if ($hasSup) {
                Update-SupabaseVnc $cfg $u (Get-Cfg $cfg "VNC_SOURCE") (Get-Cfg $cfg "VNC_VIEW_PASSWORD")
            } else {
                Warn "Tempel manual ke R-Net > Kelola Screen > sumber VNC > Alamat:"
                Write-Host "   $u" -ForegroundColor White
            }
        }
    }
}

Show-ServiceStatus $P
Write-Host "Matikan: stop.bat (atau stop.bat <paket>)" -ForegroundColor DarkGray
