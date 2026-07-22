# ==========================================================================
#  kredensial.ps1  -  Ubah kredensial R-Net tanpa memasang ulang apa pun
# ==========================================================================
#  Dipakai kalau ada yang SALAH KETIK saat pasang. install.bat sengaja tidak
#  menanyakan ulang nilai yang sudah terisi (supaya aman dijalankan berkali-kali
#  tanpa menghapus password yang sedang bekerja) -- jadi pembetulan dikerjakan
#  di sini.
#
#  Tidak mengunduh, tidak memasang, tidak menyentuh nilai yang tidak dipilih.
#  Yang diubah hanya: config.env, mediamtx.yml (password), dan registry TightVNC.
# ==========================================================================

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib\common.ps1")
$P = Get-ReinPaths $Here

if (-not (Test-Path $P.Config)) { Die "config.env tidak ada di $Here. Jalankan install.bat dulu." }

# Nilai rahasia tidak pernah dicetak utuh -- layar ini sering dilihat orang lain
# di ruang server, dan nilai-nilai ini cukup untuk mengakses database/kamera.
function Show-Value([string]$key, [string]$val) {
    if ([string]::IsNullOrWhiteSpace($val)) { return "<KOSONG>" }
    if ($key -match 'PASSWORD|TOKEN|DATABASE_URL') { return "<terisi, $($val.Length) karakter>" }
    return $val
}

# --- Isian yang tinggal ditulis ke config.env -------------------------------
# Validator opsional: dijalankan sampai benar (atau dibatalkan dengan Enter).
$items = @(
    @{ Key = "TUNNEL_TOKEN";      Label = "Token named tunnel Cloudflare"; Check = "token" }
    @{ Key = "STREAM_HOSTNAME";   Label = "Hostname publik STREAM";        Check = "host"  }
    @{ Key = "MIRROR_HOSTNAME";   Label = "Hostname publik MIRROR";        Check = "host"  }
    @{ Key = "STREAM_PATH";       Label = "Path MediaMTX (default scada)"; Check = ""      }
    @{ Key = "DATABASE_URL";      Label = "Alamat database R-Net (bridge)"; Check = "db"   }
    @{ Key = "MQTT_HOST";         Label = "Alamat broker MQTT di VPS (catatan)"; Check = "" }
    @{ Key = "MQTT_PORT";         Label = "Port broker MQTT (catatan)";    Check = ""      }
    @{ Key = "MQTT_USERNAME";     Label = "Username broker MQTT (catatan)"; Check = ""     }
    @{ Key = "SITE_NAME";         Label = "Label PC/site ini";             Check = ""      }
)

function Test-Isian([string]$check, [string]$val) {
    switch ($check) {
        "token" { return Test-TunnelToken $val }
        "host"  { return Test-Hostname $val }
        "db"    {
            if ($val -notmatch '^postgres(ql)?://') { return "harus diawali postgresql:// (salin dari Supabase > Connection string)." }
            return ""
        }
        default { return "" }
    }
}

function Format-Isian([string]$check, [string]$val) {
    switch ($check) {
        "token" { return Format-TunnelToken $val }
        "host"  { return Format-Hostname $val }
        default { return $val.Trim() }
    }
}

