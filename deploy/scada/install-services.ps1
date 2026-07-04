# install-services.ps1 — Setup layanan SCADA di PC server (Windows)
# ===================================================================
# Memasang MediaMTX + cloudflared sebagai Windows Service via NSSM
# (auto-start saat boot, auto-restart kalau crash), plus Task Scheduler
# untuk menjalankan OBS otomatis saat logon.
#
# Jalankan sebagai Administrator:
#   powershell -ExecutionPolicy Bypass -File install-services.ps1
#
# Script ini idempoten — aman dijalankan ulang.

# ── SESUAIKAN PATH DI SINI ──────────────────────────────────────────
$MediaMtxExe    = "C:\rein-scada\mediamtx\mediamtx.exe"
$MediaMtxConfig = "C:\rein-scada\mediamtx\mediamtx.yml"
$CloudflaredExe = "C:\rein-scada\cloudflared\cloudflared.exe"
$TunnelName     = "rein-scada"
$ObsExe         = "C:\Program Files\obs-studio\bin\64bit\obs64.exe"
$NssmExe        = "C:\rein-scada\nssm\nssm.exe"
# ────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

function Assert-File($path, $hint) {
    if (-not (Test-Path $path)) {
        Write-Host "[GAGAL] Tidak ketemu: $path" -ForegroundColor Red
        Write-Host "        $hint" -ForegroundColor Yellow
        exit 1
    }
}

Assert-File $NssmExe        "Download NSSM dari https://nssm.cc lalu taruh di folder itu."
Assert-File $MediaMtxExe    "Download MediaMTX dari https://github.com/bluenviron/mediamtx/releases"
Assert-File $MediaMtxConfig "Salin mediamtx.yml dari repo (deploy/scada/) dan isi password-nya."
Assert-File $CloudflaredExe "Download cloudflared dari https://github.com/cloudflare/cloudflared/releases"

function Install-Or-Update-Service($name, $exe, $args) {
    $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[INFO] Service $name sudah ada — perbarui konfigurasi." -ForegroundColor Cyan
        & $NssmExe stop $name | Out-Null
    } else {
        & $NssmExe install $name $exe | Out-Null
        Write-Host "[OK] Service $name dibuat." -ForegroundColor Green
    }
    & $NssmExe set $name Application $exe | Out-Null
    if ($args) { & $NssmExe set $name AppParameters $args | Out-Null }
    & $NssmExe set $name AppDirectory (Split-Path $exe) | Out-Null
    & $NssmExe set $name Start SERVICE_AUTO_START | Out-Null
    # Inti "sistem restart sendiri": restart otomatis 5 detik setelah exit
    & $NssmExe set $name AppExitAction Restart | Out-Null
    & $NssmExe set $name AppRestartDelay 5000 | Out-Null
    & $NssmExe start $name | Out-Null
    Write-Host "[OK] Service $name berjalan." -ForegroundColor Green
}

# 1. MediaMTX
Install-Or-Update-Service "rein-mediamtx" $MediaMtxExe "`"$MediaMtxConfig`""

# 2. Cloudflare Tunnel
Install-Or-Update-Service "rein-cloudflared" $CloudflaredExe "tunnel run $TunnelName"

# 3. OBS — bukan service (butuh sesi desktop untuk menangkap layar).
#    Dijalankan via Task Scheduler saat logon + auto-logon Windows aktif.
if (Test-Path $ObsExe) {
    $taskName = "REIN-OBS-AutoStart"
    $action = New-ScheduledTaskAction -Execute $ObsExe `
        -Argument "--startstreaming --minimize-to-tray --disable-shutdown-check" `
        -WorkingDirectory (Split-Path $ObsExe)
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Force | Out-Null
    Write-Host "[OK] Task Scheduler '$taskName' terpasang (OBS auto-start + auto-streaming saat logon)." -ForegroundColor Green
    Write-Host "[PENTING] Aktifkan auto-logon Windows (netplwiz) supaya OBS ikut hidup setelah restart PC." -ForegroundColor Yellow
} else {
    Write-Host "[LEWATI] OBS tidak ditemukan di $ObsExe — pasang OBS dulu lalu jalankan ulang script ini." -ForegroundColor Yellow
}

# 4. Ringkasan status
Write-Host ""
Write-Host "=== STATUS ===" -ForegroundColor Cyan
Get-Service rein-mediamtx, rein-cloudflared | Format-Table Name, Status, StartType
Write-Host "Uji cepat playlist HLS (harus 401 tanpa password):"
Write-Host "  curl.exe -s -o NUL -w `"%{http_code}`" http://127.0.0.1:8888/scada/index.m3u8"
