# ==========================================================================
#  install.ps1  -  Pemasang R-Net untuk PC lokal (pilih paket, 1x jalan)
# ==========================================================================
#  Paket:
#    [1] STREAM - siaran layar/HMI : OBS + MediaMTX + Cloudflare Tunnel
#    [2] MIRROR - spion layar PC   : TightVNC + websocat (+ tunnel yang sama)
#    [3] DATA   - data sensor      : Node-RED + bridge (Python)
#                 Broker MQTT ada di VPS, TIDAK dipasang di PC ini.
#
#  Semua kredensial ditulis ke SATU file: C:\rein-scada\config.env
#  Setelah pasang: pakai start.bat / stop.bat / uninstall.bat di C:\rein-scada.
#
#  Keamanan:
#    - Hanya sumber resmi: github.com/bluenviron/mediamtx (SHA-256 dicetak),
#      github.com/cloudflare/cloudflared (tanda tangan Authenticode
#      diverifikasi), github.com/vi/websocat (SHA-256 dicetak), dan paket
#      winget resmi (Node.js/OBS/TightVNC/Python).
#    - TANPA autostart/service: semua hidup-mati lewat saklar start/stop.
#    - PC ini TIDAK PERNAH menulis ke database R-Net. Tidak ada service key
#      Supabase di sini; alamat stream/mirror diisi manual di Kelola Screen.
#    - TIDAK menimpa config yang sudah ada (mediamtx.yml / config.env /
#      password VNC). Aman dijalankan berulang.
# ==========================================================================

param(
    [string]$InstallDir = "C:\rein-scada",
    [switch]$Force,                        # unduh/pasang ulang walau sudah ada
    [string]$DomainRein = "https://rein.remula-inti.com",
    [string[]]$Paket                       # mis. -Paket stream,data (kosong = menu)
)

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib\common.ps1")
$P = Get-ReinPaths $InstallDir

Write-Host ""
Write-Host "==========================================================" -ForegroundColor White
Write-Host "  Pemasang R-Net - PC lokal" -ForegroundColor White
Write-Host "  Target folder: $InstallDir" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor White

# --- 0. Pilih paket ---------------------------------------------------------
$sel = Select-Packages $Paket @("stream", "mirror", "data") "pasang"
if ($sel.Count -eq 0) { Die "Tidak ada paket dipilih." }
$doStream = $sel -contains "stream"
$doMirror = $sel -contains "mirror"
$doData   = $sel -contains "data"
Info ("Paket dipilih: " + (($sel | ForEach-Object { $_.ToUpper() }) -join " + "))

