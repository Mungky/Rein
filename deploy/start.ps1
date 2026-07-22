# ==========================================================================
#  start.ps1  -  Saklar ON R-Net (pilih paket)
# ==========================================================================
#  Pemakaian:
#    start.bat            -> menu (paket yang terpasang di PC ini)
#    start.bat semua      -> semua paket terpasang
#    start.bat stream     -> hanya STREAM ; juga: mirror / data (bisa gabung)
#
#  TUNNEL:
#    Satu named tunnel Cloudflare melayani stream + mirror sekaligus. Alamatnya
#    PERMANEN (diatur di dashboard Cloudflare) dan diisi manual sekali saja di
#    R-Net > Kelola Screen -- saklar ini TIDAK PERNAH menyentuh database.
#    Tanpa TUNNEL_TOKEN di config.env, stream/mirror tidak bisa keluar internet.
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
$needTunnel = ($sel -contains "stream") -or ($sel -contains "mirror")

Info ("Menyalakan: " + (($sel | ForEach-Object { $_.ToUpper() }) -join " + "))

# Periksa bentuk token SEBELUM menyalakan apa pun. Kalau isinya ngawur, lebih
# baik bilang sekarang daripada membiarkan cloudflared gagal dengan pesannya
# sendiri yang tidak menunjuk ke config.env.
if ($needTunnel) {
    $why = Test-TunnelToken $tunnelToken
    if ($why) {
        $tunnelToken = ""
        Warn "TUNNEL_TOKEN di config.env tidak dipakai: $why"
        Warn "Stream/mirror hanya jalan LOKAL - tidak akan muncul di R-Net."
        Warn "Jalankan install.bat lagi untuk mengisi tokennya (docs\PANDUAN-TUNNEL.md)."
    }
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

    # Swa-uji hive: password TightVNC tersimpan di dua tempat terpisah (mode
    # aplikasi baca HKCU, mode service baca HKLM). Kalau hive milik mode yang
    # jalan kosong, koneksi ditolak "Server is not configured properly" -- dan
    # itu pesan dari sisi VNC, jauh dari sini. Beri tahu sekarang.
    $vncWhy = Test-VncReady
    if ($vncWhy) {
        Warn "MIRROR belum siap: $vncWhy"
        Warn "Perbaiki lewat kredensial.bat pilihan [S] (salin password antar hive)."
    }

    if (Test-Path $P.WebsocatExe) {
        if (Get-Process websocat -ErrorAction SilentlyContinue) { Good "websocat sudah jalan." }
        else {
            Start-Process -FilePath $P.WebsocatExe -WindowStyle Hidden -ArgumentList `
                "--binary", "ws-l:127.0.0.1:6080", "tcp:127.0.0.1:5900"
            Good "websocat dinyalakan (ws 127.0.0.1:6080 -> vnc 127.0.0.1:5900)."
        }
    }
}

# --- DATA: Node-RED + bridge ------------------------------------------------
# Broker MQTT ada di VPS - tidak ada yang dinyalakan di PC ini untuk itu.
if ($sel -contains "data") {
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
if ($needTunnel -and $tunnelToken) {
    if (-not (Test-Path $P.Cloudflared)) { Warn "cloudflared.exe tidak ada - tunnel dilewati." }
    else {
        # Satu proses cloudflared melayani SEMUA hostname. Ingress
        # (hostname -> 127.0.0.1:8888 / :6080) diatur di dashboard Cloudflare;
        # alamatnya permanen sehingga database R-Net tidak perlu disentuh.
        if (Test-ProcessCommandLine "cloudflared.exe" "tunnel\s+run") {
            Good "Named tunnel sudah jalan."
        } else {
            $log = Join-Path (Split-Path -Parent $P.Cloudflared) "tunnel.log"
            Remove-Item $log -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath $P.Cloudflared `
                -ArgumentList "tunnel", "run", "--token", $tunnelToken `
                -RedirectStandardError $log -WindowStyle Hidden
            # Jangan bilang "OK" sebelum tepi Cloudflare menerima koneksi -
            # token salah / internet mati harus ketahuan DI SINI, bukan nanti
            # waktu layar R-Net ternyata kosong.
            switch (Wait-TunnelUp $log) {
                "ok"    { Good "Named tunnel tersambung ke Cloudflare." }
                "token" { Warn "Tunnel DITOLAK Cloudflare - TUNNEL_TOKEN salah/kedaluwarsa."
                          Warn "Ambil token baru di dashboard, jalankan install.bat lagi." }
                default { Warn "Tunnel belum tersambung dalam 25 dtk. Cek internet;"
                          Warn "detailnya di $log" }
            }
        }
        Write-Host ""
        Write-Host "=== ALAMAT R-NET (isi di Kelola Screen, sekali saja) ===" -ForegroundColor Green
        # Hostname ikut diperiksa: mencetak "https://Server-Remula" (nama sumber
        # R-Net yang salah masuk kolom hostname) hanya menyesatkan penyalin.
        if ($sel -contains "stream") {
            $h = Get-Cfg $cfg "STREAM_HOSTNAME"
            $sp = if (Get-Cfg $cfg "STREAM_PATH") { Get-Cfg $cfg "STREAM_PATH" } else { "scada" }
            $why = Test-Hostname $h
            if (-not $why) { Write-Host "Stream : https://$h/$sp/index.m3u8" -ForegroundColor Cyan }
            else           { Write-Host "Stream : STREAM_HOSTNAME $why" -ForegroundColor Yellow }
        }
        if ($sel -contains "mirror") {
            $h = Get-Cfg $cfg "MIRROR_HOSTNAME"
            $why = Test-Hostname $h
            if (-not $why) { Write-Host "Mirror : https://$h" -ForegroundColor Cyan }
            else           { Write-Host "Mirror : MIRROR_HOSTNAME $why" -ForegroundColor Yellow }
        }
    }
}

Show-ServiceStatus $P
Write-Host "Matikan: stop.bat (atau stop.bat <paket>)" -ForegroundColor DarkGray
