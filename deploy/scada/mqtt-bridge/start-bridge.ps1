# Saklar manual R-Net MQTT bridge (tes lokal Windows).
# Membaca .env (KEY=VALUE), memasangnya sebagai environment variable untuk
# proses ini saja, lalu menjalankan bridge.py. Ctrl+C untuk berhenti.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $Root ".env"

if (-not (Test-Path $envFile)) {
    Write-Host "[!] File .env belum ada." -ForegroundColor Yellow
    Write-Host "    Salin dulu:  copy .env.example .env   lalu isi DATABASE_URL."
    exit 1
}

# Parser KEY=VALUE: lewati komentar (#) dan baris kosong, potong di '=' pertama,
# buang tanda kutip. (Pola sama seperti start-scada.ps1.)
foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#")) { continue }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { continue }
    $key = $t.Substring(0, $i).Trim()
    $val = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    Set-Item -Path "Env:$key" -Value $val
}

if (-not $env:DATABASE_URL) {
    Write-Host "[!] DATABASE_URL kosong di .env." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== R-Net MQTT bridge (tes lokal) ===" -ForegroundColor Cyan
Write-Host "Menyambungkan... tekan Ctrl+C untuk berhenti."
python (Join-Path $Root "bridge.py")
