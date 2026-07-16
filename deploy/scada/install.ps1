# ==========================================================================
#  install.ps1  -  Pemasang universal server R-Net
#                  (MediaMTX + Cloudflare Tunnel + Mosquitto + Node-RED + OBS
#                   + Sumber VNC)
# ==========================================================================
#  Satu perintah untuk menyiapkan komputer server/pemancar mana pun:
#    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#
#  Yang dilakukan:
#    1. Menanyakan KOMPONEN mana saja yang mau dipasang:
#         [1] MediaMTX + Cloudflare Tunnel  (pemancar video - inti R-Net)
#         [2] Mosquitto                     (broker MQTT - data sensor V-Box)
#         [3] Node-RED                      (otomasi alur data / gateway PLC)
#         [4] OBS Studio                    (sumber siaran layar)
#         [5] Sumber VNC                    (spion layar PC ini -> channel
#                                            "VNC (Layar PC)" di R-Net)
#    2. Semua komponen dipasang VERSI TERBARU:
#         - MediaMTX & cloudflared : rilis terbaru GitHub resmi (cloudflared
#           diverifikasi tanda tangan Authenticode; MediaMTX dicetak SHA-256)
#         - Mosquitto, Node.js, OBS, TightVNC: lewat winget (repositori resmi
#           Microsoft; hash diverifikasi otomatis oleh winget)
#         - Node-RED               : versi terbaru dari npm
#         - websocat               : rilis terbaru GitHub resmi (SHA-256 dicetak)
#    3. Membuat mediamtx.yml + config.env (menanyakan/meng-generate password)
#    4. Menyalin saklar start/stop + "Pengaturan MQTT.bat" (UI pengaturan
#       broker — dobel-klik dari File Explorer, tidak perlu edit file config)
#
#  JAMINAN KEAMANAN:
#    - Hanya sumber resmi: github.com/bluenviron/mediamtx,
#      github.com/cloudflare/cloudflared, dan paket winget resmi
#      (EclipseFoundation.Mosquitto, OpenJS.NodeJS.LTS, OBSProject.OBSStudio).
#    - Tanpa autostart/service: SEMUA dinyalakan/dimatikan hanya lewat saklar
#      start-scada / stop-scada / start-nodered (service Mosquitto disetel
#      Manual).
#    - TIDAK menimpa mediamtx.yml / config.env / mosquitto.conf yang sudah
#      ada. Unduhan ke file sementara dulu, dipindah setelah lolos verifikasi.
#    - Aman dijalankan berulang (idempoten).
# ==========================================================================

param(
    [string]$InstallDir = "C:\rein-scada",
    [switch]$Force,                        # unduh/pasang ulang walau sudah ada
    [string]$DomainRein = "https://rein.remula-inti.com"
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Good($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[GAGAL] $m" -ForegroundColor Red; exit 1 }

# Tulis file UTF-8 TANPA BOM. PENTING: Set-Content -Encoding UTF8 di PowerShell
# 5.1 menambahkan BOM, dan BOM membuat MediaMTX gagal parse mediamtx.yml
# (ERR "value is not allowed in this context"). Selalu pakai ini untuk config.
function Write-TextNoBom($path, $text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($path, $text, $enc)
}

function New-Pass { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ }) }

# --- Helper: winget (repositori paket resmi Microsoft) --------------------
$HasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
function Install-WingetPkg($id, $label) {
    Info "Memasang $label versi terbaru lewat winget ..."
    & winget install --id $id --exact --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -eq 0) { Good "$label terpasang."; return $true }
    # -1978335189 = "sudah terpasang & sudah versi terbaru" — bukan error.
    if ($LASTEXITCODE -eq -1978335189) { Good "$label sudah versi terbaru."; return $true }
    Warn "winget gagal memasang $label (kode $LASTEXITCODE)."
    return $false
}