# --- Password MediaMTX ------------------------------------------------------
# Ditulis langsung ke mediamtx.yml (bukan config.env): MediaMTX membaca
# passwordnya dari situ. Baris yang diganti = "pass:" milik user obs/rein-viewer.
function Set-MediaMtxPass {
    if (-not (Test-Path $P.MediaMtxYml)) { Warn "mediamtx.yml tidak ada - paket STREAM belum dipasang."; return }
    Write-Host ""
    Info "Password MediaMTX (Enter = biarkan yang sekarang):"
    $pub  = (Read-Host "   Password OBS (publish)").Trim()
    $view = (Read-Host "   Password penonton (viewer, diisi ke Kelola Screen)").Trim()
    if (-not $pub -and -not $view) { Warn "Tidak ada yang diubah."; return }

    $yml = Get-Content $P.MediaMtxYml -Raw
    # Ganti nilai "pass:" pada blok user yang tepat. Pola: "- user: obs" lalu
    # baris "pass: ..." berikutnya (indentasi bebas, komentar di antaranya aman).
    function Set-UserPass([string]$text, [string]$user, [string]$newPass) {
        if (-not $newPass) { return $text }
        $re = "(?ms)(-\s*user:\s*$([regex]::Escape($user))\s*\r?\n(?:[^\r\n]*\r?\n)*?\s*pass:\s*)([^\r\n]*)"
        if ($text -notmatch $re) { Warn "Tidak menemukan user '$user' di mediamtx.yml - dilewati."; return $text }
        $ev = [Text.RegularExpressions.MatchEvaluator]{ param($m) $m.Groups[1].Value + $newPass }.GetNewClosure()
        return [regex]::Replace($text, $re, $ev)
    }
    $yml = Set-UserPass $yml "obs" $pub
    $yml = Set-UserPass $yml "rein-viewer" $view
    Write-TextNoBom $P.MediaMtxYml $yml
    Good "mediamtx.yml diperbarui."
    if ($pub)  { Warn "Ganti juga Stream Key di OBS: scada?user=obs&pass=$pub" }
    if ($view) { Warn "Ganti juga Password (read) di R-Net > Kelola Screen." }
    if (Get-Process mediamtx -ErrorAction SilentlyContinue) {
        Warn "MediaMTX sedang jalan - matikan & nyalakan lagi (stop.bat lalu start.bat)."
    }
}

# --- Password TightVNC ------------------------------------------------------
# Registry DAN config.env diperbarui bersama: kalau hanya salah satu, R-Net
# mengirim password yang tidak lagi dikenali server dan panel VNC gagal auth.
function Set-VncPass {
    Write-Host ""
    Info "Password VNC (maks 8 karakter; Enter = biarkan yang sekarang):"
    $ctrl = (Read-Host "   Password KONTROL (maintenance - JANGAN diisi ke R-Net)").Trim()
    $view = (Read-Host "   Password VIEW-ONLY (yang dipakai R-Net)").Trim()
    if (-not $ctrl -and -not $view) { Warn "Tidak ada yang diubah."; return }

    $ctrlEnc = if ($ctrl) { ConvertTo-VncPass (Limit-VncPass $ctrl) } else { Get-VncPassBytes "Password" }
    $viewEnc = if ($view) { ConvertTo-VncPass (Limit-VncPass $view) } else { Get-VncPassBytes "PasswordViewOnly" }
    if (-not ($ctrlEnc -and $viewEnc)) {
        Warn "Kedua password harus ada (kontrol + view-only). Isi keduanya."
        return
    }
    Set-VncRegistry $ctrlEnc $viewEnc
    # config.env selalu disamakan dengan isi registry, bukan dengan yang diketik
    # -- kalau password dipotong jadi 8 karakter, yang tersimpan tetap cocok.
    Set-ConfigKey $P.Config "VNC_VIEW_PASSWORD" (ConvertFrom-VncPass $viewEnc)
    Good "Password VNC diperbarui (registry + config.env)."
    Warn "Ganti juga Password di R-Net > Kelola Screen > sumber VNC."
    if (Get-Process tvnserver -ErrorAction SilentlyContinue) {
        Warn "TightVNC sedang jalan - matikan & nyalakan lagi (stop.bat lalu start.bat)."
    }
}

