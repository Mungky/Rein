# ==========================================================================
#  lib\common.ps1  -  fungsi bersama semua skrip deploy R-Net
#  (dipanggil lewat dot-sourcing: . "$PSScriptRoot\lib\common.ps1")
# ==========================================================================

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# --- Output berwarna --------------------------------------------------------
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Good($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[GAGAL] $m" -ForegroundColor Red; exit 1 }

# --- Lokasi standar ---------------------------------------------------------
# Skrip bisa dijalankan dari folder repo (deploy\) ATAU dari folder pasang
# (C:\rein-scada). Keduanya memakai tata letak yang sama.
function Get-ReinPaths([string]$root) {
    return [pscustomobject]@{
        Root        = $root
        Config      = Join-Path $root "config.env"
        MediaMtxDir = Join-Path $root "mediamtx"
        MediaMtxExe = Join-Path $root "mediamtx\mediamtx.exe"
        MediaMtxYml = Join-Path $root "mediamtx\mediamtx.yml"
        Cloudflared = Join-Path $root "cloudflared\cloudflared.exe"
        WebsocatExe = Join-Path $root "websocat\websocat.exe"
        TvnExe      = Join-Path $env:ProgramFiles "TightVNC\tvnserver.exe"
        ObsExe      = Join-Path $env:ProgramFiles "obs-studio\bin\64bit\obs64.exe"
        DataDir     = Join-Path $root "data"
        BridgePy    = Join-Path $root "data\bridge.py"
        NodeRedCmd  = Join-Path $env:APPDATA "npm\node-red.cmd"
    }
}

# --- config.env (KEY=VALUE) -------------------------------------------------
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

# Nilai config yang terisi sungguhan (bukan placeholder GANTI_...)
function Get-Cfg($cfg, [string]$key) {
    $v = $cfg[$key]
    if (-not $v) { return "" }
    $v = "$v".Trim()
    if ($v -match "^GANTI") { return "" }
    return $v
}

# Tulis file UTF-8 TANPA BOM. PENTING: Set-Content -Encoding UTF8 di PowerShell
# 5.1 menambahkan BOM, dan BOM membuat MediaMTX/Mosquitto gagal parse confignya.
function Write-TextNoBom($path, $text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($path, $text, $enc)
}

function New-Pass { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ }) }

# Tambah baris KEY=VALUE ke config.env HANYA jika kuncinya belum ada.
function Add-ConfigKey($configPath, [string[]]$lines) {
    $raw = if (Test-Path $configPath) { Get-Content $configPath -Raw } else { "" }
    $append = @()
    foreach ($l in $lines) {
        if ($l.StartsWith("#") -or $l.Trim() -eq "") { $append += $l; continue }
        $key = ($l -split "=", 2)[0].Trim()
        if ($raw -match "(?m)^\s*$([regex]::Escape($key))\s*=") { continue }
        $append += $l
    }
    # Kalau semua kunci sudah ada, jangan tulis apa-apa (komentar saja tidak berguna)
    if (-not ($append | Where-Object { $_ -notmatch "^\s*(#|$)" })) { return $false }
    $body = if ($raw.Trim() -eq "") { $append -join "`r`n" } else { $raw.TrimEnd() + "`r`n`r`n" + ($append -join "`r`n") }
    Write-TextNoBom $configPath ($body + "`r`n")
    return $true
}

# Set KEY=VALUE sungguhan: kalau barisnya sudah ada nilainya DITIMPA, kalau
# belum ada barisnya ditambah.
#
# Kenapa ini terpisah dari Add-ConfigKey: Add-ConfigKey melewati kunci yang
# barisnya sudah ada -- termasuk baris kosong seperti "TUNNEL_TOKEN=". Dulu itu
# membuat token named tunnel yang baru ditempel dibuang diam-diam, PC tetap
# jatuh ke mode tes, dan alamat mirror tidak pernah benar. Untuk nilai yang
# memang boleh berubah (token, hostname), SELALU pakai fungsi ini.
function Set-ConfigKey($configPath, [string]$key, [string]$value, [string]$comment) {
    $raw = if (Test-Path $configPath) { Get-Content $configPath -Raw } else { "" }
    $pattern = "(?m)^[ `t]*$([regex]::Escape($key))[ `t]*=.*$"
    if ($raw -match $pattern) {
        # MatchEvaluator, BUKAN string pengganti: .NET menafsirkan $1 / $& / $$ di
        # teks pengganti sebagai rujukan grup. Password DATABASE_URL boleh
        # mengandung '$' -- tanpa ini nilainya rusak diam-diam saat ditulis.
        $repl = [Text.RegularExpressions.MatchEvaluator]{ param($m) "$key=$value" }.GetNewClosure()
        $body = [regex]::Replace($raw, $pattern, $repl)
    } else {
        $head = if ($comment) { "`r`n# $comment`r`n" } else { "`r`n" }
        $body = if ($raw.Trim() -eq "") { "$key=$value" } else { $raw.TrimEnd() + "`r`n" + $head + "$key=$value" }
    }
    Write-TextNoBom $configPath ($body.TrimEnd() + "`r`n")
}