# --- Helper: cari aset rilis terbaru di GitHub ---------------------------
function Get-LatestAsset($repo, $pattern) {
    $api = "https://api.github.com/repos/$repo/releases/latest"
    try {
        $rel = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "rein-scada-installer" } -TimeoutSec 30
    } catch {
        Die "Gagal menghubungi GitHub untuk $repo. Cek internet. ($($_.Exception.Message))"
    }
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { Die "Tidak menemukan file '$pattern' di rilis terbaru $repo." }
    return [pscustomobject]@{ Url = $asset.browser_download_url; Name = $asset.name; Version = $rel.tag_name }
}

# --- Helper: unduh ke file sementara (anti-corrupt) ----------------------
function Get-ToTemp($url) {
    $tmp = Join-Path $env:TEMP ("rein_" + [guid]::NewGuid().ToString("N") + [IO.Path]::GetExtension($url))
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 300
    if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) { Die "Unduhan kosong: $url" }
    return $tmp
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor White
Write-Host "  Pemasang server R-Net (universal)" -ForegroundColor White
Write-Host "  Target folder: $InstallDir" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor White
Write-Host ""

# --- 0. Pilih komponen -----------------------------------------------------
Write-Host "Komponen yang tersedia:" -ForegroundColor White
Write-Host "  [1] MediaMTX + Cloudflare Tunnel  - pemancar video (inti R-Net)"
Write-Host "  [2] Mosquitto (broker MQTT)       - terima data sensor V-Box"
Write-Host "  [3] Node-RED                      - otomasi alur data / gateway PLC"
Write-Host "  [4] OBS Studio                    - sumber siaran layar"
Write-Host "  [5] Sumber VNC (TightVNC+websocat)- spion layar PC ini utk channel R-Net"
Write-Host ""
$pick = Read-Host "Pilih yang mau dipasang (mis. 1,2,4 - Enter = 1 saja)"
if ([string]::IsNullOrWhiteSpace($pick)) { $pick = "1" }
$sel = $pick -split "[,; ]+" | Where-Object { $_ } | ForEach-Object { $_.Trim() }
$doStream  = $sel -contains "1"
$doMqtt    = $sel -contains "2"
$doNodeRed = $sel -contains "3"
$doObs     = $sel -contains "4"
$doVnc     = $sel -contains "5"
if (-not ($doStream -or $doMqtt -or $doNodeRed -or $doObs -or $doVnc)) { Die "Tidak ada komponen valid yang dipilih." }

if (($doMqtt -or $doNodeRed -or $doObs -or $doVnc) -and -not $HasWinget) {
    Warn "winget tidak ditemukan di PC ini. Mosquitto/Node-RED/OBS/TightVNC butuh winget"
    Warn "(bawaan Windows 10/11 terbaru - update 'App Installer' dari Microsoft Store)."
}

