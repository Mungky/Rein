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
        MosqDir     = Join-Path $root "mosquitto"
        MosqConf    = Join-Path $root "mosquitto\mosquitto.conf"
        MosqExe     = Join-Path $env:ProgramFiles "mosquitto\mosquitto.exe"
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
    if ((Test-Path $paths.MosqConf) -or (Test-Path $paths.BridgePy)) { $p += "data" }
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
        @{ Label = "Mosquitto (broker)"; On = [bool](Get-Process mosquitto -ErrorAction SilentlyContinue) },
        @{ Label = "Node-RED";           On = (Test-ProcessCommandLine "node.exe" "node-red") },
        @{ Label = "Bridge (data)";      On = (Test-ProcessCommandLine "python.exe" "bridge\.py") -or (Test-ProcessCommandLine "py.exe" "bridge\.py") }
    )
    foreach ($r in $rows) {
        if ($r.On) { Write-Host ("   [HIDUP] " + $r.Label) -ForegroundColor Green }
        else       { Write-Host ("   [mati ] " + $r.Label) -ForegroundColor DarkGray }
    }
    Write-Host ""
}

# --- Quick Tunnel (mode tes): URL acak, kembalikan alamatnya ----------------
function Start-QuickTunnel($cloudflared, [int]$port, [string]$logName) {
    $log = Join-Path (Split-Path -Parent $cloudflared) $logName
    # Matikan HANYA tunnel lama untuk port ini (biarkan tunnel port lain).
    Stop-ByCommandLine "cloudflared.exe" ":$port"
    Start-Sleep 1
    Remove-Item $log -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $cloudflared `
        -ArgumentList "tunnel", "--url", "http://127.0.0.1:$port" `
        -RedirectStandardError $log -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep 1
        $txt = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($txt -match "https://[a-z0-9-]+\.trycloudflare\.com") { return $Matches[0] }
    }
    Die "URL Quick Tunnel (port $port) tidak muncul dalam 30 dtk. Cek internet, ulangi."
}

# --- Supabase REST (mode tes): tulis alamat baru ke R-Net -------------------
function Update-SupabaseStream($cfg, [string]$newUrl, [string]$streamName) {
    $key = Get-Cfg $cfg "SUPABASE_SERVICE_KEY"
    $base = "$(Get-Cfg $cfg 'SUPABASE_URL')/rest/v1/scada_streams"
    $headers = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json"; Prefer = "return=representation" }
    $filter = if ($streamName) { "name=eq.$([uri]::EscapeDataString($streamName))" } else { "id=not.is.null" }
    try {
        $rows = Invoke-RestMethod -Method Patch -TimeoutSec 20 -Headers $headers `
            -Uri "${base}?${filter}" -Body (@{ hls_url = $newUrl } | ConvertTo-Json)
        if (-not $rows) { Warn "Belum ada stream '$streamName' di R-Net - buat di Kelola Screen lalu ulangi." }
        else { foreach ($r in $rows) { Write-Host ("   {0}  ->  {1}" -f $r.name, $newUrl) } }
    } catch { Warn "Gagal update alamat stream: $($_.Exception.Message)" }
}

function Update-SupabaseVnc($cfg, [string]$newUrl, [string]$vncSource, [string]$vncPass) {
    $key = Get-Cfg $cfg "SUPABASE_SERVICE_KEY"
    $base = "$(Get-Cfg $cfg 'SUPABASE_URL')/rest/v1/scada_streams"
    $headers = @{ apikey = $key; Authorization = "Bearer $key"; "Content-Type" = "application/json"; Prefer = "return=representation" }
    $filter = "source_type=eq.vnc"
    if ($vncSource) { $filter += "&name=eq.$([uri]::EscapeDataString($vncSource))" }
    try {
        $rows = Invoke-RestMethod -Method Get -TimeoutSec 20 -Headers $headers -Uri "${base}?${filter}&select=id,name"
        if (-not $rows) { Warn "Belum ada sumber VNC '$vncSource' di R-Net - buat di Kelola Screen lalu ulangi."; return }
        foreach ($r in $rows) {
            $patch = @{ url = $newUrl }
            if ($vncPass) { $patch.secret = $vncPass }
            Invoke-RestMethod -Method Patch -TimeoutSec 20 -Headers $headers `
                -Uri "${base}?id=eq.$($r.id)" -Body ($patch | ConvertTo-Json) | Out-Null
            Write-Host ("   {0}  ->  {1}{2}" -f $r.name, $newUrl, $(if ($vncPass) { " + password" } else { "" }))
        }
    } catch { Warn "Gagal update sumber VNC: $($_.Exception.Message)" }
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
            "data"   { "DATA    - data sensor (Mosquitto + Node-RED + bridge)" }
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
