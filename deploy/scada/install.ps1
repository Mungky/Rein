# ==========================================================================
#  install.ps1  -  Pemasang universal server R-Net
#                  (MediaMTX + Cloudflare Tunnel + Mosquitto MQTT)
# ==========================================================================
#  Satu perintah untuk menyiapkan komputer server/pemancar mana pun:
#    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#
#  Yang dilakukan:
#    1. Membuat folder  C:\rein-scada\  (mediamtx\, cloudflared\, mosquitto\)
#    2. Mengunduh mediamtx.exe & cloudflared.exe versi TERBARU langsung dari
#       rilis RESMI di GitHub (HTTPS), lalu memverifikasi:
#         - cloudflared.exe : tanda tangan digital Authenticode = Cloudflare
#         - mediamtx.exe    : menampilkan hash SHA-256 untuk dicocokkan
#    3. Membuat mediamtx.yml (menanyakan/meng-generate password)
#    4. Membuat config.env (kredensial Supabase + STREAM_NAME)  - RAHASIA
#    5. OPSIONAL: memasang Mosquitto (broker MQTT resmi mosquitto.org) +
#       akun + port 1883 — untuk data sensor V-Box (tab Data R-Net)
#    6. Menyalin start/stop switch ke folder itu
#
#  JAMINAN KEAMANAN:
#    - Hanya mengunduh dari github.com/bluenviron/mediamtx,
#      github.com/cloudflare/cloudflared, dan mosquitto.org (resmi, HTTPS).
#    - MediaMTX/cloudflared: tanpa service Windows, tanpa registry, tanpa
#      Administrator. Mosquitto memakai pemasang resminya (sekali izin
#      Administrator); service bawaannya disetel MANUAL — semua dinyalakan/
#      dimatikan HANYA oleh saklar start-scada/stop-scada.
#    - TIDAK menimpa mediamtx.yml / config.env / mosquitto.conf yang sudah
#      ada. Unduhan ke file sementara dulu, dipindah setelah lolos verifikasi.
#    - Aman dijalankan berulang (idempoten).
# ==========================================================================

