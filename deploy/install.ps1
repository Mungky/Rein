# ==========================================================================
#  install.ps1  -  Pemasang R-Net untuk PC lokal (pilih paket, 1x jalan)
# ==========================================================================
#  Paket:
#    [1] STREAM - siaran layar/HMI : OBS + MediaMTX + Cloudflare Tunnel
#    [2] MIRROR - spion layar PC   : TightVNC + websocat (+ tunnel yang sama)
#    [3] DATA   - data sensor      : Mosquitto + Node-RED + bridge (Python)
#
#  Semua kredensial ditulis ke SATU file: C:\rein-scada\config.env
#  Setelah pasang: pakai start.bat / stop.bat / uninstall.bat di C:\rein-scada.
#
#  Keamanan:
#    - Hanya sumber resmi: github.com/bluenviron/mediamtx (SHA-256 dicetak),
#      github.com/cloudflare/cloudflared (tanda tangan Authenticode
#      diverifikasi), github.com/vi/websocat (SHA-256 dicetak), dan paket
#      winget resmi (Mosquitto/Node.js/OBS/TightVNC/Python).
#    - TANPA autostart/service: semua hidup-mati lewat saklar start/stop.
#    - TIDAK menimpa config yang sudah ada (mediamtx.yml / config.env /
#      mosquitto.conf / password VNC). Aman dijalankan berulang.
# ==========================================================================

param(
    [string]$InstallDir = "C:\rein-scada",
    [switch]$Force,                        # unduh/pasang ulang walau sudah ada
    [string]$DomainRein = "https://rein.remula-inti.com",
    [string[]]$Paket                       # mis. -Paket stream,data (kosong = menu)
)

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here "lib\common.ps1")
$P = Get-ReinPaths $InstallDir

Write-Host ""
Write-Host "==========================================================" -ForegroundColor White
Write-Host "  Pemasang R-Net - PC lokal" -ForegroundColor White
Write-Host "  Target folder: $InstallDir" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor White

# --- 0. Pilih paket ---------------------------------------------------------
$sel = Select-Packages $Paket @("stream", "mirror", "data") "pasang"
if ($sel.Count -eq 0) { Die "Tidak ada paket dipilih." }
$doStream = $sel -contains "stream"
$doMirror = $sel -contains "mirror"
$doData   = $sel -contains "data"
Info ("Paket dipilih: " + (($sel | ForEach-Object { $_.ToUpper() }) -join " + "))