# Hapus baris KEY=... sepenuhnya (mis. membuang sisa kredensial mode tes).
function Remove-ConfigKey($configPath, [string[]]$keys) {
    if (-not (Test-Path $configPath)) { return }
    $raw = Get-Content $configPath -Raw
    foreach ($k in $keys) {
        $raw = [regex]::Replace($raw, "(?m)^[ `t]*$([regex]::Escape($k))[ `t]*=.*\r?\n?", "")
    }
    Write-TextNoBom $configPath ($raw.TrimEnd() + "`r`n")
}

# --- winget (repositori paket resmi Microsoft) ------------------------------
$script:HasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
function Install-WingetPkg($id, $label) {
    if (-not $script:HasWinget) {
        Warn "winget tidak ada - lewati $label. Update 'App Installer' dari Microsoft Store lalu ulangi."
        return $false
    }
    Info "Memasang $label versi terbaru lewat winget ..."
    & winget install --id $id --exact --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -eq 0) { Good "$label terpasang."; return $true }
    # -1978335189 = "sudah terpasang & sudah versi terbaru" - bukan error.
    if ($LASTEXITCODE -eq -1978335189) { Good "$label sudah versi terbaru."; return $true }
    Warn "winget gagal memasang $label (kode $LASTEXITCODE)."
    return $false
}

function Uninstall-WingetPkg($id, $label) {
    if (-not $script:HasWinget) { Warn "winget tidak ada - hapus $label manual lewat Settings > Apps."; return }
    Info "Menghapus $label lewat winget ..."
    & winget uninstall --id $id --exact --silent --accept-source-agreements
    if ($LASTEXITCODE -eq 0) { Good "$label dihapus." } else { Warn "winget tidak bisa menghapus $label (kode $LASTEXITCODE) - hapus manual bila perlu." }
}

# --- GitHub release ---------------------------------------------------------
function Get-LatestAsset($repo, $pattern) {
    $api = "https://api.github.com/repos/$repo/releases/latest"
    try {
        $rel = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "rein-deploy" } -TimeoutSec 30
    } catch {
        Die "Gagal menghubungi GitHub untuk $repo. Cek internet. ($($_.Exception.Message))"
    }
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { Die "Tidak menemukan file '$pattern' di rilis terbaru $repo." }
    return [pscustomobject]@{ Url = $asset.browser_download_url; Name = $asset.name; Version = $rel.tag_name }
}

function Get-ToTemp($url) {
    $tmp = Join-Path $env:TEMP ("rein_" + [guid]::NewGuid().ToString("N") + [IO.Path]::GetExtension($url))
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 300
    if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) { Die "Unduhan kosong: $url" }
    return $tmp
}

# --- Deteksi paket terpasang (dari file, bukan catatan - selalu jujur) ------
function Get-InstalledPackages($paths) {
    $p = @()
    if (Test-Path $paths.MediaMtxExe) { $p += "stream" }
    if ((Test-Path $paths.TvnExe) -and (Test-Path $paths.WebsocatExe)) { $p += "mirror" }
    if (Test-Path $paths.BridgePy) { $p += "data" }
    return $p
}

# --- Proses -----------------------------------------------------------------
# Matikan proses yang command line-nya cocok pola (mis. cloudflared tunnel :8888)
function Stop-ByCommandLine([string]$exeName, [string]$pattern) {
    Get-CimInstance Win32_Process -Filter "Name='$exeName'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match $pattern } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Test-ProcessCommandLine([string]$exeName, [string]$pattern) {
    $found = Get-CimInstance Win32_Process -Filter "Name='$exeName'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match $pattern }
    return [bool]$found
}

