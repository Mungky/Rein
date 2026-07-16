# ==========================================================================
#  start-scada.ps1  -  Saklar ON pemancar R-Net (UNIVERSAL)
# ==========================================================================
#  Tanpa Python. Tanpa source code REIN. Hanya butuh PowerShell bawaan
#  Windows + dua file .exe (mediamtx, cloudflared) yang sudah diunduh
#  installer. Bisa ditaruh di folder mana saja (path ditentukan otomatis).
#
#  Urutan: MediaMTX  ->  Cloudflare Quick Tunnel  ->  update alamat stream
#  di database Supabase (lewat REST API, bukan Python).
#
#  Dipanggil oleh start-scada.bat (dobel-klik). Aman diulang.
# ==========================================================================

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$MediaMtxDir = Join-Path $Root "mediamtx"
$MediaMtxExe = Join-Path $MediaMtxDir "mediamtx.exe"
$Cloudflared = Join-Path $Root "cloudflared\cloudflared.exe"
$TunnelLog   = Join-Path $Root "cloudflared\tunnel.log"
$ConfigFile  = Join-Path $Root "config.env"

function Fail($msg) { Write-Host "[GAGAL] $msg" -ForegroundColor Red; exit 1 }

# --- Prasyarat ------------------------------------------------------------
if (-not (Test-Path $MediaMtxExe)) { Fail "mediamtx.exe tidak ada. Jalankan install.ps1 dulu." }
if (-not (Test-Path $Cloudflared)) { Fail "cloudflared.exe tidak ada. Jalankan install.ps1 dulu." }

# --- Baca config.env (KEY=VALUE) -----------------------------------------
function Read-Config($path) {
    $cfg = @{}
    if (-not (Test-Path $path)) { return $cfg }
    foreach ($line in Get-Content $path) {
        $t = $line.Trim()
        if ($t -eq "" -or $t.StartsWith("#")) { continue }
        $i = $t.IndexOf("=")
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
        $cfg[$k] = $v
    }
    return $cfg
}
$cfg = Read-Config $ConfigFile
$hasCreds = $cfg.SUPABASE_URL -and $cfg.SUPABASE_SERVICE_KEY `
    -and ($cfg.SUPABASE_URL -notmatch "GANTI") -and ($cfg.SUPABASE_SERVICE_KEY -notmatch "GANTI")

# Stream yang di-update mesin ini. STREAM_NAME kosong = mode lama (menimpa
# SEMUA stream) — hanya aman kalau cuma ada satu sumber siaran.
$streamName = if ($cfg.STREAM_NAME) { $cfg.STREAM_NAME.Trim() } else { "" }
$streamPath = if ($cfg.STREAM_PATH) { $cfg.STREAM_PATH.Trim() } else { "scada" }
if ($streamPath -eq "") { $streamPath = "scada" }

# --- 0.5 Mosquitto (broker MQTT) — hanya jika dikonfigurasi installer -----
$MqConf = Join-Path $Root "mosquitto\mosquitto.conf"
$MqExe  = Join-Path $env:ProgramFiles "mosquitto\mosquitto.exe"
if ((Test-Path $MqConf) -and (Test-Path $MqExe)) {
    if (-not (Get-Process mosquitto -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $MqExe -ArgumentList "-c", "`"$MqConf`"" -WindowStyle Hidden
        Write-Host "[OK] Mosquitto (MQTT) dinyalakan - port 1883"
    } else {
        Write-Host "[OK] Mosquitto sudah jalan"
    }
}