# --- 0.5 Folder -------------------------------------------------------------
foreach ($d in @($InstallDir, (Join-Path $InstallDir "lib"))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# ==========================================================================
#  TUNNEL (dipakai STREAM & MIRROR) - cloudflared + token named tunnel
# ==========================================================================
if ($doStream -or $doMirror) {

# --- cloudflared.exe (verifikasi tanda tangan) ------------------------------
$CfDir = Split-Path -Parent $P.Cloudflared
if (-not (Test-Path $CfDir)) { New-Item -ItemType Directory -Path $CfDir -Force | Out-Null }
if ((Test-Path $P.Cloudflared) -and -not $Force) {
    Good "cloudflared.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
} else {
    Info "Mengunduh cloudflared terbaru dari github.com/cloudflare/cloudflared ..."
    $a = Get-LatestAsset "cloudflare/cloudflared" "^cloudflared-windows-amd64\.exe$"
    $tmp = Get-ToTemp $a.Url
    $sig = Get-AuthenticodeSignature $tmp
    if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "Cloudflare") {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Die "Tanda tangan digital cloudflared.exe TIDAK valid ($($sig.Status)). Dibatalkan demi keamanan."
    }
    Move-Item $tmp $P.Cloudflared -Force
    Good "cloudflared $($a.Version) terpasang. Tanda tangan: Cloudflare (Valid)."
}

# --- Token named tunnel (MODE PRODUKSI) -------------------------------------
$cfgNow = Read-Config $P.Config
if (Get-Cfg $cfgNow "TUNNEL_TOKEN") {
    Good "TUNNEL_TOKEN sudah terisi di config.env (mode produksi)."
} else {
    Write-Host ""
    Info "MODE PRODUKSI memakai NAMED TUNNEL Cloudflare: alamat stream/mirror"
    Info "permanen (domain sendiri), tidak berubah tiap start. Cara membuatnya:"
    Info "docs\PANDUAN-TUNNEL.md (5 menit, sekali saja per PC)."
    $tok = Read-Host "   TUNNEL_TOKEN (Enter = lewati, pakai mode TES dulu)"
    if (-not [string]::IsNullOrWhiteSpace($tok)) {
        $sHost = ""
        $mHost = ""
        if ($doStream) { $sHost = Read-Host "   STREAM_HOSTNAME (mis. stream-pabrik1.remula-inti.com)" }
        if ($doMirror) { $mHost = Read-Host "   MIRROR_HOSTNAME (mis. mirror-pabrik1.remula-inti.com)" }
        Add-ConfigKey $P.Config @(
            "# [TUNNEL] Named tunnel Cloudflare - mode produksi (docs\PANDUAN-TUNNEL.md)",
            "TUNNEL_TOKEN=$($tok.Trim())",
            "STREAM_HOSTNAME=$($sHost.Trim())",
            "MIRROR_HOSTNAME=$($mHost.Trim())"
        ) | Out-Null
        Good "Token tunnel disimpan (mode produksi)."
    } else {
        Warn "Tanpa token = MODE TES: URL acak baru tiap start (trycloudflare.com)."
        Info "Supaya alamat baru tertulis otomatis ke R-Net saat mode tes, boleh isi:"
        $sUrl = Read-Host "   SUPABASE_URL (Enter = tempel alamat manual saja)"
        $sKey = ""
        if (-not [string]::IsNullOrWhiteSpace($sUrl)) { $sKey = Read-Host "   SUPABASE_SERVICE_KEY (service_role)" }
        $names = @()
        if ($doStream) {
            $sn = Read-Host "   STREAM_NAME - nama stream mesin ini di Kelola Screen (kosong = semua)"
            $names += "STREAM_NAME=$($sn.Trim())"
        }
        if ($doMirror) {
            $vs = Read-Host "   VNC_SOURCE - nama sumber VNC PC ini di Kelola Screen (kosong = semua)"
            $names += "VNC_SOURCE=$($vs.Trim())"
        }
        Add-ConfigKey $P.Config (@(
            "# [MODE TES] Quick Tunnel - URL acak tiap start; kredensial di bawah",
            "# hanya untuk menuliskan alamat baru itu ke R-Net otomatis.",
            "TUNNEL_TOKEN=",
            "SUPABASE_URL=$($sUrl.Trim())",
            "SUPABASE_SERVICE_KEY=$($sKey.Trim())"
        ) + $names) | Out-Null
        Good "Mode tes disiapkan."
    }
}

} # akhir TUNNEL

