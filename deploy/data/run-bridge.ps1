# ==========================================================================
#  run-bridge.ps1  -  Menjalankan bridge (kurir broker MQTT -> database R-Net)
# ==========================================================================
#  Membaca DATABASE_URL dari ..\config.env, memasangnya sebagai environment
#  variable untuk proses ini saja, lalu menjalankan bridge.py. Ctrl+C berhenti.
#  Dipanggil start.ps1 (paket DATA) di jendela terpisah, atau dobel-klik.
# ==========================================================================

$ErrorActionPreference = "Stop"
$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\data
$Config = Join-Path (Split-Path -Parent $Root) "config.env"    # ...\config.env

if (-not (Test-Path $Config)) { Write-Host "[GAGAL] config.env tidak ada." -ForegroundColor Red; pause; exit 1 }

# Parser KEY=VALUE (pola sama dengan lib\common.ps1).
foreach ($line in Get-Content $Config) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    if ($k -in @("DATABASE_URL", "FLUSH_INTERVAL_S", "RING_KEEP", "LOG_LEVEL", "LATEST_FLUSH_S")) {
        Set-Item -Path "Env:$k" -Value $v
    }
}

if (-not $env:DATABASE_URL -or $env:DATABASE_URL -match "^GANTI") {
    Write-Host "[GAGAL] DATABASE_URL kosong di config.env." -ForegroundColor Red
    Write-Host "        Isi: postgresql://user:password@host:6543/postgres" -ForegroundColor Yellow
    pause; exit 1
}

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { Write-Host "[GAGAL] Python tidak ada di PATH." -ForegroundColor Red; pause; exit 1 }

Write-Host "=== R-Net bridge (kurir broker -> database) ===" -ForegroundColor Cyan
Write-Host "Menyambungkan... tekan Ctrl+C untuk berhenti."
& $py (Join-Path $Root "bridge.py")