param(
    [string]$InstallDir = "C:\rein-scada",
    [switch]$Force,                        # unduh ulang exe walau sudah ada
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

Write-Host ""
Write-Host "==========================================================" -ForegroundColor White
Write-Host "  Pemasang pemancar R-Net (universal)" -ForegroundColor White
Write-Host "  Target folder: $InstallDir" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor White
Write-Host ""

# --- 0. Folder ------------------------------------------------------------
$MediaMtxDir    = Join-Path $InstallDir "mediamtx"
$CloudflaredDir = Join-Path $InstallDir "cloudflared"
foreach ($d in @($InstallDir, $MediaMtxDir, $CloudflaredDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Good "Folder siap."

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

# --- 1. cloudflared.exe (dengan verifikasi tanda tangan) -----------------
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

# --- 2. mediamtx.exe (dari zip resmi + tampilkan hash) -------------------
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

# --- 3. mediamtx.yml (jangan timpa kalau sudah ada) ----------------------
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

# --- 4. config.env (RAHASIA; jangan timpa) -------------------------------
$Cfg = Join-Path $InstallDir "config.env"
if (Test-Path $Cfg) {
    Good "config.env sudah ada - kredensial lama dipertahankan (tidak ditimpa)."
} else {
    Write-Host ""
    Info "Kredensial Supabase (untuk update alamat stream otomatis)."
    Info "Kosongkan keduanya kalau mau tempel alamat manual saja."
    $sUrl = Read-Host "   SUPABASE_URL (mis. https://xxxx.supabase.co)"
    $sKey = Read-Host "   SUPABASE_SERVICE_KEY (service_role)"
    if ([string]::IsNullOrWhiteSpace($sUrl)) { $sUrl = "GANTI_DENGAN_URL_SUPABASE" }
    if ([string]::IsNullOrWhiteSpace($sKey)) { $sKey = "GANTI_DENGAN_SERVICE_ROLE_KEY" }
    Write-Host ""
    Info "Nama stream milik MESIN INI (harus PERSIS sama dengan nama di"
    Info "R-Net > Channel > Sumber Stream). WAJIB diisi kalau ada lebih dari"
    Info "satu mesin siaran - tanpa ini mesin-mesin akan saling menimpa alamat."
    $sName = Read-Host "   STREAM_NAME (mis. Line Server; kosong = mode 1 mesin)"
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

# --- 5. Mosquitto (broker MQTT) — OPSIONAL, untuk data sensor V-Box ------
#  Dipasang dari installer RESMI mosquitto.org. Service Windows-nya (jika
#  terdaftar) disetel Manual — broker dinyalakan/dimatikan oleh saklar
#  start-scada/stop-scada, konsisten dengan MediaMTX (tanpa autostart).
$MqDir  = Join-Path $InstallDir "mosquitto"
$MqConf = Join-Path $MqDir "mosquitto.conf"
$MqExe  = Join-Path $env:ProgramFiles "mosquitto\mosquitto.exe"
$MqVer  = "2.0.18"
$MqUrl  = "https://mosquitto.org/files/binary/win64/mosquitto-$MqVer-install-windows-x64.exe"

Write-Host ""
$wantMq = Read-Host "Pasang broker MQTT (Mosquitto) di PC ini? Perlu kalau V-Box/sensor kirim data ke PC ini. [y/N]"
if ($wantMq -match "^[Yy]") {
    if (-not (Test-Path $MqDir)) { New-Item -ItemType Directory -Path $MqDir -Force | Out-Null }

    if (Test-Path $MqExe) {
        Good "Mosquitto sudah terpasang (lewati unduhan)."
    } else {
        Info "Mengunduh Mosquitto $MqVer dari mosquitto.org (situs resmi) ..."
        $tmp = Get-ToTemp $MqUrl
        $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
        Info "   SHA-256: $sha"
        Info "Menjalankan pemasang (butuh persetujuan Administrator sekali) ..."
        try {
            Start-Process -FilePath $tmp -ArgumentList "/S" -Verb RunAs -Wait
        } catch {
            Warn "Pemasangan dibatalkan/gagal: $($_.Exception.Message)"
        }
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        if (Test-Path $MqExe) { Good "Mosquitto terpasang." }
        else { Warn "mosquitto.exe tidak ditemukan - lewati konfigurasi MQTT. Pasang manual dari mosquitto.org lalu jalankan ulang installer ini." }
    }

    if (Test-Path $MqExe) {
        # Jangan biarkan service bawaan autostart - saklar kita yang pegang.
        try { Set-Service mosquitto -StartupType Manual -ErrorAction Stop; Stop-Service mosquitto -ErrorAction SilentlyContinue } catch {}

        if (Test-Path $MqConf) {
            Good "mosquitto.conf sudah ada - kredensial lama dipertahankan."
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
            Warn "CATAT akun MQTT ini - dipakai di V-Net (publish) & R-Net > Data > Kelola Site."
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
} else {
    Info "Mosquitto dilewati (bisa jalankan ulang installer ini kapan pun)."
}

# --- 6. Salin saklar (selalu perbarui ke versi terbaru) ------------------
foreach ($f in @("start-scada.ps1", "stop-scada.ps1", "start-scada.bat", "stop-scada.bat")) {
    $src = Join-Path $Here $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $InstallDir $f) -Force }
}
Good "Saklar start/stop terpasang."

# --- Selesai --------------------------------------------------------------
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SELESAI. Langkah berikutnya:" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  1. Pasang OBS (obsproject.com). Settings > Stream:"
Write-Host "       Service    : Custom"
Write-Host "       Server     : rtmp://127.0.0.1:1935"
Write-Host "       Stream Key : scada?user=obs&pass=<password publish di atas>"
Write-Host "       Output > Streaming > Keyframe Interval: 1 s  (WAJIB)"
Write-Host "  2. Dobel-klik  $InstallDir\start-scada.bat"
Write-Host "  3. OBS > Start Streaming. Cek di $DomainRein/r-net"
Write-Host ""
Write-Host "  Uninstall total: stop-scada.bat lalu hapus folder $InstallDir"
Write-Host ""