# ==========================================================================
#  [1] STREAM - MediaMTX + mediamtx.yml + OBS
# ==========================================================================
if ($doStream) {

if (-not (Test-Path $P.MediaMtxDir)) { New-Item -ItemType Directory -Path $P.MediaMtxDir -Force | Out-Null }

# --- mediamtx.exe (zip resmi + hash dicetak) --------------------------------
if ((Test-Path $P.MediaMtxExe) -and -not $Force) {
    Good "mediamtx.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
} else {
    Info "Mengunduh MediaMTX terbaru dari github.com/bluenviron/mediamtx ..."
    $a = Get-LatestAsset "bluenviron/mediamtx" "windows_amd64\.zip$"
    $zip = Get-ToTemp $a.Url
    $sha = (Get-FileHash $zip -Algorithm SHA256).Hash
    Info "   Sumber : $($a.Url)"
    Info "   SHA-256: $sha"
    $ex = Join-Path $env:TEMP ("rein_mtx_" + [guid]::NewGuid().ToString("N"))
    Expand-Archive -Path $zip -DestinationPath $ex -Force
    $found = Get-ChildItem -Path $ex -Recurse -Filter "mediamtx.exe" | Select-Object -First 1
    if (-not $found) { Die "mediamtx.exe tidak ada di dalam zip." }
    Move-Item $found.FullName $P.MediaMtxExe -Force
    Remove-Item $zip, $ex -Recurse -Force -ErrorAction SilentlyContinue
    Good "MediaMTX $($a.Version) terpasang."
}

# --- mediamtx.yml (jangan timpa) --------------------------------------------
if (Test-Path $P.MediaMtxYml) {
    Good "mediamtx.yml sudah ada - password lama dipertahankan (tidak ditimpa)."
} else {
    $tpl = Join-Path $Here "stream\mediamtx.yml"
    if (-not (Test-Path $tpl)) { Die "Template stream\mediamtx.yml tidak ada di folder installer." }
    Write-Host ""
    Info "Password pemancar (Enter = buat otomatis yang kuat):"
    $pPub = Read-Host "   Password OBS (publish)"
    if ([string]::IsNullOrWhiteSpace($pPub)) { $pPub = New-Pass; Write-Host "   -> dibuatkan: $pPub" }
    $pView = Read-Host "   Password penonton (viewer)"
    if ([string]::IsNullOrWhiteSpace($pView)) { $pView = New-Pass; Write-Host "   -> dibuatkan: $pView" }
    $yml = (Get-Content $tpl -Raw).
        Replace("https://GANTI_DOMAIN_REIN", $DomainRein).
        Replace("GANTI_DOMAIN_REIN", ($DomainRein -replace '^https?://','')).
        Replace("GANTI_PASSWORD_PUBLISH", $pPub).
        Replace("GANTI_PASSWORD_VIEWER", $pView)
    Write-TextNoBom $P.MediaMtxYml $yml
    Good "mediamtx.yml dibuat."
    Warn "CATAT password ini - publish untuk OBS, viewer untuk Kelola Screen R-Net."
}

Add-ConfigKey $P.Config @(
    "# [STREAM] Path MediaMTX (default scada)",
    "STREAM_PATH=scada"
) | Out-Null

# --- OBS Studio -------------------------------------------------------------
Write-Host ""
if ((Test-Path $P.ObsExe) -and -not $Force) {
    Good "OBS Studio sudah terpasang."
} else {
    Install-WingetPkg "OBSProject.OBSStudio" "OBS Studio" | Out-Null
}

} # akhir STREAM