# --- Perbaiki hive TightVNC -------------------------------------------------
# TightVNC menyimpan password di dua tempat terpisah: mode APLIKASI membaca
# HKCU, mode SERVICE membaca HKLM. Password yang diset lewat GUI "Service Mode
# Configuration" hanya mendarat di HKLM -- kalau lalu dijalankan mode aplikasi,
# server mewajibkan password yang tidak dilihatnya dan menolak semua koneksi
# ("Server is not configured properly").
#
# Ini menyalin password yang ADA (dari hive mana pun) ke SEMUA hive, tanpa
# perlu mengetik ulang. config.env ikut disamakan.
function Repair-VncHive {
    Write-Host ""
    $a = Get-VncActiveHive
    Info "Mode TightVNC yang sedang jalan: $($a.Mode) -> membaca $($a.Path)"
    $ctrlEnc = Get-VncPassBytes "Password"
    $viewEnc = Get-VncPassBytes "PasswordViewOnly"
    if (-not ($ctrlEnc -and $viewEnc)) {
        Warn "Tidak ada password di hive mana pun - tidak ada yang bisa disalin."
        Warn "Pakai pilihan [V] untuk mengisi password baru."
        return
    }
    Info "Password ditemukan - disalin ke semua hive (HKCU + HKLM 64/32-bit)."
    Set-VncRegistry $ctrlEnc $viewEnc
    Set-ConfigKey $P.Config "VNC_VIEW_PASSWORD" (ConvertFrom-VncPass $viewEnc)

    $why = Test-VncReady
    if ($why) { Warn "MASIH BELUM BERES: $why" }
    else {
        Good "Hive milik mode $($a.Mode) sekarang berisi password."
        if (Get-Process tvnserver -ErrorAction SilentlyContinue) {
            Warn "TightVNC sedang jalan - stop.bat lalu start.bat supaya dibaca ulang."
        }
    }
}

# ==========================================================================
#  Menu
# ==========================================================================
while ($true) {
    $cfg = Read-Config $P.Config
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor White
    Write-Host "  Kredensial R-Net - $($P.Root)" -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor White
    $n = 0
    $map = @{}
    foreach ($it in $items) {
        $n++
        $map["$n"] = $it
        $val = Get-Cfg $cfg $it.Key
        $tanda = ""
        if ($val -and $it.Check) {
            $why = Test-Isian $it.Check $val
            if ($why) { $tanda = "   <-- TIDAK SAH: $why" }
        }
        Write-Host ("  [{0}] {1,-22} {2}{3}" -f $n, $it.Key, (Show-Value $it.Key $val), $tanda) `
            -ForegroundColor $(if ($tanda) { "Yellow" } else { "Gray" })
    }
    Write-Host "  [M] Password MediaMTX (publish + viewer)"
    Write-Host "  [V] Password VNC (kontrol + view-only)"
    $vncWhy = Test-VncReady
    if ($vncWhy) {
        Write-Host "  [S] Perbaiki hive TightVNC   <-- PERLU: $vncWhy" -ForegroundColor Yellow
    } else {
        Write-Host "  [S] Perbaiki hive TightVNC (salin password antar mode aplikasi/service)"
    }
    Write-Host "  [Q] Selesai"
    Write-Host ""
    $pick = (Read-Host "Pilih yang mau diubah").Trim()

    if ($pick -match '^(q|quit|selesai|)$') { break }
    if ($pick -match '^(m)$') { Set-MediaMtxPass; continue }
    if ($pick -match '^(v)$') { Set-VncPass; continue }
    if ($pick -match '^(s)$') { Repair-VncHive; continue }
    if (-not $map.ContainsKey($pick)) { Warn "Pilihan '$pick' tidak ada."; continue }

    $it = $map[$pick]
    Write-Host ""
    Info "$($it.Label)"
    Info "Sekarang: $(Show-Value $it.Key (Get-Cfg $cfg $it.Key))"
    $baru = ""
    for ($i = 1; $i -le 3; $i++) {
        $ketik = Read-Host "   Nilai baru (Enter = batal)"
        if ([string]::IsNullOrWhiteSpace($ketik)) { $baru = ""; break }
        $baru = Format-Isian $it.Check $ketik
        $why = Test-Isian $it.Check $baru
        if (-not $why) { break }
        Warn "Belum benar: $why"
        $baru = ""
        if ($i -eq 3) { Warn "Tiga kali belum cocok - dibatalkan." }
    }
    if (-not $baru) { Warn "$($it.Key) tidak diubah."; continue }
    Set-ConfigKey $P.Config $it.Key $baru
    Good "$($it.Key) diperbarui."
    if ($it.Key -eq "TUNNEL_TOKEN" -and (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
        Warn "Tunnel sedang jalan dengan token lama - stop.bat lalu start.bat."
    }
}

Write-Host ""
Good "Selesai. Nyalakan ulang layanan (stop.bat lalu start.bat) supaya nilai baru dipakai."
Write-Host ""