# --- Status satu baris ------------------------------------------------------
function Show-ServiceStatus($paths) {
    Write-Host ""
    Write-Host "Status layanan PC ini:" -ForegroundColor White
    $rows = @(
        @{ Label = "MediaMTX (stream)";  On = [bool](Get-Process mediamtx  -ErrorAction SilentlyContinue) },
        @{ Label = "Cloudflare Tunnel";  On = [bool](Get-Process cloudflared -ErrorAction SilentlyContinue) },
        @{ Label = "TightVNC (mirror)";  On = [bool](Get-Process tvnserver -ErrorAction SilentlyContinue) },
        @{ Label = "websocat (mirror)";  On = [bool](Get-Process websocat  -ErrorAction SilentlyContinue) },
        @{ Label = "Node-RED";           On = (Test-ProcessCommandLine "node.exe" "node-red") },
        @{ Label = "Bridge (data)";      On = (Test-ProcessCommandLine "python.exe" "bridge\.py") -or (Test-ProcessCommandLine "py.exe" "bridge\.py") }
    )
    foreach ($r in $rows) {
        if ($r.On) { Write-Host ("   [HIDUP] " + $r.Label) -ForegroundColor Green }
        else       { Write-Host ("   [mati ] " + $r.Label) -ForegroundColor DarkGray }
    }
    Write-Host ""
}

# --- Token named tunnel: bersihkan + periksa bentuknya ----------------------
# Token Cloudflare = base64 dari JSON {"a":akun,"t":id tunnel,"s":rahasia}.
# Diperiksa DI DEPAN karena kalau tidak, nilai ngawur tersimpan diam-diam dan
# baru ketahuan jauh kemudian sebagai "Provided Tunnel token is not valid" --
# jauh dari tempat salahnya. Dashboard menampilkan token di dalam perintah
# "cloudflared service install eyJ...", dan itu yang paling sering ikut tersalin.
function Format-TunnelToken([string]$raw) {
    $t = "$raw".Trim().Trim('"').Trim("'")
    # Buang bungkus perintah kalau seluruh baris dashboard ikut tertempel.
    if ($t -match '(?i)(?:service\s+install|--token)\s+(\S+)') { $t = $Matches[1] }
    return $t.Trim()
}

# Kembalikan "" kalau bentuknya benar, atau kalimat alasan kalau salah.
function Test-TunnelToken([string]$token) {
    if ([string]::IsNullOrWhiteSpace($token)) { return "kosong" }
    if ($token -match '^\s*https?://') {
        return "itu ALAMAT (hostname), bukan token. Hostname diisi di pertanyaan berikutnya."
    }
    if ($token -match '\s') { return "mengandung spasi - kemungkinan tersalin sebagian kalimat." }
    if ($token.Length -lt 60) { return "terlalu pendek ($($token.Length) karakter; token asli ratusan karakter)." }
    if ($token -notmatch '^[A-Za-z0-9+/=_-]+$') { return "mengandung karakter yang tidak ada di token Cloudflare." }
    try {
        # base64url -> base64 standar, lalu lengkapi padding.
        $b = $token.Replace('-', '+').Replace('_', '/')
        if ($b.Length % 4) { $b = $b.PadRight($b.Length + (4 - $b.Length % 4), '=') }
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b))
    } catch {
        return "bukan base64 yang sah - kemungkinan tersalin sebagian saja."
    }
    if ($json -notmatch '"a"' -or $json -notmatch '"t"' -or $json -notmatch '"s"') {
        return "base64-nya sah tapi isinya bukan token tunnel (tidak ada field a/t/s)."
    }
    return ""
}

# --- Password TightVNC ------------------------------------------------------
# TightVNC menyimpan password sebagai DES-ECB 8 byte dengan kunci tetap milik
# protokol VNC -- ini OBFUSCATION, bukan hash: bisa dibaca balik (dipakai saat
# perlu menyalin password lama ke config.env). Keamanan riil = view-only di
# server + LoopbackOnly, bukan kerahasiaan nilai ini.
$script:VncKey = [byte[]](0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0)