# ==========================================================================
#  [2] MIRROR - TightVNC + websocat
# ==========================================================================
if ($doMirror) {
    Write-Host ""
    $vncView = $null

    # --- TightVNC Server (winget) -------------------------------------------
    if ((Test-Path $P.TvnExe) -and -not $Force) {
        Good "TightVNC sudah terpasang (lewati; pakai -Force untuk update)."
    } else {
        Install-WingetPkg "GlavSoft.TightVNC" "TightVNC" | Out-Null
    }

    if (Test-Path $P.TvnExe) {
        # Pemasang TightVNC mendaftarkan service autostart - nonaktifkan.
        # Saklar start menjalankan tvnserver mode aplikasi (tidak ada yang
        # hidup diam-diam).
        $svc = Get-Service tvnserver -ErrorAction SilentlyContinue
        if ($svc -and ($svc.StartType -ne "Manual" -or $svc.Status -eq "Running")) {
            try {
                Set-Service tvnserver -StartupType Manual -ErrorAction Stop
                Stop-Service tvnserver -Force -ErrorAction SilentlyContinue
                Good "Service TightVNC dinonaktifkan (dipakai mode aplikasi via saklar)."
            } catch {
                try {
                    Start-Process powershell -Verb RunAs -Wait -ArgumentList `
                        "-NoProfile", "-Command", "Set-Service tvnserver -StartupType Manual; Stop-Service tvnserver -Force"
                    Good "Service TightVNC dinonaktifkan (dipakai mode aplikasi via saklar)."
                } catch {
                    Warn "Gagal menonaktifkan service TightVNC. Jalankan manual sebagai Administrator:"
                    Warn "   Set-Service tvnserver -StartupType Manual; Stop-Service tvnserver"
                }
            }
        }

        # --- Password + akses jaringan ---------------------------------------
        # DUA TEMPAT, sengaja: mode APLIKASI membaca HKCU, mode SERVICE membaca
        # HKLM. Kalau hanya salah satu terisi, mode lain melayani TANPA password
        # -> TightVNC menolak dengan "Server is not configured properly".
        function ConvertTo-VncPass([string]$plain) {
            $data = New-Object byte[] 8
            $src = [Text.Encoding]::ASCII.GetBytes($plain)
            [Array]::Copy($src, $data, [Math]::Min(8, $src.Length))
            $des = New-Object Security.Cryptography.DESCryptoServiceProvider
            $des.Mode = [Security.Cryptography.CipherMode]::ECB
            $des.Padding = [Security.Cryptography.PaddingMode]::None
            $des.Key = [byte[]](0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0)
            return $des.CreateEncryptor().TransformFinalBlock($data, 0, 8)
        }
        # VNC hanya memakai 8 karakter pertama - potong DI SINI supaya registry
        # dan config.env selalu sama persis.
        function Limit-VncPass([string]$plain) {
            if ($plain.Length -gt 8) {
                Warn "Password dipotong jadi 8 karakter (batas protokol VNC): $($plain.Substring(0,8))"
                return $plain.Substring(0, 8)
            }
            return $plain
        }

        $RegVnc = "HKCU:\Software\TightVNC\Server"
        $hasPass = (Test-Path $RegVnc) -and
            (Get-ItemProperty $RegVnc -Name PasswordViewOnly -ErrorAction SilentlyContinue)
        $ctrlEnc = $null
        $viewEnc = $null
        if ($hasPass -and -not $Force) {
            Good "Password TightVNC sudah diset - dipertahankan (pakai -Force untuk set ulang)."
            $ctrlEnc = (Get-ItemProperty $RegVnc -Name Password         -ErrorAction SilentlyContinue).Password
            $viewEnc = (Get-ItemProperty $RegVnc -Name PasswordViewOnly -ErrorAction SilentlyContinue).PasswordViewOnly
        } else {
            Write-Host ""
            Info "Password VNC (maks 8 karakter; Enter = buat otomatis):"
            $vncCtrl = Read-Host "   Password KONTROL (maintenance - JANGAN diisi ke R-Net)"
            if ([string]::IsNullOrWhiteSpace($vncCtrl)) { $vncCtrl = (New-Pass).Substring(0, 8); Write-Host "   -> dibuatkan: $vncCtrl" }
            $vncCtrl = Limit-VncPass $vncCtrl
            $vncView = Read-Host "   Password VIEW-ONLY (yang dipakai R-Net)"
            if ([string]::IsNullOrWhiteSpace($vncView)) { $vncView = (New-Pass).Substring(0, 8); Write-Host "   -> dibuatkan: $vncView" }
            $vncView = Limit-VncPass $vncView
            $ctrlEnc = ConvertTo-VncPass $vncCtrl
            $viewEnc = ConvertTo-VncPass $vncView
            New-Item -Path $RegVnc -Force | Out-Null
            New-ItemProperty -Path $RegVnc -Name Password         -PropertyType Binary -Value $ctrlEnc -Force | Out-Null
            New-ItemProperty -Path $RegVnc -Name PasswordViewOnly -PropertyType Binary -Value $viewEnc -Force | Out-Null
            Good "Password TightVNC diset (kontrol + view-only)."
            Warn "CATAT keduanya. View-only untuk R-Net; kontrol untuk Anda sendiri."
        }

        # WAJIB loopback-only: websocat menyambung dari 127.0.0.1, dan TightVNC
        # bawaan MENOLAK loopback. LoopbackOnly=1 sekalian mengunci 5900 dari
        # LAN - satu-satunya jalan masuk = websocat + tunnel.
        New-Item -Path $RegVnc -Force | Out-Null
        New-ItemProperty -Path $RegVnc -Name UseVncAuthentication  -PropertyType DWord -Value 1 -Force | Out-Null
        New-ItemProperty -Path $RegVnc -Name AcceptHttpConnections -PropertyType DWord -Value 0 -Force | Out-Null
        New-ItemProperty -Path $RegVnc -Name AllowLoopback -PropertyType DWord -Value 1 -Force | Out-Null
        New-ItemProperty -Path $RegVnc -Name LoopbackOnly  -PropertyType DWord -Value 1 -Force | Out-Null
        Good "TightVNC (mode aplikasi/HKCU): loopback-only + auth diset."

        # Cermin setelan ke HKLM (64-bit + WOW6432Node) supaya mode SERVICE
        # memakai password + loopback yang sama.
        if ($ctrlEnc -and $viewEnc) {
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

        # Swa-uji: BUKTIKAN setelan mendarat di hive milik mode yang jalan.
        Write-Host ""
        Info "Swa-uji setelan TightVNC:"
        $svcNow = Get-Service tvnserver -ErrorAction SilentlyContinue
        $svcRun = ($svcNow -and $svcNow.Status -eq "Running")
        if ($svcRun) { Info "   Mode aktif: SERVICE  -> yang menentukan: hive HKLM" }
        else         { Info "   Mode aktif: APLIKASI -> yang menentukan: hive HKCU" }
        $hives = @(
            @{ Path = "HKCU:\Software\TightVNC\Server";             Label = "HKCU (mode aplikasi)"; Decisive = (-not $svcRun) },
            @{ Path = "HKLM:\SOFTWARE\TightVNC\Server";             Label = "HKLM 64-bit (service)"; Decisive = $svcRun },
            @{ Path = "HKLM:\SOFTWARE\WOW6432Node\TightVNC\Server"; Label = "HKLM 32-bit (service)"; Decisive = $svcRun }
        )
        $decisiveOk = $false
        foreach ($h in $hives) {
            $prop = Get-ItemProperty $h.Path -ErrorAction SilentlyContinue
            if (-not $prop) { Info "   $($h.Label): belum ada"; continue }
            $lengkap = $prop.Password -and $prop.PasswordViewOnly -and ($prop.AllowLoopback -eq 1)
            if ($lengkap) {
                Good "   $($h.Label): password + loopback OK"
                if ($h.Decisive) { $decisiveOk = $true }
            } else {
                Warn "   $($h.Label): BELUM lengkap (Primary=$(if ($prop.Password) { 'ada' } else { 'KOSONG' }), ViewOnly=$(if ($prop.PasswordViewOnly) { 'ada' } else { 'KOSONG' }), AllowLoopback=$($prop.AllowLoopback))"
            }
        }
        if (-not $decisiveOk) {
            Warn "BELUM SIAP: hive milik mode yang sedang jalan belum lengkap -"
            Warn "R-Net akan bilang 'Server is not configured properly'. Jalankan"
            Warn "ulang installer (setujui prompt Administrator) atau -Force."
        } else {
            Good "Sumber VNC siap."
        }
    }

    # --- websocat.exe (jembatan WebSocket <-> VNC) --------------------------
    $WsDir = Split-Path -Parent $P.WebsocatExe
    if (-not (Test-Path $WsDir)) { New-Item -ItemType Directory -Path $WsDir -Force | Out-Null }
    if ((Test-Path $P.WebsocatExe) -and -not $Force) {
        Good "websocat.exe sudah ada (lewati; pakai -Force untuk unduh ulang)."
    } else {
        Info "Mengunduh websocat terbaru dari github.com/vi/websocat ..."
        $a = Get-LatestAsset "vi/websocat" "^websocat\.x86_64-pc-windows-gnu\.exe$"
        $tmp = Get-ToTemp $a.Url
        $sha = (Get-FileHash $tmp -Algorithm SHA256).Hash
        Info "   Sumber : $($a.Url)"
        Info "   SHA-256: $sha"
        Move-Item $tmp $P.WebsocatExe -Force
        Good "websocat $($a.Version) terpasang."
    }

    # --- Password view-only ke config.env (untuk auto-connect R-Net) --------
    $cfgRaw = if (Test-Path $P.Config) { Get-Content $P.Config -Raw } else { "" }
    if ($cfgRaw -notmatch "(?m)^\s*VNC_VIEW_PASSWORD\s*=") {
        if (-not $vncView -and $viewEnc) {
            # Password lama dipertahankan? Baca balik dari registry supaya
            # config.env tidak pernah beda dengan server.
            $des = New-Object Security.Cryptography.DESCryptoServiceProvider
            $des.Mode = [Security.Cryptography.CipherMode]::ECB
            $des.Padding = [Security.Cryptography.PaddingMode]::None
            $des.Key = [byte[]](0xE8, 0x4A, 0xD6, 0x60, 0xC4, 0x72, 0x1A, 0xE0)
            $plain = $des.CreateDecryptor().TransformFinalBlock($viewEnc, 0, 8)
            $vncView = ([Text.Encoding]::ASCII.GetString($plain)).TrimEnd([char]0)
            Info "Password view-only dibaca dari setelan TightVNC yang sudah ada."
        }
        Add-ConfigKey $P.Config @(
            "# [MIRROR] Password VIEW-ONLY TightVNC (utk auto-connect penonton R-Net)",
            "VNC_VIEW_PASSWORD=$(if ($vncView) { $vncView } else { '' })"
        ) | Out-Null
    }
}

# ==========================================================================
#  [3] DATA - Mosquitto + Node-RED + bridge (Python)
# ==========================================================================
if ($doData) {
    Write-Host ""

    # --- Mosquitto (broker MQTT) --------------------------------------------
    if (-not (Test-Path $P.MosqDir)) { New-Item -ItemType Directory -Path $P.MosqDir -Force | Out-Null }
    if ((Test-Path $P.MosqExe) -and -not $Force) {
        Good "Mosquitto sudah terpasang (lewati; pakai -Force untuk update)."
    } else {
        Install-WingetPkg "EclipseFoundation.Mosquitto" "Mosquitto" | Out-Null
    }

    if (Test-Path $P.MosqExe) {
        # Jangan biarkan service bawaan autostart - saklar kita yang pegang.
        try { Set-Service mosquitto -StartupType Manual -ErrorAction Stop; Stop-Service mosquitto -ErrorAction SilentlyContinue } catch {}

        if (Test-Path $P.MosqConf) {
            Good "mosquitto.conf sudah ada - kredensial lama dipertahankan."
            Info "Ubah port/akun: dobel-klik '$InstallDir\Pengaturan MQTT.bat'."
        } else {
            Write-Host ""
            Info "Akun MQTT (dipakai V-Box & Node-RED untuk publish; Enter = otomatis):"
            $mqUser = Read-Host "   Username MQTT"
            if ([string]::IsNullOrWhiteSpace($mqUser)) { $mqUser = "vbox" ; Write-Host "   -> dipakai: vbox" }
            $mqPass = Read-Host "   Password MQTT"
            if ([string]::IsNullOrWhiteSpace($mqPass)) { $mqPass = New-Pass; Write-Host "   -> dibuatkan: $mqPass" }

            $MqPasswd = Join-Path $P.MosqDir "passwd"
            & (Join-Path $env:ProgramFiles "mosquitto\mosquitto_passwd.exe") -b -c $MqPasswd $mqUser $mqPass
            if ($LASTEXITCODE -ne 0) { Warn "mosquitto_passwd gagal - cek manual." }

            Write-TextNoBom $P.MosqConf (@(
                "# mosquitto.conf - broker MQTT R-Net (dibuat installer)",
                "# Ubah lewat 'Pengaturan MQTT.bat' - tidak perlu edit file ini manual.",
                "# Dinyalakan oleh start.bat (paket DATA), dimatikan oleh stop.bat.",
                "listener 1883 0.0.0.0",
                "allow_anonymous false",
                "password_file $MqPasswd",
                "persistence false",
                "log_dest file $(Join-Path $P.MosqDir 'mosquitto.log')",
                "log_type error",
                "log_type warning"
            ) -join "`r`n")
            Good "mosquitto.conf dibuat (port 1883, wajib login)."
            Warn "CATAT akun MQTT ini - dipakai V-Box/Node-RED (publish) dan diisi juga"
            Warn "di R-Net > Data > Kelola Site (supaya bridge bisa membaca broker ini)."
        }

        # Buka port 1883 untuk V-Box di jaringan lokal (perlu Administrator).
        try {
            $ruleName = "R-Net MQTT 1883"
            $exists = netsh advfirewall firewall show rule name="$ruleName" 2>$null | Select-String $ruleName
            if (-not $exists) {
                Start-Process netsh -ArgumentList "advfirewall firewall add rule name=`"$ruleName`" dir=in action=allow protocol=TCP localport=1883" -Verb RunAs -Wait
                Good "Firewall: port 1883 dibuka (aturan '$ruleName')."
            } else {
                Good "Firewall: aturan port 1883 sudah ada."
            }
        } catch {
            Warn "Gagal membuka firewall otomatis - buka port TCP 1883 manual bila V-Box tidak bisa konek."
        }
    }

    # --- Node.js + Node-RED --------------------------------------------------
    Write-Host ""
    $NodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
    $NpmCmd  = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
    $haveNode = (Get-Command node -ErrorAction SilentlyContinue) -or (Test-Path $NodeExe)
    if ($haveNode) {
        Good "Node.js sudah terpasang."
    } else {
        Install-WingetPkg "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
        $haveNode = Test-Path $NodeExe
    }
    if ($haveNode) {
        if (-not (Test-Path $NpmCmd)) { $NpmCmd = (Get-Command npm -ErrorAction SilentlyContinue).Source }
        if (-not $NpmCmd) {
            Warn "npm tidak ditemukan - buka PowerShell BARU lalu jalankan: npm install -g node-red"
        } elseif ((Test-Path $P.NodeRedCmd) -and -not $Force) {
            Good "Node-RED sudah terpasang (lewati; pakai -Force untuk update)."
        } else {
            Info "Memasang Node-RED versi terbaru dari npm (butuh beberapa menit) ..."
            & $NpmCmd install -g --unsafe-perm node-red
            if ($LASTEXITCODE -eq 0) { Good "Node-RED terpasang." }
            else { Warn "npm install node-red gagal (kode $LASTEXITCODE) - coba manual: npm install -g node-red" }
        }
    }

    # --- Python + dependensi bridge ------------------------------------------
    Write-Host ""
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) {
        Install-WingetPkg "Python.Python.3.12" "Python 3.12" | Out-Null
        # Sesi ini belum kenal PATH baru - segarkan dari registry.
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [Environment]::GetEnvironmentVariable("Path", "User")
        $py = Get-Command python -ErrorAction SilentlyContinue
    }
    if ($py) {
        Good "Python: $($py.Source)"
        Info "Memasang dependensi bridge (paho-mqtt + psycopg) ..."
        & $py.Source -m pip install --quiet -r (Join-Path $Here "data\requirements.txt")
        if ($LASTEXITCODE -eq 0) { Good "Dependensi bridge terpasang." }
        else { Warn "pip install gagal - jalankan manual: python -m pip install -r data\requirements.txt" }
    } else {
        Warn "Python belum tersedia di PATH. Tutup jendela ini, buka lagi, jalankan ulang installer."
    }

    # --- Salin file data (bridge + contoh flow Node-RED) ---------------------
    if (-not (Test-Path $P.DataDir)) { New-Item -ItemType Directory -Path $P.DataDir -Force | Out-Null }
    foreach ($f in @("bridge.py", "requirements.txt", "run-bridge.ps1")) {
        Copy-Item (Join-Path $Here "data\$f") (Join-Path $P.DataDir $f) -Force
    }
    # mqtt-setting.ps1 + Pengaturan MQTT.bat -> ROOT install: skrip GUI mencari
    # folder mosquitto\ di sebelahnya, dan itu ada di root ($InstallDir\mosquitto).
    Copy-Item (Join-Path $Here "data\mqtt-setting.ps1") (Join-Path $InstallDir "mqtt-setting.ps1") -Force
    Copy-Item (Join-Path $Here "data\Pengaturan MQTT.bat") (Join-Path $InstallDir "Pengaturan MQTT.bat") -Force
    if (Test-Path (Join-Path $Here "data\node-red")) {
        Copy-Item (Join-Path $Here "data\node-red") $P.DataDir -Recurse -Force
    }
    Good "File bridge + contoh flow Node-RED disalin ke $($P.DataDir)."

    # --- DATABASE_URL untuk bridge -------------------------------------------
    $cfgNow2 = Read-Config $P.Config
    if (-not (Get-Cfg $cfgNow2 "DATABASE_URL")) {
        Write-Host ""
        Info "Alamat database R-Net untuk BRIDGE (kurir broker -> database cloud)."
        Info "Format: postgresql://user:password@host:6543/postgres"
        $dbUrl = Read-Host "   DATABASE_URL (Enter = isi nanti di config.env)"
        Add-ConfigKey $P.Config @(
            "# [DATA] Alamat database R-Net untuk bridge",
            "DATABASE_URL=$($dbUrl.Trim())"
        ) | Out-Null
        if ([string]::IsNullOrWhiteSpace($dbUrl)) {
            Warn "DATABASE_URL kosong - bridge belum bisa jalan. Isi di $($P.Config)."
        }
    }
}

