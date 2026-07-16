# ==========================================================================
#  start-vnc.ps1  -  Saklar ON sumber VNC R-Net (spion layar PC INI)
# ==========================================================================
#  Untuk PC dedicated yang layarnya dipantulkan view-only ke channel R-Net
#  jenis "VNC (Layar PC)" - mis. browser yang membuka cloud SCADA.
#
#  Urutan: TightVNC (MODE APLIKASI, bukan service)  ->  websocat (jembatan
#  WebSocket 6080 -> VNC 5900)  ->  Cloudflare Quick Tunnel  ->  update
#  alamat (+password view-only) channel VNC di Supabase lewat REST API.
#
#  Semua listen di 127.0.0.1 saja; hanya tunnel yang keluar. Penonton R-Net
#  konek wss:// lewat tunnel dan SELALU view-only (password view-only +
#  klien R-Net yang memang tidak mengirim input).
#
#  Dipanggil oleh start-vnc.bat (dobel-klik). Aman diulang.
# ==========================================================================

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebsocatExe = Join-Path $Root "websocat\websocat.exe"
$Cloudflared = Join-Path $Root "cloudflared\cloudflared.exe"
$TunnelLog   = Join-Path $Root "cloudflared\tunnel-vnc.log"
$ConfigFile  = Join-Path $Root "config.env"
$TvnExe      = Join-Path $env:ProgramFiles "TightVNC\tvnserver.exe"

$VncPort = 5900   # TightVNC (localhost)
$WsPort  = 6080   # websocat - port yang diekspos Quick Tunnel

function Fail($msg) { Write-Host "[GAGAL] $msg" -ForegroundColor Red; exit 1 }

# --- Prasyarat ------------------------------------------------------------
if (-not (Test-Path $TvnExe))      { Fail "TightVNC tidak ada. Jalankan install.ps1 (komponen 5) dulu." }
if (-not (Test-Path $WebsocatExe)) { Fail "websocat.exe tidak ada. Jalankan install.ps1 (komponen 5) dulu." }
if (-not (Test-Path $Cloudflared)) { Fail "cloudflared.exe tidak ada. Jalankan install.ps1 (komponen 5) dulu." }

# --- Baca config.env (KEY=VALUE) -------------------------------------------
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

# Channel yang di-update PC ini. VNC_CHANNEL kosong = SEMUA channel VNC -
# hanya aman kalau cuma ada satu PC sumber VNC.
$vncChannel = if ($cfg.VNC_CHANNEL)       { $cfg.VNC_CHANNEL.Trim() }       else { "" }
$vncPass    = if ($cfg.VNC_VIEW_PASSWORD) { $cfg.VNC_VIEW_PASSWORD.Trim() } else { "" }

# --- 1. TightVNC (mode aplikasi) -------------------------------------------
$svc = Get-Service tvnserver -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "[!] Service TightVNC sedang jalan - dipakai itu saja (port $VncPort)." -ForegroundColor Yellow
    Write-Host "    Catatan: mode service membaca setting HKLM, bukan yang diset installer." -ForegroundColor Yellow
} elseif (Get-Process tvnserver -ErrorAction SilentlyContinue) {
    Write-Host "[OK] TightVNC sudah jalan"
} else {
    Start-Process -FilePath $TvnExe -ArgumentList "-run" -WindowStyle Hidden
    Write-Host "[OK] TightVNC dinyalakan (mode aplikasi - ikon di tray)"
}

# --- 2. websocat: WebSocket 127.0.0.1:6080 -> VNC 127.0.0.1:5900 ------------
if (Get-Process websocat -ErrorAction SilentlyContinue) {
    Write-Host "[OK] websocat sudah jalan"
} else {
    Start-Process -FilePath $WebsocatExe -WindowStyle Hidden -ArgumentList `
        "--binary", "ws-l:127.0.0.1:$WsPort", "tcp:127.0.0.1:$VncPort"
    Write-Host "[OK] websocat dinyalakan (ws 127.0.0.1:$WsPort -> vnc $VncPort)"
}

# --- 3. Cloudflare Quick Tunnel (URL baru tiap start) -----------------------
# Matikan HANYA tunnel VNC lama (:6080). Tunnel video (:8888) di PC yang
# sama - kalau ada - tidak disentuh.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match ":$WsPort" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
Remove-Item $TunnelLog -Force -ErrorAction SilentlyContinue
Start-Process -FilePath $Cloudflared `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:$WsPort" `
    -RedirectStandardError $TunnelLog -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep 1
    $log = Get-Content $TunnelLog -Raw -ErrorAction SilentlyContinue
    if ($log -match "https://[a-z0-9-]+\.trycloudflare\.com") { $url = $Matches[0]; break }
}
if (-not $url) { Fail "URL tunnel tidak muncul dalam 30 dtk. Cek internet, jalankan ulang." }
Write-Host "[OK] Tunnel hidup: $url"
if ($vncChannel -ne "") {
    Write-Host "[OK] Target: channel VNC nomor $vncChannel"
} else {
    Write-Host "[!] VNC_CHANNEL kosong -> menimpa SEMUA channel VNC (mode 1 PC)." -ForegroundColor Yellow
}