function New-VncDes {
    $des = New-Object Security.Cryptography.DESCryptoServiceProvider
    $des.Mode = [Security.Cryptography.CipherMode]::ECB
    $des.Padding = [Security.Cryptography.PaddingMode]::None
    $des.Key = $script:VncKey
    return $des
}

function ConvertTo-VncPass([string]$plain) {
    $data = New-Object byte[] 8
    $src = [Text.Encoding]::ASCII.GetBytes($plain)
    [Array]::Copy($src, $data, [Math]::Min(8, $src.Length))
    return (New-VncDes).CreateEncryptor().TransformFinalBlock($data, 0, 8)
}

function ConvertFrom-VncPass([byte[]]$enc) {
    if (-not $enc -or $enc.Length -lt 8) { return "" }
    $plain = (New-VncDes).CreateDecryptor().TransformFinalBlock($enc, 0, 8)
    return ([Text.Encoding]::ASCII.GetString($plain)).TrimEnd([char]0)
}

# Protokol VNC hanya memakai 8 karakter pertama. Dipotong DI SINI supaya
# registry dan config.env tidak pernah berbeda (dulu: ketik 9 karakter ->
# registry simpan 8, config.env tulis 9 -> auth gagal tanpa sebab yang jelas).
function Limit-VncPass([string]$plain) {
    if ($plain.Length -gt 8) {
        Warn "Password dipotong jadi 8 karakter (batas protokol VNC): $($plain.Substring(0,8))"
        return $plain.Substring(0, 8)
    }
    return $plain
}

$script:RegVncHkcu = "HKCU:\Software\TightVNC\Server"
$script:RegVncHives = @(
    "HKCU:\Software\TightVNC\Server",
    "HKLM:\SOFTWARE\TightVNC\Server",
    "HKLM:\SOFTWARE\WOW6432Node\TightVNC\Server"
)

# Cari password di SEMUA hive, bukan HKCU saja.
#
# Kenapa: password bisa saja diset lewat GUI TightVNC "Service Mode
# Configuration", dan itu menulis ke HKLM. Kalau di sini hanya HKCU yang
# dilihat, installer mengira PC belum punya password padahal sudah -- lalu
# menulis pengerasan (UseVncAuthentication=1) ke HKCU yang kosong, dan mode
# APLIKASI jadi mewajibkan password yang tidak dimilikinya. Gejalanya:
# "Server is not configured properly" di setiap koneksi.
function Get-VncPassBytes([string]$name) {
    foreach ($h in $script:RegVncHives) {
        if (-not (Test-Path $h)) { continue }
        $v = (Get-ItemProperty $h -Name $name -ErrorAction SilentlyContinue).$name
        if ($v) { return $v }
    }
    return $null
}

# Hive mana yang menentukan: mode APLIKASI (tvnserver -run) baca HKCU,
# mode SERVICE baca HKLM. Dipakai untuk swa-uji yang jujur.
function Get-VncActiveHive {
    $svc = Get-Service tvnserver -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        return [pscustomobject]@{ Mode = "SERVICE"; Path = "HKLM:\SOFTWARE\TightVNC\Server" }
    }
    return [pscustomobject]@{ Mode = "APLIKASI"; Path = $script:RegVncHkcu }
}

# Apakah hive milik mode yang sedang jalan punya password? Kembalikan "" kalau
# beres, atau kalimat alasan kalau tidak.
function Test-VncReady {
    $a = Get-VncActiveHive
    $p = Get-ItemProperty $a.Path -ErrorAction SilentlyContinue
    if (-not $p) { return "TightVNC mode $($a.Mode) membaca $($a.Path), tapi key itu belum ada." }
    if (-not $p.PasswordViewOnly) {
        return "TightVNC mode $($a.Mode) membaca $($a.Path), dan di situ password KOSONG."
    }
    return ""
}

