# ==========================================================================
#  uninstall.ps1  -  Hapus R-Net dari PC ini
# ==========================================================================
#  1. Matikan semua layanan.
#  2. Hapus program (MediaMTX/cloudflared/websocat = file; Node-RED/OBS/
#     TightVNC/Python = winget).
#  3. Tanya: hapus juga config.env + data (kredensial & folder)?
# ==========================================================================

param([switch]$Yes)   # -Yes = jangan tanya, hapus config.env sekalian

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib\common.ps1")
$P = Get-ReinPaths $Here

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "  Uninstall R-Net dari: $($P.Root)" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow

$installed = Get-InstalledPackages $P
Info ("Paket terpasang: " + $(if ($installed) { ($installed -join ", ") } else { "(tidak terdeteksi)" }))
$ans = Read-Host "Lanjut hapus semua layanan R-Net? (ketik HAPUS untuk lanjut)"
if ($ans -ne "HAPUS") { Warn "Dibatalkan."; exit 0 }

# --- 1. Matikan semuanya ----------------------------------------------------
Info "Mematikan semua layanan ..."
Get-Process mediamtx, tvnserver, websocat -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-ByCommandLine "cloudflared.exe" "tunnel"
Stop-ByCommandLine "node.exe" "node-red"
Stop-ByCommandLine "python.exe" "bridge\.py"
Stop-ByCommandLine "py.exe" "bridge\.py"
Good "Semua layanan dimatikan."

# --- 2. Hapus program winget (yang jelas milik R-Net) -----------------------
# Portable (mediamtx/cloudflared/websocat) ikut terhapus bersama folder di #3.
Write-Host ""
Info "Program berbagi (winget) - hapus HANYA yang ingin dilepas dari PC ini."
Info "Enter y kalau yakin PC ini tidak memakainya untuk hal lain."
foreach ($pkg in @(
    @{ Id = "GlavSoft.TightVNC"; Label = "TightVNC (mirror)" }
)) {
    $a = Read-Host "   Hapus $($pkg.Label)? (y/N)"
    if ($a -match "^(y|ya)$") { Uninstall-WingetPkg $pkg.Id $pkg.Label }
}
Info "OBS Studio / Node.js / Python TIDAK dihapus otomatis (sering dipakai hal"
Info "lain). Hapus manual lewat Settings > Apps kalau memang mau."

# --- 3. Folder + kredensial -------------------------------------------------
Write-Host ""
$delData = $Yes
if (-not $Yes) {
    $a = Read-Host "Hapus juga config.env + folder $($P.Root) (kredensial ikut hilang)? (y/N)"
    $delData = ($a -match "^(y|ya)$")
}
if ($delData) {
    # Skrip tidak bisa menghapus dirinya sementara jalan - jadwalkan lewat cmd.
    if ($P.Root -eq (Split-Path -Parent $MyInvocation.MyCommand.Path)) {
        Info "Menjadwalkan penghapusan folder $($P.Root) ..."
        Start-Process cmd.exe -ArgumentList "/c", "timeout /t 2 >nul & rmdir /s /q `"$($P.Root)`"" -WindowStyle Hidden
        Good "Folder akan dihapus beberapa detik lagi (termasuk config.env)."
    } else {
        Remove-Item $P.Root -Recurse -Force -ErrorAction SilentlyContinue
        Good "Folder $($P.Root) dihapus."
    }
} else {
    Good "Program dilepas. config.env + folder DIPERTAHANKAN (pasang ulang cepat)."
}

Write-Host ""
Good "Uninstall selesai."