# --- 1. MediaMTX (pemancar) ----------------------------------------------
if (-not (Get-Process mediamtx -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $MediaMtxExe -WorkingDirectory $MediaMtxDir `
        -RedirectStandardOutput (Join-Path $MediaMtxDir "log.txt") `
        -RedirectStandardError  (Join-Path $MediaMtxDir "err.txt") `
        -WindowStyle Hidden
    Write-Host "[OK] MediaMTX dinyalakan"
} else {
    Write-Host "[OK] MediaMTX sudah jalan"
}

# --- 2. Cloudflare Quick Tunnel (URL baru tiap start) --------------------
# Matikan HANYA tunnel video lama (:8888). Tunnel sumber VNC (:6080) di PC
# yang sama - kalau ada - tidak disentuh.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match ":8888" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
Remove-Item $TunnelLog -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $Cloudflared `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:8888" `
    -RedirectStandardError $TunnelLog -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep 1
    $log = Get-Content $TunnelLog -Raw -ErrorAction SilentlyContinue
    if ($log -match "https://[a-z0-9-]+\.trycloudflare\.com") { $url = $Matches[0]; break }
}
if (-not $url) { Fail "URL tunnel tidak muncul dalam 30 dtk. Cek internet, jalankan ulang." }
Write-Host "[OK] Tunnel hidup: $url"
$streamUrl = "$url/$streamPath/index.m3u8"
if ($streamName -ne "") {
    Write-Host "[OK] Target: stream '$streamName' (path '$streamPath')"
} else {
    Write-Host "[!] STREAM_NAME kosong -> menimpa SEMUA stream (mode 1 sumber)." -ForegroundColor Yellow
}

# --- 3. Update alamat stream di Supabase (REST, tanpa Python) ------------
# Kalau STREAM_NAME diisi, hanya baris dengan nama itu yang di-update — jadi
# beberapa mesin siaran tidak saling menimpa. Kalau kosong, semua baris.
function Update-StreamUrl($supabaseUrl, $serviceKey, $newUrl, $name) {
    if ($name -ne "") {
        $filter = "name=eq.$([uri]::EscapeDataString($name))"
    } else {
        $filter = "id=not.is.null"
    }
    $uri = "$supabaseUrl/rest/v1/scada_streams?$filter"
    $headers = @{
        apikey        = $serviceKey
        Authorization = "Bearer $serviceKey"
        "Content-Type" = "application/json"
        Prefer        = "return=representation"
    }
    $body = @{ hls_url = $newUrl } | ConvertTo-Json
    $resp = Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -Body $body -TimeoutSec 20
    return $resp
}

if ($hasCreds) {
    $ok = $false
    for ($i = 0; $i -lt 3; $i++) {
        try {
            $rows = Update-StreamUrl $cfg.SUPABASE_URL $cfg.SUPABASE_SERVICE_KEY $streamUrl $streamName
            if (-not $rows) {
                if ($streamName -ne "") {
                    Write-Host "[INFO] Belum ada stream bernama '$streamName' di R-Net." -ForegroundColor Yellow
                    Write-Host "       Buka Kelola Stream, buat stream dgn nama PERSIS itu, lalu jalankan ulang." -ForegroundColor Yellow
                } else {
                    Write-Host "[INFO] Belum ada stream terdaftar di R-Net." -ForegroundColor Yellow
                    Write-Host "       Buka Kelola Stream, tambahkan 1 stream, lalu jalankan ulang." -ForegroundColor Yellow
                }
            } else {
                foreach ($r in $rows) { Write-Host ("   {0}  ->  {1}" -f $r.name, $streamUrl) }
            }
            $ok = $true; break
        } catch {
            Write-Host "[..] Gagal update (percobaan $($i+1)/3): $($_.Exception.Message)" -ForegroundColor DarkYellow
            Start-Sleep 10
        }
    }
    if (-not $ok) { Fail "Tidak bisa update database R-Net. Cek internet / isi config.env." }

    Write-Host ""
    Write-Host "=== R-NET SIAP ===" -ForegroundColor Green
    Write-Host "Stream : $streamUrl"
    Write-Host "Tinggal: buka OBS -> Start Streaming (kalau belum otomatis)"
} else {
    # Tanpa kredensial: tunnel tetap hidup, alamat ditempel manual.
    Write-Host ""
    Write-Host "=== TUNNEL SIAP (mode manual) ===" -ForegroundColor Cyan
    Write-Host "config.env belum diisi, jadi alamat TIDAK di-update otomatis."
    Write-Host "Salin alamat ini ke R-Net > Kelola Stream > URL HLS:" -ForegroundColor Yellow
    Write-Host "   $streamUrl" -ForegroundColor White
    Write-Host "Lalu buka OBS -> Start Streaming."
}