# Tulis password + pengerasan ke HKCU, lalu cermin ke HKLM (64-bit dan
# WOW6432Node) lewat helper ber-Administrator.
#
# DUA TEMPAT, sengaja: mode APLIKASI membaca HKCU, mode SERVICE membaca HKLM.
# Kalau hanya salah satu terisi, mode yang lain melayani TANPA password dan
# TightVNC menolak dengan "Server is not configured properly".
#
# AllowLoopback=1 WAJIB: websocat menyambung dari 127.0.0.1 dan TightVNC bawaan
# MENOLAK loopback ("Sorry, loopback connections are not enabled").
# LoopbackOnly=1 mengunci port 5900 dari LAN -- satu-satunya jalan masuk dari
# luar adalah websocat + tunnel.
function Set-VncRegistry([byte[]]$ctrlEnc, [byte[]]$viewEnc) {
    # JANGAN pernah menulis pengerasan ke hive yang tak punya password.
    # UseVncAuthentication=1 tanpa password = server MEWAJIBKAN password yang
    # tidak dimilikinya, lalu menolak semua koneksi dengan
    # "Server is not configured properly". Lebih baik tidak menulis apa pun.
    if (-not ($ctrlEnc -and $viewEnc)) {
        Warn "Password VNC tidak ditemukan di hive mana pun - setelan TightVNC tidak ditulis."
        Warn "Isi password dulu (install.bat atau kredensial.bat pilihan [V])."
        return
    }

    New-Item -Path $script:RegVncHkcu -Force | Out-Null
    New-ItemProperty -Path $script:RegVncHkcu -Name Password         -PropertyType Binary -Value $ctrlEnc -Force | Out-Null
    New-ItemProperty -Path $script:RegVncHkcu -Name PasswordViewOnly -PropertyType Binary -Value $viewEnc -Force | Out-Null
    foreach ($d in @{ UseVncAuthentication = 1; AcceptHttpConnections = 0; AllowLoopback = 1; LoopbackOnly = 1 }.GetEnumerator()) {
        New-ItemProperty -Path $script:RegVncHkcu -Name $d.Key -PropertyType DWord -Value $d.Value -Force | Out-Null
    }
    Good "TightVNC (mode aplikasi/HKCU): password + loopback-only diset."

    $ctrlHex = ($ctrlEnc | ForEach-Object { $_.ToString("X2") }) -join ""
    $viewHex = ($viewEnc | ForEach-Object { $_.ToString("X2") }) -join ""
    $mirror = @"
function Hex2Bytes(`$h) { `$b = New-Object byte[] (`$h.Length/2); for (`$i=0; `$i -lt `$b.Length; `$i++) { `$b[`$i] = [Convert]::ToByte(`$h.Substring(`$i*2,2),16) }; return `$b }
foreach (`$k in @('HKLM:\SOFTWARE\TightVNC\Server','HKLM:\SOFTWARE\WOW6432Node\TightVNC\Server')) {
    New-Item -Path `$k -Force | Out-Null
    New-ItemProperty -Path `$k -Name Password             -PropertyType Binary -Value (Hex2Bytes '$ctrlHex') -Force | Out-Null
    New-ItemProperty -Path `$k -Name PasswordViewOnly     -PropertyType Binary -Value (Hex2Bytes '$viewHex') -Force | Out-Null
    New-ItemProperty -Path `$k -Name UseVncAuthentication  -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path `$k -Name AcceptHttpConnections -PropertyType DWord -Value 0 -Force | Out-Null
    New-ItemProperty -Path `$k -Name AllowLoopback         -PropertyType DWord -Value 1 -Force | Out-Null
    New-ItemProperty -Path `$k -Name LoopbackOnly          -PropertyType DWord -Value 1 -Force | Out-Null
}
`$svc = Get-Service tvnserver -ErrorAction SilentlyContinue
if (`$svc -and `$svc.Status -eq 'Running') { Restart-Service tvnserver -Force -ErrorAction SilentlyContinue }
"@
    $tmpPs = Join-Path $env:TEMP ("rein_vnc_hklm_" + [guid]::NewGuid().ToString("N") + ".ps1")
    Write-TextNoBom $tmpPs $mirror
    try {
        Start-Process powershell -Verb RunAs -Wait -ArgumentList `
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$tmpPs`""
        Good "Setelan dicermin ke HKLM (64-bit + WOW6432Node)."
    } catch {
        Warn "Gagal menulis HKLM (butuh Administrator). Kalau TightVNC dijalankan"
        Warn "sebagai SERVICE, dia akan bilang 'Server is not configured properly'."
    }
    Remove-Item $tmpPs -Force -ErrorAction SilentlyContinue
}

# --- Hostname publik: bersihkan + periksa bentuknya -------------------------
# Terima tempelan apa adanya ("https://mirror-x.remula.online/scada/...") dan
# ambil hostname-nya saja. Diperiksa karena tiga isian tunnel (token, hostname,
# nama sumber R-Net) gampang tertukar -- dan kalau tertukar, gejalanya baru
# muncul jauh kemudian sebagai "mirror tidak pernah tampil".
function Format-Hostname([string]$raw) {
    return ("$raw".Trim().Trim('"').Trim("'") -replace '^\s*[a-z]+://', '' -replace '/.*$', '' -replace ':\d+$', '')
}

# Kembalikan "" kalau bentuknya benar, atau kalimat alasan kalau salah.
function Test-Hostname([string]$hostname) {
    if ([string]::IsNullOrWhiteSpace($hostname)) { return "kosong" }
    if ($hostname -match '\s') { return "mengandung spasi." }
    if ($hostname -notmatch '\.') {
        return "tidak ada titiknya - ini terlihat seperti NAMA sumber di R-Net, bukan alamat internet."
    }
    if ($hostname -match '^[A-Za-z0-9+/=]{60,}$') { return "ini terlihat seperti TOKEN, bukan hostname." }
    if ($hostname -notmatch '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$') {
        return "bukan nama domain yang sah."
    }
    return ""
}

# --- Named tunnel: tunggu sampai benar-benar tersambung ---------------------
# cloudflared menulis "Registered tunnel connection" begitu satu koneksi ke tepi
# Cloudflare berhasil. Tanpa pengecekan ini saklar bilang "OK" padahal token
# salah / tidak ada internet, dan pemakai baru sadar saat layar R-Net kosong.
function Wait-TunnelUp([string]$logPath, [int]$timeoutSec = 25) {
    for ($i = 0; $i -lt $timeoutSec; $i++) {
        Start-Sleep 1
        $txt = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
        if (-not $txt) { continue }
        if ($txt -match "Registered tunnel connection") { return "ok" }
        if ($txt -match "(?i)Unauthorized|invalid tunnel|token is invalid|failed to parse token") { return "token" }
    }
    return "timeout"
}

# --- Pilihan paket (menu / argumen) -----------------------------------------
# Terima argumen bebas: "stream", "mirror", "data", "semua"/"all"/"a", angka
# 1/2/3. Tanpa argumen -> menu interaktif (hanya paket yang relevan).
function Select-Packages([string[]]$args_, [string[]]$available, [string]$verb) {
    $norm = @()
    foreach ($a in ($args_ | Where-Object { $_ })) {
        switch -Regex ($a.ToLower().Trim()) {
            "^(1|stream)$"        { $norm += "stream" }
            "^(2|mirror|vnc)$"    { $norm += "mirror" }
            "^(3|data|mqtt)$"     { $norm += "data" }
            "^(a|all|semua)$"     { $norm += $available }
            default { Warn "Paket tidak dikenal: '$a' (pilihan: stream, mirror, data, semua)" }
        }
    }
    $norm = $norm | Where-Object { $available -contains $_ } | Select-Object -Unique
    if ($norm.Count -gt 0) { return $norm }

    # Menu interaktif
    Write-Host ""
    Write-Host "Paket yang bisa di-$verb di PC ini:" -ForegroundColor White
    $map = @{}
    $i = 0
    foreach ($p in $available) {
        $i++
        $label = switch ($p) {
            "stream" { "STREAM  - siaran layar/HMI (MediaMTX + tunnel + OBS)" }
            "mirror" { "MIRROR  - spion layar PC ini (TightVNC + websocat)" }
            "data"   { "DATA    - data sensor (Node-RED + bridge; broker di VPS)" }
        }
        Write-Host "  [$i] $label"
        $map["$i"] = $p
    }
    Write-Host "  [A] Semua      [Q] Batal"
    $pick = Read-Host "Pilih (mis. 1 atau 1,3 - Enter = Semua)"
    if ($pick -match "^(q|quit|batal)$") { return @() }
    if ([string]::IsNullOrWhiteSpace($pick) -or $pick -match "^(a|all|semua)$") { return $available }
    $out = @()
    foreach ($tok in ($pick -split "[,; ]+" | Where-Object { $_ })) {
        if ($map.ContainsKey($tok.Trim())) { $out += $map[$tok.Trim()] }
        else { Warn "Pilihan '$tok' dilewati." }
    }
    return ($out | Select-Object -Unique)
}
