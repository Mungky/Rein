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
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
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
$streamUrl = "$url/scada/index.m3u8"

# --- 3. Update alamat stream di Supabase (REST, tanpa Python) ------------
function Update-StreamUrl($supabaseUrl, $serviceKey, $newUrl) {
    $uri = "$supabaseUrl/rest/v1/scada_streams?id=not.is.null"
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
            $rows = Update-StreamUrl $cfg.SUPABASE_URL $cfg.SUPABASE_SERVICE_KEY $streamUrl
            if (-not $rows) {
                Write-Host "[INFO] Belum ada stream terdaftar di R-Net." -ForegroundColor Yellow
                Write-Host "       Buka Kelola Stream di R-Net, tambahkan 1 stream, lalu jalankan ulang." -ForegroundColor Yellow
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
