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

# Sumber (Screen) yang di-update PC ini - namanya harus PERSIS sama dengan
# nama di R-Net > Channel > Kelola Screen (pola yang sama dengan STREAM_NAME).
# Kosong = SEMUA sumber jenis VNC, hanya aman kalau cuma ada satu PC sumber.
# (VNC_CHANNEL dari versi lama masih dibaca sebagai nama, demi kompatibilitas.)
$vncSource = if ($cfg.VNC_SOURCE)         { $cfg.VNC_SOURCE.Trim() }         else { "" }
$vncPass   = if ($cfg.VNC_VIEW_PASSWORD)  { $cfg.VNC_VIEW_PASSWORD.Trim() }  else { "" }

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
if ($vncSource -ne "") {
    Write-Host "[OK] Target: sumber (Screen) '$vncSource'"
} else {
    Write-Host "[!] VNC_SOURCE kosong -> menimpa SEMUA sumber VNC (mode 1 PC)." -ForegroundColor Yellow
}

# --- 4. Update SUMBER VNC di Supabase (REST, tanpa Python) ------------------
# Alamat VNC tinggal di tabel sumber (scada_streams, source_type='vnc'), bukan
# di config channel: satu sumber bisa dipakai banyak channel. Frontend R-Net
# menormalisasi https:// menjadi wss:// sendiri. `secret` = password VIEW-ONLY.
if ($hasCreds) {
    $key = $cfg.SUPABASE_SERVICE_KEY
    $base = "$($cfg.SUPABASE_URL)/rest/v1/scada_streams"
    $headers = @{
        apikey         = $key
        Authorization  = "Bearer $key"
        "Content-Type" = "application/json"
        Prefer         = "return=representation"
    }
    $filter = "source_type=eq.vnc"
    if ($vncSource -ne "") {
        $filter += "&name=eq.$([uri]::EscapeDataString($vncSource))"
    }

    $ok = $false
    for ($i = 0; $i -lt 3; $i++) {
        try {
            $rows = Invoke-RestMethod -Method Get -TimeoutSec 20 -Headers $headers `
                -Uri "${base}?${filter}&select=id,name"
            if (-not $rows) {
                if ($vncSource -ne "") {
                    Write-Host "[INFO] Belum ada sumber VNC bernama '$vncSource' di R-Net." -ForegroundColor Yellow
                } else {
                    Write-Host "[INFO] Belum ada sumber jenis VNC di R-Net." -ForegroundColor Yellow
                }
                Write-Host "       Buka R-Net > Channel > Kelola Screen, tambah sumber jenis" -ForegroundColor Yellow
                Write-Host "       'VNC (Layar PC)' dengan nama PERSIS itu, lalu jalankan ulang." -ForegroundColor Yellow
                Write-Host "       Atau isi manual alamat ini di sumber: $url" -ForegroundColor Yellow
            } else {
                foreach ($r in $rows) {
                    $patch = @{ url = $url }
                    # Password hanya ditimpa kalau config.env memuatnya - biar
                    # password yang sudah diisi lewat UI tidak terhapus.
                    if ($vncPass -ne "") { $patch.secret = $vncPass }
                    $body = $patch | ConvertTo-Json
                    Invoke-RestMethod -Method Patch -TimeoutSec 20 -Headers $headers `
                        -Uri "${base}?id=eq.$($r.id)" -Body $body | Out-Null
                    $pw = if ($vncPass -ne "") { " + password" } else { "" }
                    Write-Host ("   {0}  ->  {1}{2}" -f $r.name, $url, $pw)
                }
            }
            $ok = $true; break
        } catch {
            Write-Host "[..] Gagal update (percobaan $($i+1)/3): $($_.Exception.Message)" -ForegroundColor DarkYellow
            Start-Sleep 10
        }
    }
    if (-not $ok) { Fail "Tidak bisa update database R-Net. Cek internet / isi config.env." }

    if ($vncPass -eq "") {
        Write-Host "[!] VNC_VIEW_PASSWORD kosong di config.env - kalau TightVNC minta" -ForegroundColor Yellow
        Write-Host "    password, isi kolom Password VNC di Kelola Screen." -ForegroundColor Yellow
    }
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
    Write-Host "Salin ke R-Net > Channel > Kelola Screen > sumber VNC > Alamat:" -ForegroundColor Yellow
    Write-Host "   $url" -ForegroundColor White
    Write-Host "(password view-only TightVNC diisi di kolom Password VNC)"
}
