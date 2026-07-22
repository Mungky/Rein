# ==========================================================================
#  stop.ps1  -  Saklar OFF R-Net (pilih paket)
# ==========================================================================
#  stop.bat          -> menu ; stop.bat semua ; stop.bat stream / mirror / data
#  Tunnel dimatikan kalau tidak ada lagi paket ber-tunnel yang jalan.
# ==========================================================================

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paket)

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib\common.ps1")
$P = Get-ReinPaths $Here

$installed = Get-InstalledPackages $P
if ($installed.Count -eq 0) { $installed = @("stream", "mirror", "data") }
$sel = Select-Packages $Paket $installed "matikan"
if ($sel.Count -eq 0) { Warn "Tidak ada paket dipilih."; exit 0 }

if ($sel -contains "stream") {
    Get-Process mediamtx -ErrorAction SilentlyContinue | Stop-Process -Force
    Good "STREAM dimatikan (MediaMTX). OBS tutup sendiri."
}

if ($sel -contains "mirror") {
    Get-Process tvnserver -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process websocat  -ErrorAction SilentlyContinue | Stop-Process -Force
    Good "MIRROR dimatikan (TightVNC + websocat)."
}

if ($sel -contains "data") {
    Stop-ByCommandLine "node.exe" "node-red"
    Stop-ByCommandLine "python.exe" "bridge\.py"
    Stop-ByCommandLine "py.exe" "bridge\.py"
    Good "DATA dimatikan (Node-RED + bridge). Broker VPS tidak disentuh."
}

# Satu named tunnel melayani stream + mirror, jadi baru boleh dimatikan kalau
# keduanya sudah mati - kalau tidak, mematikan stream ikut memutus mirror.
$streamOn = [bool](Get-Process mediamtx -ErrorAction SilentlyContinue)
$mirrorOn = [bool](Get-Process websocat -ErrorAction SilentlyContinue)
if (-not $streamOn -and -not $mirrorOn) {
    Stop-ByCommandLine "cloudflared.exe" "tunnel\s+run"
    Good "Named tunnel dimatikan (tidak ada lagi stream/mirror yang jalan)."
} else {
    Info "Named tunnel dibiarkan hidup (masih ada stream/mirror aktif)."
}

Show-ServiceStatus $P