# ==========================================================================
#  Saklar + lib (selalu diperbarui ke versi terbaru)
# ==========================================================================
foreach ($f in @("start.ps1", "stop.ps1", "uninstall.ps1", "start.bat", "stop.bat", "uninstall.bat")) {
    Copy-Item (Join-Path $Here $f) (Join-Path $InstallDir $f) -Force
}
Copy-Item (Join-Path $Here "lib\common.ps1") (Join-Path $InstallDir "lib\common.ps1") -Force
if (-not (Test-Path $P.Config)) {
    # Belum ada kredensial sama sekali (semua prompt dilewati) - sediakan template.
    Copy-Item (Join-Path $Here "config.env.example") $P.Config -Force
}
Good "Saklar start/stop/uninstall terpasang di $InstallDir."

# --- Selesai ----------------------------------------------------------------
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SELESAI. Semua kredensial: $InstallDir\config.env" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Nyalakan : dobel-klik $InstallDir\start.bat"
Write-Host "  Matikan  : dobel-klik $InstallDir\stop.bat"
Write-Host "  Hapus    : dobel-klik $InstallDir\uninstall.bat"
Write-Host ""
if ($doStream) {
    Write-Host "  STREAM - setelan OBS (sekali saja):"
    Write-Host "    Settings > Stream : Custom | Server rtmp://127.0.0.1:1935"
    Write-Host "    Stream Key        : scada?user=obs&pass=<password publish>"
    Write-Host "    Output > Streaming > Keyframe Interval: 1 s  (WAJIB)"
    Write-Host ""
}
if ($doMirror) {
    Write-Host "  MIRROR: buka browser cloud SCADA di PC ini + login, lalu start.bat."
    Write-Host ""
}
if ($doData) {
    Write-Host "  DATA:"
    Write-Host "    - Akun broker utk V-Box/Node-RED: 'Pengaturan MQTT.bat'"
    Write-Host "    - Daftarkan broker ini di R-Net > Data > Kelola Site"
    Write-Host "      (host = IP PC ini, port 1883, akun MQTT di atas)"
    Write-Host "    - Node-RED editor: http://127.0.0.1:1880 (setelah start.bat)"
    Write-Host ""
}
Write-Host "  Panduan: folder docs\ (PANDUAN-RNET.md, PANDUAN-TUNNEL.md, PANDUAN-NODE-RED.md)"
Write-Host ""