# --- 4. Update channel VNC di Supabase (REST, tanpa Python) -----------------
# Config channel di-merge, bukan diganti: url (+password kalau ada di
# config.env) di-set, resolusi layar dsb. dipertahankan. Frontend R-Net
# menormalisasi https:// menjadi wss:// sendiri.
if ($hasCreds) {
    $key = $cfg.SUPABASE_SERVICE_KEY
    $base = "$($cfg.SUPABASE_URL)/rest/v1/scada_channels"
    $headers = @{
        apikey         = $key
        Authorization  = "Bearer $key"
        "Content-Type" = "application/json"
        Prefer         = "return=representation"
    }
    $filter = "kind=eq.vnc"
    if ($vncChannel -ne "") { $filter += "&number=eq.$vncChannel" }

    $ok = $false
    for ($i = 0; $i -lt 3; $i++) {
        try {
            $rows = Invoke-RestMethod -Method Get -TimeoutSec 20 -Headers $headers `
                -Uri "${base}?${filter}&select=id,number,name,config"
            if (-not $rows) {
                if ($vncChannel -ne "") {
                    Write-Host "[INFO] Belum ada channel VNC nomor $vncChannel di R-Net." -ForegroundColor Yellow
                } else {
                    Write-Host "[INFO] Belum ada channel jenis VNC di R-Net." -ForegroundColor Yellow
                }
                Write-Host "       Buka R-Net > Channel, buat channel 'VNC (Layar PC)', jalankan ulang." -ForegroundColor Yellow
                Write-Host "       Atau isi manual alamat ini di channel: $url" -ForegroundColor Yellow
            } else {
                foreach ($r in $rows) {
                    $conf = $r.config
                    $conf | Add-Member -NotePropertyName url -NotePropertyValue $url -Force
                    if ($vncPass -ne "") {
                        $conf | Add-Member -NotePropertyName password -NotePropertyValue $vncPass -Force
                    }
                    $body = @{ config = $conf } | ConvertTo-Json -Depth 8
                    Invoke-RestMethod -Method Patch -TimeoutSec 20 -Headers $headers `
                        -Uri "${base}?id=eq.$($r.id)" -Body $body | Out-Null
                    Write-Host ("   CH {0} ({1})  ->  {2}" -f $r.number, $r.name, $url)
                }
            }
            $ok = $true; break
        } catch {
            Write-Host "[..] Gagal update (percobaan $($i+1)/3): $($_.Exception.Message)" -ForegroundColor DarkYellow
            Start-Sleep 10
        }
    }
    if (-not $ok) { Fail "Tidak bisa update database R-Net. Cek internet / isi config.env." }

    Write-Host ""
    Write-Host "=== SUMBER VNC SIAP ===" -ForegroundColor Green
    Write-Host "Pastikan browser cloud SCADA terbuka & sudah login di PC ini."
    Write-Host "Halaman R-Net yang sedang terbuka: refresh sekali supaya memakai"
    Write-Host "alamat tunnel yang baru."
} else {
    # Tanpa kredensial: tunnel tetap hidup, alamat ditempel manual.
    Write-Host ""
    Write-Host "=== TUNNEL VNC SIAP (mode manual) ===" -ForegroundColor Cyan
    Write-Host "config.env belum diisi, jadi alamat TIDAK di-update otomatis."
    Write-Host "Salin ke R-Net > Channel > channel VNC > Alamat noVNC/websockify:" -ForegroundColor Yellow
    Write-Host "   $url" -ForegroundColor White
    Write-Host "(password view-only TightVNC diisi di kolom Password VNC)"
}