# --- 0.5 Folder -------------------------------------------------------------
$MediaMtxDir    = Join-Path $InstallDir "mediamtx"
$CloudflaredDir = Join-Path $InstallDir "cloudflared"
foreach ($d in @($InstallDir, $MediaMtxDir, $CloudflaredDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Good "Folder siap."

# ==========================================================================
#  [1] MediaMTX + Cloudflare Tunnel
#      (cloudflared & config.env juga dipakai komponen [5] Sumber VNC)
# ==========================================================================
if ($doStream -or $doVnc) {

# --- 1a. cloudflared.exe (dengan verifikasi tanda tangan) -----------------
$CfExe = Join-Path $CloudflaredDir "cloudflared.exe"
if ((Test-Path $CfExe) -and -not $Force) {
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
    Move-Item $tmp $CfExe -Force
    Good "cloudflared $($a.Version) terpasang. Tanda tangan: Cloudflare (Valid)."
}

} # akhir blok cloudflared (dipakai [1] & [5])

if ($doStream) {

# --- 1b. mediamtx.exe (dari zip resmi + tampilkan hash) --------------------
$MtxExe = Join-Path $MediaMtxDir "mediamtx.exe"
if ((Test-Path $MtxExe) -and -not $Force) {
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
    Move-Item $found.FullName $MtxExe -Force
    Remove-Item $zip, $ex -Recurse -Force -ErrorAction SilentlyContinue
    Good "MediaMTX $($a.Version) terpasang."
}

# --- 1c. mediamtx.yml (jangan timpa kalau sudah ada) -----------------------
$MtxYml = Join-Path $MediaMtxDir "mediamtx.yml"
if (Test-Path $MtxYml) {
    Good "mediamtx.yml sudah ada - password lama dipertahankan (tidak ditimpa)."
} else {
    $tpl = Join-Path $Here "mediamtx.yml"
    if (-not (Test-Path $tpl)) { Die "Template mediamtx.yml tidak ada di folder installer." }

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
    Write-TextNoBom $MtxYml $yml
    Good "mediamtx.yml dibuat."
    Warn "CATAT password ini - dipakai di OBS (publish) & dialog Kelola Stream R-Net (viewer)."
}

} # akhir [1] MediaMTX

# --- 1d. config.env (RAHASIA; jangan timpa) - dipakai [1] & [5] ------------
if ($doStream -or $doVnc) {
$Cfg = Join-Path $InstallDir "config.env"
if (Test-Path $Cfg) {
    Good "config.env sudah ada - kredensial lama dipertahankan (tidak ditimpa)."
} else {
    Write-Host ""
    Info "Kredensial Supabase (untuk update alamat stream/channel otomatis)."
    Info "Kosongkan keduanya kalau mau tempel alamat manual saja."
    $sUrl = Read-Host "   SUPABASE_URL (mis. https://xxxx.supabase.co)"
    $sKey = Read-Host "   SUPABASE_SERVICE_KEY (service_role)"
    if ([string]::IsNullOrWhiteSpace($sUrl)) { $sUrl = "GANTI_DENGAN_URL_SUPABASE" }
    if ([string]::IsNullOrWhiteSpace($sKey)) { $sKey = "GANTI_DENGAN_SERVICE_ROLE_KEY" }
    $sName = ""
    if ($doStream) {
        Write-Host ""
        Info "Nama stream milik MESIN INI (harus PERSIS sama dengan nama di"
        Info "R-Net > Channel > Sumber Stream). WAJIB diisi kalau ada lebih dari"
        Info "satu mesin siaran - tanpa ini mesin-mesin akan saling menimpa alamat."
        $sName = Read-Host "   STREAM_NAME (mis. Line Server; kosong = mode 1 mesin)"
    }
    Write-TextNoBom $Cfg (@(
        "# config.env - RAHASIA, jangan kirim ke Git/orang lain.",
        "SUPABASE_URL=$sUrl",
        "SUPABASE_SERVICE_KEY=$sKey",
        "# Nama stream yang alamatnya di-update mesin ini (kosong = semua).",
        "STREAM_NAME=$sName",
        "# Path MediaMTX untuk stream ini (default scada).",
        "STREAM_PATH=scada"
    ) -join "`r`n")
    Good "config.env dibuat."
}
} # akhir config.env

# ==========================================================================
#  [2] Mosquitto (broker MQTT) - untuk data sensor V-Box
# ==========================================================================
if ($doMqtt) {
    $MqDir  = Join-Path $InstallDir "mosquitto"
    $MqConf = Join-Path $MqDir "mosquitto.conf"
    $MqExe  = Join-Path $env:ProgramFiles "mosquitto\mosquitto.exe"
    if (-not (Test-Path $MqDir)) { New-Item -ItemType Directory -Path $MqDir -Force | Out-Null }

    Write-Host ""
    if ((Test-Path $MqExe) -and -not $Force) {
        Good "Mosquitto sudah terpasang (lewati; pakai -Force untuk update)."
    } elseif ($HasWinget) {
        Install-WingetPkg "EclipseFoundation.Mosquitto" "Mosquitto" | Out-Null
    } else {
        Warn "Lewati Mosquitto - pasang manual dari https://mosquitto.org/download lalu jalankan ulang installer ini."
    }

    if (Test-Path $MqExe) {
        # Jangan biarkan service bawaan autostart - saklar kita yang pegang.
        try { Set-Service mosquitto -StartupType Manual -ErrorAction Stop; Stop-Service mosquitto -ErrorAction SilentlyContinue } catch {}

        if (Test-Path $MqConf) {
            Good "mosquitto.conf sudah ada - kredensial lama dipertahankan."
            Info "Mau ubah port/akun? Dobel-klik '$InstallDir\Pengaturan MQTT.bat'."
        } else {
            Write-Host ""
            Info "Akun MQTT untuk V-Box/bridge (Enter = buat otomatis):"
            $mqUser = Read-Host "   Username MQTT"
            if ([string]::IsNullOrWhiteSpace($mqUser)) { $mqUser = "vbox" ; Write-Host "   -> dipakai: vbox" }
            $mqPass = Read-Host "   Password MQTT"
            if ([string]::IsNullOrWhiteSpace($mqPass)) { $mqPass = New-Pass; Write-Host "   -> dibuatkan: $mqPass" }

            $MqPasswd = Join-Path $MqDir "passwd"
            & (Join-Path $env:ProgramFiles "mosquitto\mosquitto_passwd.exe") -b -c $MqPasswd $mqUser $mqPass
            if ($LASTEXITCODE -ne 0) { Warn "mosquitto_passwd gagal - cek manual." }

            Write-TextNoBom $MqConf (@(
                "# mosquitto.conf - broker MQTT R-Net (dibuat installer)",
                "# Ubah lewat 'Pengaturan MQTT.bat' - tidak perlu edit file ini manual.",
                "# Dinyalakan oleh start-scada.ps1, dimatikan oleh stop-scada.ps1.",
                "listener 1883 0.0.0.0",
                "allow_anonymous false",
                "password_file $MqPasswd",
                "persistence false",
                "log_dest file $(Join-Path $MqDir 'mosquitto.log')",
                "log_type error",
                "log_type warning"
            ) -join "`r`n")
            Good "mosquitto.conf dibuat (port 1883, wajib login)."
            Warn "CATAT akun MQTT ini - dipakai di V-Net (publish). Bisa dilihat/diubah"
            Warn "kapan pun lewat '$InstallDir\Pengaturan MQTT.bat'."
        }

        # Buka port 1883 untuk V-Box di jaringan lokal (perlu Administrator).
        try {
            $ruleName = "R-Net MQTT 1883"
            $exists = netsh advfirewall firewall show rule name="$ruleName" 2>$null | Select-String $ruleName
            if (-not $exists) {
                Start-Process netsh -ArgumentList "advfirewall firewall add rule name=`"$ruleName`" dir=in action=allow protocol=TCP localport=1883" -Verb RunAs -Wait
                Good "Firewall: port 1883 dibuka (aturan '$ruleName')."
            } else {
                Good "Firewall: aturan port 1883 sudah ada."
            }
        } catch {
            Warn "Gagal membuka firewall otomatis - buka port TCP 1883 manual bila V-Box tidak bisa konek."
        }
    }
}

# ==========================================================================
#  [3] Node-RED (otomasi alur data) - Node.js LTS + npm install -g node-red
# ==========================================================================
if ($doNodeRed) {
    Write-Host ""
    $NodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
    $NpmCmd  = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
    $haveNode = (Get-Command node -ErrorAction SilentlyContinue) -or (Test-Path $NodeExe)

    if ($haveNode) {
        Good "Node.js sudah terpasang."
    } elseif ($HasWinget) {
        Install-WingetPkg "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
        $haveNode = Test-Path $NodeExe
    } else {
        Warn "Node.js belum ada dan winget tidak tersedia - pasang manual dari https://nodejs.org."
    }

    if ($haveNode) {
        # PATH sesi ini belum kenal instalasi baru - pakai path lengkap npm.
        if (-not (Test-Path $NpmCmd)) { $NpmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source }
        if (-not $NpmCmd) {
            Warn "npm tidak ditemukan - buka PowerShell BARU lalu jalankan: npm install -g node-red"
        } else {
            $NodeRedCmd = Join-Path $env:APPDATA "npm\node-red.cmd"
            if ((Test-Path $NodeRedCmd) -and -not $Force) {
                Good "Node-RED sudah terpasang (lewati; pakai -Force untuk update)."
            } else {
                Info "Memasang Node-RED versi terbaru dari npm (butuh beberapa menit) ..."
                & $NpmCmd install -g --unsafe-perm node-red
                if ($LASTEXITCODE -eq 0) { Good "Node-RED terpasang." }
                else { Warn "npm install node-red gagal (kode $LASTEXITCODE) - coba manual: npm install -g node-red" }
            }
        }
    }
}

# ==========================================================================
#  [4] OBS Studio (sumber siaran layar)
# ==========================================================================
if ($doObs) {
    Write-Host ""
    $ObsExe = Join-Path $env:ProgramFiles "obs-studio\bin\64bit\obs64.exe"
    if ((Test-Path $ObsExe) -and -not $Force) {
        Good "OBS Studio sudah terpasang (lewati; pakai -Force untuk update)."
    } elseif ($HasWinget) {
        Install-WingetPkg "OBSProject.OBSStudio" "OBS Studio" | Out-Null
    } else {
        Info "winget tidak ada - mengunduh OBS terbaru dari github.com/obsproject/obs-studio ..."
        $a = Get-LatestAsset "obsproject/obs-studio" "Windows.*Installer\.exe$"
        $tmp = Get-ToTemp $a.Url
        $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
        Info "   SHA-256: $sha"
        Info "Menjalankan pemasang OBS (butuh persetujuan Administrator sekali) ..."
        try {
            Start-Process -FilePath $tmp -ArgumentList "/S" -Verb RunAs -Wait
            if (Test-Path $ObsExe) { Good "OBS Studio $($a.Version) terpasang." }
        } catch {
            Warn "Pemasangan OBS dibatalkan/gagal: $($_.Exception.Message)"
        }
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# ==========================================================================
#  [5] Sumber VNC (spion layar PC ini) - TightVNC + websocat
# ==========================================================================
#  Layar PC ini dipantulkan view-only ke channel R-Net jenis "VNC (Layar PC)".
#  TightVNC dijalankan MODE APLIKASI lewat saklar start-vnc (bukan service);
#  websocat menjembatani WebSocket 6080 -> VNC 5900; Quick Tunnel yang sama
#  dengan jalur video mengeksposnya sebagai wss:// tanpa buka port router.
if ($doVnc) {
    Write-Host ""
    $vncView = $null

    # --- 5a. TightVNC Server (winget) --------------------------------------
    $TvnExe = Join-Path $env:ProgramFiles "TightVNC\tvnserver.exe"
    if ((Test-Path $TvnExe) -and -not $Force) {
        Good "TightVNC sudah terpasang (lewati; pakai -Force untuk update)."
    } elseif ($HasWinget) {
        Install-WingetPkg "GlavSoft.TightVNC" "TightVNC" | Out-Null
    } else {
        Warn "Lewati TightVNC - pasang manual dari https://www.tightvnc.com/download.php lalu jalankan ulang installer ini."
    }

    if (Test-Path $TvnExe) {
        # Pemasang TightVNC mendaftarkan service autostart - nonaktifkan.
        # Saklar start-vnc menjalankan tvnserver mode aplikasi (konsisten:
        # tidak ada yang hidup diam-diam).
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

        # --- 5b. Password VNC (mode aplikasi membaca HKCU) ------------------
        # Password VNC klasik maks 8 karakter, disimpan terenkripsi DES dengan
        # kunci standar VNC (bukan rahasia - sekadar format yang dimengerti
        # TightVNC). Password VIEW-ONLY inilah yang dipakai channel R-Net;
        # password KONTROL hanya untuk maintenance Anda sendiri.
        function ConvertTo-VncPass([string]$plain) {
            $data = New-Object byte[] 8
            $src = [Text.Encoding]::ASCII.GetBytes($plain)
            [Array]::Copy($src, $data, [Math]::Min(8, $src.Length))
            $des = New-Object Security.Cryptography.DESCryptoServiceProvider
            $des.Mode = [Security.Cryptography.CipherMode]::ECB
            $des.Padding = [Security.Cryptography.PaddingMode]::None
            $des.Key = [byte[]](0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0)
            return $des.CreateEncryptor().TransformFinalBlock($data, 0, 8)
        }

        $RegVnc = "HKCU:\Software\TightVNC\Server"
        $hasPass = (Test-Path $RegVnc) -and
            (Get-ItemProperty $RegVnc -Name PasswordViewOnly -ErrorAction SilentlyContinue)
        if ($hasPass -and -not $Force) {
            Good "Password TightVNC sudah diset - dipertahankan (ubah lewat GUI TightVNC)."
        } else {
            Write-Host ""
            Info "Password VNC (maks 8 karakter; Enter = buat otomatis):"
            $vncCtrl = Read-Host "   Password KONTROL (maintenance - JANGAN diisi ke R-Net)"
            if ([string]::IsNullOrWhiteSpace($vncCtrl)) { $vncCtrl = (New-Pass).Substring(0, 8); Write-Host "   -> dibuatkan: $vncCtrl" }
            $vncView = Read-Host "   Password VIEW-ONLY (yang dipakai channel R-Net)"
            if ([string]::IsNullOrWhiteSpace($vncView)) { $vncView = (New-Pass).Substring(0, 8); Write-Host "   -> dibuatkan: $vncView" }
            New-Item -Path $RegVnc -Force | Out-Null
            New-ItemProperty -Path $RegVnc -Name Password         -PropertyType Binary -Value (ConvertTo-VncPass $vncCtrl) -Force | Out-Null
            New-ItemProperty -Path $RegVnc -Name PasswordViewOnly -PropertyType Binary -Value (ConvertTo-VncPass $vncView) -Force | Out-Null
            New-ItemProperty -Path $RegVnc -Name UseVncAuthentication  -PropertyType DWord -Value 1 -Force | Out-Null
            New-ItemProperty -Path $RegVnc -Name AcceptHttpConnections -PropertyType DWord -Value 0 -Force | Out-Null
            Good "Password TightVNC diset (kontrol + view-only)."
            Warn "CATAT keduanya. View-only untuk channel R-Net; kontrol untuk Anda sendiri."
        }
    }

    # --- 5c. websocat.exe (jembatan WebSocket <-> VNC; 1 file, tanpa Python)
    $WsDir = Join-Path $InstallDir "websocat"
    $WsExe = Join-Path $WsDir "websocat.exe"
    if (-not (Test-Path $WsDir)) { New-Item -ItemType Directory -Path $WsDir -Force | Out-Null }
    if ((Test-Path $WsExe) -and -not $Force) {
        Good "websocat.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
    } else {
        Info "Mengunduh websocat terbaru dari github.com/vi/websocat ..."
        $a = Get-LatestAsset "vi/websocat" "^websocat\.x86_64-pc-windows-gnu\.exe$"
        $tmp = Get-ToTemp $a.Url
        $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
        Info "   Sumber : $($a.Url)"
        Info "   SHA-256: $sha"
        Move-Item $tmp $WsExe -Force
        Good "websocat $($a.Version) terpasang."
    }

    # --- 5d. config.env: nomor channel + password view-only ----------------
    # Ditambahkan HANYA kalau kuncinya belum ada (config lama tidak ditimpa).
    $Cfg = Join-Path $InstallDir "config.env"
    $cfgRaw = if (Test-Path $Cfg) { Get-Content $Cfg -Raw } else { "" }
    $append = @()
    if ($cfgRaw -notmatch "(?m)^\s*VNC_CHANNEL\s*=") {
        Write-Host ""
        Info "Nomor channel R-Net milik PC INI (channel jenis 'VNC (Layar PC)')."
        Info "Kosong = saklar meng-update SEMUA channel VNC (aman kalau cuma 1 PC)."
        $vncCh = Read-Host "   VNC_CHANNEL (mis. 42; kosong = semua channel VNC)"
        $append += "# Nomor channel VNC yang alamatnya di-update PC ini (kosong = semua)."
        $append += "VNC_CHANNEL=$($vncCh.Trim())"
    }
    if ($cfgRaw -notmatch "(?m)^\s*VNC_VIEW_PASSWORD\s*=") {
        $append += "# Password VIEW-ONLY TightVNC - saklar start-vnc menuliskannya ke"
        $append += "# config channel R-Net supaya penonton auto-connect."
        $append += "VNC_VIEW_PASSWORD=$(if ($vncView) { $vncView } else { '' })"
    }
    if ($append.Count -gt 0) {
        Write-TextNoBom $Cfg (($cfgRaw.TrimEnd() + "`r`n`r`n" + ($append -join "`r`n") + "`r`n").TrimStart())
        Good "config.env diperbarui (VNC_CHANNEL / VNC_VIEW_PASSWORD)."
        if (-not $vncView -and $cfgRaw -notmatch "(?m)^\s*VNC_VIEW_PASSWORD\s*=") {
            Warn "VNC_VIEW_PASSWORD masih kosong - isi manual di config.env dengan"
            Warn "password view-only TightVNC supaya channel auto-connect."
        }
    }
}

# ==========================================================================
#  Saklar & alat bantu (selalu diperbarui ke versi terbaru)
# ==========================================================================
$tools = @("start-scada.ps1", "stop-scada.ps1", "start-scada.bat", "stop-scada.bat",
           "mqtt-setting.ps1", "Pengaturan MQTT.bat")
if ($doNodeRed) { $tools += "start-nodered.bat" }
if ($doVnc)     { $tools += @("start-vnc.ps1", "stop-vnc.ps1", "start-vnc.bat", "stop-vnc.bat") }
foreach ($f in $tools) {
    $src = Join-Path $Here $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $InstallDir $f) -Force }
}
Good "Saklar start/stop + Pengaturan MQTT terpasang di $InstallDir."

# --- Selesai --------------------------------------------------------------
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SELESAI. Langkah berikutnya:" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
if ($doStream) {
    Write-Host "  VIDEO:"
    Write-Host "  1. Buka OBS. Settings > Stream:"
    Write-Host "       Service    : Custom"
    Write-Host "       Server     : rtmp://127.0.0.1:1935"
    Write-Host "       Stream Key : scada?user=obs&pass=<password publish di atas>"
    Write-Host "       Output > Streaming > Keyframe Interval: 1 s  (WAJIB)"
    Write-Host "  2. Dobel-klik  $InstallDir\start-scada.bat"
    Write-Host "  3. OBS > Start Streaming. Cek di $DomainRein/r-net"
    Write-Host ""
}
if ($doMqtt) {
    Write-Host "  MQTT:"
    Write-Host "  - Atur port/akun broker: dobel-klik '$InstallDir\Pengaturan MQTT.bat'"
    Write-Host "  - Broker ikut hidup/mati bersama start-scada.bat / stop-scada.bat"
    Write-Host ""
}
if ($doNodeRed) {
    Write-Host "  NODE-RED:"
    Write-Host "  - Nyalakan: dobel-klik '$InstallDir\start-nodered.bat'"
    Write-Host "  - Editor  : http://127.0.0.1:1880  (tutup jendelanya = mati)"
    Write-Host ""
}
if ($doVnc) {
    Write-Host "  SUMBER VNC (spion layar PC ini):"
    Write-Host "  1. Buka browser di PC ini ke cloud SCADA, login, atur tampilannya."
    Write-Host "  2. Dobel-klik  $InstallDir\start-vnc.bat"
    Write-Host "     -> TightVNC + websocat + tunnel hidup; alamat channel VNC"
    Write-Host "        ter-update otomatis (kalau config.env terisi)."
    Write-Host "  3. Di R-Net > Channel: buat channel jenis 'VNC (Layar PC)'"
    Write-Host "     dengan nomor = VNC_CHANNEL, lalu taruh di layout Monitor."
    Write-Host "  Matikan: stop-vnc.bat. Panduan detail: docs/VNC-SOURCE-SETUP.md"
    Write-Host ""
}
Write-Host "  Panduan lengkap: PANDUAN-RNET.md (di folder installer ini)"
Write-Host "  Uninstall total: stop-scada.bat lalu hapus folder $InstallDir"
Write-Host ""