# --- 0.5 Folder + kerangka config.env ---------------------------------------
foreach ($d in @($InstallDir, (Join-Path $InstallDir "lib"))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Sediakan config.env dari template LEBIH DULU, bukan di akhir: teknisi yang
# nanti membukanya menemukan file berkomentar lengkap (arti tiap kunci, contoh
# isian), bukan tumpukan baris polos. Nilai jawaban installer ditimpakan ke
# baris kosong template lewat Set-ConfigKey.
if (-not (Test-Path $P.Config)) {
    Copy-Item (Join-Path $Here "config.env.example") $P.Config -Force
    Good "config.env dibuat dari template."
}

# ==========================================================================
#  TUNNEL (dipakai STREAM & MIRROR) - cloudflared + token named tunnel
# ==========================================================================
if ($doStream -or $doMirror) {

# --- cloudflared.exe (verifikasi tanda tangan) ------------------------------
$CfDir = Split-Path -Parent $P.Cloudflared
if (-not (Test-Path $CfDir)) { New-Item -ItemType Directory -Path $CfDir -Force | Out-Null }
if ((Test-Path $P.Cloudflared) -and -not $Force) {
    Good "cloudflared.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
} else {
    Info "Mengunduh cloudflared terbaru dari github.com/cloudflare/cloudflared ..."
    $a = Get-LatestAsset "cloudflare/cloudflared" "^cloudflared-windows-amd64\.exe$"
    $tmp = Get-ToTemp $a.Url
    $sig = Get-AuthenticodeSignature $tmp
    if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "Cloudflare") {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Die "Tanda tangan digital cloudflared.exe TIDAK valid ($($sig.Status)). Dibatalkan demi keamanan."
    }
    Move-Item $tmp $P.Cloudflared -Force
    Good "cloudflared $($a.Version) terpasang. Tanda tangan: Cloudflare (Valid)."
}

# --- Token named tunnel -----------------------------------------------------
# R-Net produksi HANYA memakai named tunnel: alamat permanen, dan PC lapangan
# tidak pernah menulis apa pun ke database R-Net (tidak ada service key di sini).
$cfgNow = Read-Config $P.Config
$tokenNow = Get-Cfg $cfgNow "TUNNEL_TOKEN"
$tokenBad = if ($tokenNow) { Test-TunnelToken $tokenNow } else { "kosong" }
if ($tokenNow -and -not $tokenBad) {
    Good "TUNNEL_TOKEN sudah terisi di config.env."
} else {
    Write-Host ""
    if ($tokenNow) { Warn "TUNNEL_TOKEN yang tersimpan TIDAK SAH: $tokenBad" }
    Info "Named tunnel Cloudflare = pintu keluar internet PC ini. Alamat stream/"
    Info "mirror jadi PERMANEN, diisi SEKALI di R-Net > Kelola Screen."
    Info "Cara membuat tokennya: docs\PANDUAN-TUNNEL.md (5 menit, sekali per PC)."
    Write-Host ""
    Info "Ambil di: one.dash.cloudflare.com > Networks > Tunnels > pilih tunnel"
    Info "> Configure. Yang disalin adalah bagian 'eyJ...' yang panjang dari"
    Info "perintah 'cloudflared service install eyJ...' (bukan alamat hostname)."

    # Diberi 3 kesempatan: salah tempel itu lumrah (dashboard menampilkan token
    # di tengah perintah), dan lebih baik dibetulkan sekarang daripada gagal
    # nanti saat start.bat dengan pesan yang tidak menunjuk ke sini.
    $tok = ""
    for ($i = 1; $i -le 3; $i++) {
        $tok = Format-TunnelToken (Read-Host "   TUNNEL_TOKEN (Enter = isi nanti di config.env)")
        if (-not $tok) { break }
        $why = Test-TunnelToken $tok
        if (-not $why) { break }
        Warn "Token belum benar: $why"
        $tok = ""
        if ($i -eq 3) { Warn "Tiga kali belum cocok - dilewati dulu." }
    }

    Set-ConfigKey $P.Config "TUNNEL_TOKEN" $tok "[TUNNEL] Token named tunnel Cloudflare (docs\PANDUAN-TUNNEL.md)"
    if ($tok) {
        Good "Token tunnel tersimpan (bentuknya sah)."
    } else {
        Warn "TUNNEL_TOKEN kosong - stream/mirror belum bisa dipakai."
        Warn "Isi nanti di $($P.Config), lalu jalankan start.bat."
    }
}

# --- Hostname publik --------------------------------------------------------
# Ditanya terpisah dari token, bukan di dalam blok else di atas: PC yang
# tokennya sudah ada tapi hostname-nya belum (mis. mirror baru ditambahkan
# belakangan) harus tetap dilengkapi, bukan dilewati diam-diam.
function Read-HostnameKey([string]$cfgPath, [string]$key, [string]$judul, [string]$contoh, [string]$tujuan) {
    $ada = Get-Cfg (Read-Config $cfgPath) $key
    if ($ada -and -not (Test-Hostname $ada)) { return }
    Write-Host ""
    if ($ada) { Warn "$key yang tersimpan ('$ada') tidak sah: $(Test-Hostname $ada)" }
    Info "$judul - alamat internet yang kamu daftarkan di dashboard Cloudflare"
    Info "sebagai Public Hostname menuju $tujuan."
    Info "BUKAN nama sumber di R-Net. Contoh: $contoh"
    $val = ""
    for ($i = 1; $i -le 3; $i++) {
        $val = Format-Hostname (Read-Host "   $key (Enter = isi nanti di config.env)")
        if (-not $val) { break }
        $why = Test-Hostname $val
        if (-not $why) { break }
        Warn "Belum benar: $why"
        $val = ""
        if ($i -eq 3) { Warn "Tiga kali belum cocok - dilewati dulu." }
    }
    Set-ConfigKey $cfgPath $key $val "Hostname publik -> $tujuan (diatur di dashboard Cloudflare)"
    if ($val) { Good "$key = $val" }
}
if ($doStream) {
    Read-HostnameKey $P.Config "STREAM_HOSTNAME" "Hostname STREAM" `
        "stream-pabrik1.remula-inti.com" "http://localhost:8888"
}
if ($doMirror) {
    Read-HostnameKey $P.Config "MIRROR_HOSTNAME" "Hostname MIRROR" `
        "mirror-pabrik1.remula-inti.com" "http://localhost:6080"
}

# --- Buang sisa kredensial mode TES lama ------------------------------------
# Mode Quick Tunnel sudah dihapus. Config lama bisa masih menyimpan service key
# Supabase - itu kunci akses PENUH database, dan dulu dipakai menimpa alamat
# manual di Kelola Screen tiap start. Tidak boleh tertinggal di PC lapangan.
$stale = @("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "STREAM_NAME", "VNC_SOURCE")
$cfgNow = Read-Config $P.Config
if (@($stale | Where-Object { $cfgNow.ContainsKey($_) }).Count -gt 0) {
    Remove-ConfigKey $P.Config $stale
    Good "Sisa kredensial mode tes lama dibuang dari config.env (termasuk service key Supabase)."
}

} # akhir TUNNEL

# ==========================================================================
#  [1] STREAM - MediaMTX + mediamtx.yml + OBS
# ==========================================================================
if ($doStream) {

if (-not (Test-Path $P.MediaMtxDir)) { New-Item -ItemType Directory -Path $P.MediaMtxDir -Force | Out-Null }

# --- mediamtx.exe (zip resmi + hash dicetak) --------------------------------
if ((Test-Path $P.MediaMtxExe) -and -not $Force) {
    Good "mediamtx.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
} else {
    Info "Mengunduh MediaMTX terbaru dari github.com/bluenviron/mediamtx ..."
    $a = Get-LatestAsset "bluenviron/mediamtx" "windows_amd64\.zip$"
    $zip = Get-ToTemp $a.Url
    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash
    Info "   Sumber : $($a.Url)"
    Info "   SHA-256: $sha"
    $ex = Join-Path $env:TEMP ("rein_mtx_" + [guid]::NewGuid().ToString("N"))
    Expand-Archive -Path $zip -DestinationPath $ex -Force
    $found = Get-ChildItem -Path $ex -Recurse -Filter "mediamtx.exe" | Select-Object -First 1
    if (-not $found) { Die "mediamtx.exe tidak ada di dalam zip." }
    Move-Item $found.FullName $P.MediaMtxExe -Force
    Remove-Item $zip, $ex -Recurse -Force -ErrorAction SilentlyContinue
    Good "MediaMTX $($a.Version) terpasang."
}

# --- mediamtx.yml (jangan timpa) --------------------------------------------
if (Test-Path $P.MediaMtxYml) {
    Good "mediamtx.yml sudah ada - password lama dipertahankan (tidak ditimpa)."
} else {
    $tpl = Join-Path $Here "stream\mediamtx.yml"
    if (-not (Test-Path $tpl)) { Die "Template stream\mediamtx.yml tidak ada di folder installer." }
    Write-Host ""
    Info "Password pemancar (Enter = buat otomatis yang kuat):"
    $pPub = Read-Host "   Password OBS (publish)"
    if ([string]::IsNullOrWhiteSpace($pPub)) { $pPub = New-Pass; Write-Host "   -> dibuatkan: $pPub" }
    $pView = Read-Host "   Password penonton (viewer)"
    if ([string]::IsNullOrWhiteSpace($pView)) { $pView = New-Pass; Write-Host "   -> dibuatkan: $pView" }
    $yml = (Get-Content $tpl -Raw).
        Replace("https://GANTI_DOMAIN_REIN", $DomainRein).
        Replace("GANTI_DOMAIN_REIN", ($DomainRein -replace '^https?://','')).
        Replace("GANTI_PASSWORD_PUBLISH", $pPub).
        Replace("GANTI_PASSWORD_VIEWER", $pView)
    Write-TextNoBom $P.MediaMtxYml $yml
    Good "mediamtx.yml dibuat."
    Warn "CATAT password ini - publish untuk OBS, viewer untuk Kelola Screen R-Net."
}

if (-not (Get-Cfg (Read-Config $P.Config) "STREAM_PATH")) {
    Set-ConfigKey $P.Config "STREAM_PATH" "scada" "[STREAM] Path MediaMTX (default scada)"
}

# --- OBS Studio -------------------------------------------------------------
Write-Host ""
if ((Test-Path $P.ObsExe) -and -not $Force) {
    Good "OBS Studio sudah terpasang."
} else {
    Install-WingetPkg "OBSProject.OBSStudio" "OBS Studio" | Out-Null
}

} # akhir STREAM

# ==========================================================================
#  [2] MIRROR - TightVNC + websocat
# ==========================================================================
if ($doMirror) {
    Write-Host ""
    $vncView = $null

    # --- TightVNC Server (winget) -------------------------------------------
    if ((Test-Path $P.TvnExe) -and -not $Force) {
        Good "TightVNC sudah terpasang (lewati; pakai -Force untuk update)."
    } else {
        Install-WingetPkg "GlavSoft.TightVNC" "TightVNC" | Out-Null
    }

    if (Test-Path $P.TvnExe) {
        # Pemasang TightVNC mendaftarkan service autostart - nonaktifkan.
        # Saklar start menjalankan tvnserver mode aplikasi (tidak ada yang
        # hidup diam-diam).
        $svc = Get-Service tvnserver -ErrorAction SilentlyContinue
        if ($svc -and ($svc.StartType -ne "Manual" -or $svc.Status -eq "Running")) {
            try {
                Set-Service tvnserver -StartupType Manual -ErrorAction Stop
                Stop-Service tvnserver -Force -ErrorAction SilentlyContinue
                Good "Service TightVNC dinonaktifkan (dipakai mode aplikasi via saklar)."
            } catch {
                try {
                    Start-Process powershell -Verb RunAs -Wait -ArgumentList `
                        "-NoProfile", "-Command", "Set-Service tvnserver -StartupType Manual; Stop-Service tvnserver -Force"
                    Good "Service TightVNC dinonaktifkan (dipakai mode aplikasi via saklar)."
                } catch {
                    Warn "Gagal menonaktifkan service TightVNC. Jalankan manual sebagai Administrator:"
                    Warn "   Set-Service tvnserver -StartupType Manual; Stop-Service tvnserver"
                }
            }
        }

        # --- Password + akses jaringan ---------------------------------------
        # Fungsi VNC (enkripsi, potong 8 karakter, tulis HKCU + cermin HKLM)
        # ada di lib\common.ps1 -- dipakai bersama dengan kredensial.bat.
        $hasPass = [bool](Get-VncPassBytes "PasswordViewOnly")
        $ctrlEnc = $null
        $viewEnc = $null
        if ($hasPass -and -not $Force) {
            Good "Password TightVNC sudah diset - dipertahankan (ubah lewat kredensial.bat)."
            $ctrlEnc = Get-VncPassBytes "Password"
            $viewEnc = Get-VncPassBytes "PasswordViewOnly"
        } else {
            Write-Host ""
            Info "Password VNC (maks 8 karakter; Enter = buat otomatis):"
            $vncCtrl = Read-Host "   Password KONTROL (maintenance - JANGAN diisi ke R-Net)"
            if ([string]::IsNullOrWhiteSpace($vncCtrl)) { $vncCtrl = (New-Pass).Substring(0, 8); Write-Host "   -> dibuatkan: $vncCtrl" }
            $vncCtrl = Limit-VncPass $vncCtrl
            $vncView = Read-Host "   Password VIEW-ONLY (yang dipakai R-Net)"
            if ([string]::IsNullOrWhiteSpace($vncView)) { $vncView = (New-Pass).Substring(0, 8); Write-Host "   -> dibuatkan: $vncView" }
            $vncView = Limit-VncPass $vncView
            $ctrlEnc = ConvertTo-VncPass $vncCtrl
            $viewEnc = ConvertTo-VncPass $vncView
            Warn "CATAT keduanya. View-only untuk R-Net; kontrol untuk Anda sendiri."
        }
        Set-VncRegistry $ctrlEnc $viewEnc

        # Swa-uji: BUKTIKAN setelan mendarat di hive milik mode yang jalan.
        Write-Host ""
        Info "Swa-uji setelan TightVNC:"
        $svcNow = Get-Service tvnserver -ErrorAction SilentlyContinue
        $svcRun = ($svcNow -and $svcNow.Status -eq "Running")
        if ($svcRun) { Info "   Mode aktif: SERVICE  -> yang menentukan: hive HKLM" }
        else         { Info "   Mode aktif: APLIKASI -> yang menentukan: hive HKCU" }
        $hives = @(
            @{ Path = "HKCU:\Software\TightVNC\Server";             Label = "HKCU (mode aplikasi)"; Decisive = (-not $svcRun) },
            @{ Path = "HKLM:\SOFTWARE\TightVNC\Server";             Label = "HKLM 64-bit (service)"; Decisive = $svcRun },
            @{ Path = "HKLM:\SOFTWARE\WOW6432Node\TightVNC\Server"; Label = "HKLM 32-bit (service)"; Decisive = $svcRun }
        )
        $decisiveOk = $false
        foreach ($h in $hives) {
            $prop = Get-ItemProperty $h.Path -ErrorAction SilentlyContinue
            if (-not $prop) { Info "   $($h.Label): belum ada"; continue }
            $lengkap = $prop.Password -and $prop.PasswordViewOnly -and ($prop.AllowLoopback -eq 1)
            if ($lengkap) {
                Good "   $($h.Label): password + loopback OK"
                if ($h.Decisive) { $decisiveOk = $true }
            } else {
                Warn "   $($h.Label): BELUM lengkap (Primary=$(if ($prop.Password) { 'ada' } else { 'KOSONG' }), ViewOnly=$(if ($prop.PasswordViewOnly) { 'ada' } else { 'KOSONG' }), AllowLoopback=$($prop.AllowLoopback))"
            }
        }
        if (-not $decisiveOk) {
            Warn "BELUM SIAP: hive milik mode yang sedang jalan belum lengkap -"
            Warn "R-Net akan bilang 'Server is not configured properly'. Jalankan"
            Warn "ulang installer (setujui prompt Administrator) atau -Force."
        } else {
            Good "Sumber VNC siap."
        }
    }

    # --- websocat.exe (jembatan WebSocket <-> VNC) --------------------------
    $WsDir = Split-Path -Parent $P.WebsocatExe
    if (-not (Test-Path $WsDir)) { New-Item -ItemType Directory -Path $WsDir -Force | Out-Null }
    if ((Test-Path $P.WebsocatExe) -and -not $Force) {
        Good "websocat.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
    } else {
        Info "Mengunduh websocat terbaru dari github.com/vi/websocat ..."
        $a = Get-LatestAsset "vi/websocat" "^websocat\.x86_64-pc-windows-gnu\.exe$"
        $tmp = Get-ToTemp $a.Url
        $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
        Info "   Sumber : $($a.Url)"
        Info "   SHA-256: $sha"
        Move-Item $tmp $P.WebsocatExe -Force
        Good "websocat $($a.Version) terpasang."
    }

    # --- Password view-only ke config.env (untuk auto-connect R-Net) --------
    # Dicek lewat Get-Cfg (nilai terisi?), BUKAN "apakah barisnya ada": template
    # config.env sudah memuat baris VNC_VIEW_PASSWORD= yang kosong.
    if (-not (Get-Cfg (Read-Config $P.Config) "VNC_VIEW_PASSWORD")) {
        if (-not $vncView -and $viewEnc) {
            # Password lama dipertahankan? Baca balik dari registry supaya
            # config.env tidak pernah beda dengan server.
            $vncView = ConvertFrom-VncPass $viewEnc
            Info "Password view-only dibaca dari setelan TightVNC yang sudah ada."
        }
        Set-ConfigKey $P.Config "VNC_VIEW_PASSWORD" $(if ($vncView) { $vncView } else { "" }) `
            "[MIRROR] Password VIEW-ONLY TightVNC (utk auto-connect penonton R-Net)"
    }
}

# ==========================================================================
#  [3] DATA - Node-RED + bridge (Python). Broker MQTT ada di VPS.
# ==========================================================================
if ($doData) {
    Write-Host ""

    # Broker MQTT TIDAK dipasang di PC ini - brokernya ada di VPS supaya V-Box
    # mana pun bisa publish dari lokasi mana pun. PC ini cuma jadi Node-RED
    # (pengolah) + bridge (kurir broker -> database R-Net).

    # --- Node.js + Node-RED --------------------------------------------------
    Write-Host ""
    $NodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
    $NpmCmd  = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
    $haveNode = (Get-Command node -ErrorAction SilentlyContinue) -or (Test-Path $NodeExe)
    if ($haveNode) {
        Good "Node.js sudah terpasang."
    } else {
        Install-WingetPkg "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
        $haveNode = Test-Path $NodeExe
    }
    if ($haveNode) {
        if (-not (Test-Path $NpmCmd)) { $NpmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source }
        if (-not $NpmCmd) {
            Warn "npm tidak ditemukan - buka PowerShell BARU lalu jalankan: npm install -g node-red"
        } elseif ((Test-Path $P.NodeRedCmd) -and -not $Force) {
            Good "Node-RED sudah terpasang (lewati; pakai -Force untuk update)."
        } else {
            Info "Memasang Node-RED versi terbaru dari npm (butuh beberapa menit) ..."
            & $NpmCmd install -g --unsafe-perm node-red
            if ($LASTEXITCODE -eq 0) { Good "Node-RED terpasang." }
            else { Warn "npm install node-red gagal (kode $LASTEXITCODE) - coba manual: npm install -g node-red" }
        }
    }

    # --- Python + dependensi bridge ------------------------------------------
    Write-Host ""
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        Install-WingetPkg "Python.Python.3.12" "Python 3.12" | Out-Null
        # Sesi ini belum kenal PATH baru - segarkan dari registry.
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [Environment]::GetEnvironmentVariable("Path", "User")
        $py = Get-Command python -ErrorAction SilentlyContinue
    }
    if ($py) {
        Good "Python: $($py.Source)"
        Info "Memasang dependensi bridge (paho-mqtt + psycopg) ..."
        & $py.Source -m pip install --quiet -r (Join-Path $Here "data\requirements.txt")
        if ($LASTEXITCODE -eq 0) { Good "Dependensi bridge terpasang." }
        else { Warn "pip install gagal - jalankan manual: python -m pip install -r data\requirements.txt" }
    } else {
        Warn "Python belum tersedia di PATH. Tutup jendela ini, buka lagi, jalankan ulang installer."
    }

    # --- Salin file data (bridge + contoh flow Node-RED) ---------------------
    if (-not (Test-Path $P.DataDir)) { New-Item -ItemType Directory -Path $P.DataDir -Force | Out-Null }
    foreach ($f in @("bridge.py", "requirements.txt", "run-bridge.ps1")) {
        Copy-Item (Join-Path $Here "data\$f") (Join-Path $P.DataDir $f) -Force
    }
    if (Test-Path (Join-Path $Here "data\node-red")) {
        Copy-Item (Join-Path $Here "data\node-red") $P.DataDir -Recurse -Force
    }
    Good "File bridge + contoh flow Node-RED disalin ke $($P.DataDir)."

    # --- DATABASE_URL untuk bridge -------------------------------------------
    $cfgNow2 = Read-Config $P.Config
    if (-not (Get-Cfg $cfgNow2 "DATABASE_URL")) {
        Write-Host ""
        Info "Alamat database R-Net untuk BRIDGE (kurir broker -> database cloud)."
        Info "Format: postgresql://user:password@host:6543/postgres"
        $dbUrl = Read-Host "   DATABASE_URL (Enter = isi nanti di config.env)"
        Set-ConfigKey $P.Config "DATABASE_URL" $dbUrl.Trim() "[DATA] Alamat database R-Net untuk bridge"
        if ([string]::IsNullOrWhiteSpace($dbUrl)) {
            Warn "DATABASE_URL kosong - bridge belum bisa jalan. Isi di $($P.Config)."
        }
    }

    # --- Catatan broker VPS ---------------------------------------------------
    # CATATAN SAJA, tidak dipakai otomatis oleh skrip mana pun: bridge membaca
    # daftar broker dari tabel Site di R-Net, dan Node-RED disetel dari
    # editornya sendiri. Ditulis di sini supaya teknisi di lokasi tidak perlu
    # mencari-cari alamat broker waktu menyetel node MQTT di Node-RED.
    $cfgNow3 = Read-Config $P.Config
    if (-not (Get-Cfg $cfgNow3 "MQTT_HOST")) {
        Write-Host ""
        Info "Broker MQTT ada di VPS (bukan di PC ini). Isi sebagai CATATAN untuk"
        Info "menyetel node MQTT di Node-RED nanti - Enter kalau belum tahu."
        $mqHost = (Read-Host "   MQTT_HOST - alamat broker VPS (mis. mqtt.remula.online)").Trim()
        $mqPort = (Read-Host "   MQTT_PORT (Enter = 8883, TLS)").Trim()
        if (-not $mqPort) { $mqPort = "8883" }
        $mqUser = (Read-Host "   MQTT_USERNAME").Trim()
        Set-ConfigKey $P.Config "MQTT_HOST" $mqHost "[DATA] Broker MQTT di VPS - CATATAN untuk menyetel Node-RED (tidak dibaca skrip)"
        Set-ConfigKey $P.Config "MQTT_PORT" $mqPort
        Set-ConfigKey $P.Config "MQTT_USERNAME" $mqUser
    }
}

# ==========================================================================
#  Saklar + lib (selalu diperbarui ke versi terbaru)
# ==========================================================================
foreach ($f in @("start.ps1", "stop.ps1", "uninstall.ps1", "kredensial.ps1",
                 "start.bat", "stop.bat", "uninstall.bat", "kredensial.bat")) {
    Copy-Item (Join-Path $Here $f) (Join-Path $InstallDir $f) -Force
}
Copy-Item (Join-Path $Here "lib\common.ps1") (Join-Path $InstallDir "lib\common.ps1") -Force
Good "Saklar start/stop/uninstall terpasang di $InstallDir."

# --- Selesai ----------------------------------------------------------------
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SELESAI. Semua kredensial: $InstallDir\config.env" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Nyalakan : dobel-klik $InstallDir\start.bat"
Write-Host "  Matikan  : dobel-klik $InstallDir\stop.bat"
Write-Host "  Salah isi: dobel-klik $InstallDir\kredensial.bat"
Write-Host "  Hapus    : dobel-klik $InstallDir\uninstall.bat"
Write-Host ""

# --- Alamat siap tempel ke R-Net --------------------------------------------
# PC ini tidak menulis ke database R-Net, jadi langkah terakhir SELALU manual.
# Cetak alamat lengkapnya di sini supaya tidak ada yang perlu dikarang sendiri.
if ($doStream -or $doMirror) {
    $cfgEnd  = Read-Config $P.Config
    $sHostEnd = Get-Cfg $cfgEnd "STREAM_HOSTNAME"
    $mHostEnd = Get-Cfg $cfgEnd "MIRROR_HOSTNAME"
    $pathEnd  = if (Get-Cfg $cfgEnd "STREAM_PATH") { Get-Cfg $cfgEnd "STREAM_PATH" } else { "scada" }
    Write-Host "  ----------------------------------------------------------"
    Write-Host "  ISI DI R-NET > Kelola Screen (SEKALI SAJA, alamat permanen):" -ForegroundColor White
    if ($doStream) {
        if (-not (Test-Hostname $sHostEnd)) { Write-Host "    Sumber Stream > URL HLS :  https://$sHostEnd/$pathEnd/index.m3u8" -ForegroundColor Cyan }
        else { Write-Host "    Sumber Stream > URL HLS :  (STREAM_HOSTNAME belum benar di config.env)" -ForegroundColor Yellow }
        Write-Host "    + Username/Password viewer MediaMTX yang dicatat di atas."
    }
    if ($doMirror) {
        if (-not (Test-Hostname $mHostEnd)) { Write-Host "    Sumber VNC    > Alamat  :  https://$mHostEnd" -ForegroundColor Cyan }
        else { Write-Host "    Sumber VNC    > Alamat  :  (MIRROR_HOSTNAME belum benar di config.env)" -ForegroundColor Yellow }
        Write-Host "    + Password VIEW-ONLY VNC (R-Net mengubah https:// jadi wss:// sendiri)."
    }
    Write-Host "  Pastikan hostname di atas sudah dibuat di dashboard Cloudflare:"
    if ($doStream) { Write-Host "    $sHostEnd -> HTTP localhost:8888" }
    if ($doMirror) { Write-Host "    $mHostEnd -> HTTP localhost:6080" }
    Write-Host "  ----------------------------------------------------------"
    Write-Host ""
}

if ($doStream) {
    Write-Host "  STREAM - setelan OBS (sekali saja):"
    Write-Host "    Settings > Stream : Custom | Server rtmp://127.0.0.1:1935"
    Write-Host "    Stream Key        : scada?user=obs&pass=<password publish>"
    Write-Host "    Output > Streaming > Keyframe Interval: 1 s  (WAJIB)"
    Write-Host ""
}
if ($doMirror) {
    Write-Host "  MIRROR: buka browser cloud SCADA di PC ini + login, lalu start.bat."
    Write-Host ""
}
if ($doData) {
    Write-Host "  DATA (broker MQTT ada di VPS, bukan di PC ini):"
    Write-Host "    - Daftarkan broker VPS di R-Net > Data > Kelola Site"
    Write-Host "      (host/port/akun broker VPS) - dari situ bridge membacanya."
    Write-Host "    - Node-RED editor: http://127.0.0.1:1880 (setelah start.bat)"
    Write-Host "      Node MQTT diarahkan ke broker VPS, bukan localhost."
    Write-Host ""
}
Write-Host "  Panduan: folder docs\ (PANDUAN-RNET.md, PANDUAN-TUNNEL.md, PANDUAN-NODE-RED.md)"
Write-Host ""
