# ==========================================================================
#  mqtt-setting.ps1  -  UI Pengaturan MQTT (Mosquitto) untuk R-Net
# ==========================================================================
#  Dobel-klik "Pengaturan MQTT.bat" di File Explorer untuk membukanya.
#
#  Fungsinya: mengatur broker MQTT TANPA edit file config manual —
#    - port listener, wajib-login/anonim, username + password
#    - menyalakan / mematikan broker (saklar manual, bukan service)
#    - tes koneksi (publish percobaan ke broker sendiri)
#    - menampilkan persis apa yang harus diisi di V-Net / V-Box
#
#  File yang dikelola: <folder ini>\mosquitto\mosquitto.conf + passwd.
#  Password tersimpan sebagai hash (mosquitto_passwd), jadi password lama
#  tidak bisa ditampilkan — kosongkan kolom password = tidak diubah.
# ==========================================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Root        = Split-Path -Parent $MyInvocation.MyCommand.Path
$MqDir       = Join-Path $Root "mosquitto"
$MqConf      = Join-Path $MqDir "mosquitto.conf"
$MqPasswd    = Join-Path $MqDir "passwd"
$MqLog       = Join-Path $MqDir "mosquitto.log"
$MqExe       = Join-Path $env:ProgramFiles "mosquitto\mosquitto.exe"
$MqPasswdExe = Join-Path $env:ProgramFiles "mosquitto\mosquitto_passwd.exe"
$MqPubExe    = Join-Path $env:ProgramFiles "mosquitto\mosquitto_pub.exe"

function Show-Err($msg) {
    [System.Windows.Forms.MessageBox]::Show($msg, "Pengaturan MQTT R-Net",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}
function Show-Info($msg) {
    [System.Windows.Forms.MessageBox]::Show($msg, "Pengaturan MQTT R-Net",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
}

if (-not (Test-Path $MqExe)) {
    Show-Err ("Mosquitto belum terpasang di PC ini.`n`n" +
        "Jalankan install.ps1 dan pilih komponen [2] Mosquitto dulu.")
    exit 1
}

# UTF-8 tanpa BOM — konsisten dengan installer.
function Write-TextNoBom($path, $text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($path, $text, $enc)
}

# --- Baca kondisi sekarang -------------------------------------------------
$curPort = 1883; $curAnon = $false; $curPersist = $false; $curUser = ""
if (Test-Path $MqConf) {
    foreach ($line in Get-Content $MqConf) {
        $t = $line.Trim()
        if ($t -match '^listener\s+(\d+)')        { $curPort = [int]$Matches[1] }
        elseif ($t -match '^allow_anonymous\s+true')  { $curAnon = $true }
        elseif ($t -match '^persistence\s+true')      { $curPersist = $true }
    }
}
if (Test-Path $MqPasswd) {
    $first = (Get-Content $MqPasswd | Where-Object { $_ -match ":" } | Select-Object -First 1)
    if ($first) { $curUser = $first.Split(":")[0] }
}

function Get-LanIp {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254*" } |
            Sort-Object -Property InterfaceMetric |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch {}
    return "<IP PC ini>"
}

function Test-BrokerRunning { [bool](Get-Process mosquitto -ErrorAction SilentlyContinue) }

# --- Bangun form -------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "Pengaturan MQTT - R-Net"
$form.Size = New-Object System.Drawing.Size(560, 560)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.StartPosition = "CenterScreen"
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)

function Add-Ctl($ctl, $x, $y, $w, $h) {
    $ctl.Location = New-Object System.Drawing.Point($x, $y)
    if ($w) { $ctl.Size = New-Object System.Drawing.Size($w, $h) }
    $form.Controls.Add($ctl)
    return $ctl
}
function New-Label($text, $bold) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text; $l.AutoSize = $true
    if ($bold) { $l.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold) }
    return $l
}

$pad = 20

# -- Status broker
Add-Ctl (New-Label "Status broker" $true) $pad 15 | Out-Null
$lblStatus = Add-Ctl (New-Label "..." $false) $pad 40
$btnStart = Add-Ctl (New-Object System.Windows.Forms.Button) 330 34 95 28
$btnStart.Text = "Nyalakan"
$btnStop  = Add-Ctl (New-Object System.Windows.Forms.Button) 430 34 95 28
$btnStop.Text = "Matikan"

$line1 = Add-Ctl (New-Object System.Windows.Forms.Label) $pad 72 505 2
$line1.BorderStyle = "Fixed3D"

# -- Pengaturan
Add-Ctl (New-Label "Pengaturan broker" $true) $pad 85 | Out-Null

Add-Ctl (New-Label "Port MQTT" $false) $pad 118 | Out-Null
$txtPort = Add-Ctl (New-Object System.Windows.Forms.TextBox) 180 114 100 26
$txtPort.Text = "$curPort"
Add-Ctl (New-Label "(standar: 1883)" $false) 290 118 | Out-Null

$chkAnon = Add-Ctl (New-Object System.Windows.Forms.CheckBox) $pad 148 505 24
$chkAnon.Text = "Izinkan koneksi TANPA login (anonim) - tidak disarankan"
$chkAnon.Checked = $curAnon

Add-Ctl (New-Label "Username" $false) $pad 184 | Out-Null
$txtUser = Add-Ctl (New-Object System.Windows.Forms.TextBox) 180 180 200 26
$txtUser.Text = $curUser

Add-Ctl (New-Label "Password" $false) $pad 214 | Out-Null
$txtPass = Add-Ctl (New-Object System.Windows.Forms.TextBox) 180 210 200 26
$txtPass.UseSystemPasswordChar = $true
$chkShow = Add-Ctl (New-Object System.Windows.Forms.CheckBox) 390 212 130 24
$chkShow.Text = "tampilkan"
$chkShow.Add_CheckedChanged({ $txtPass.UseSystemPasswordChar = -not $chkShow.Checked })
$lblPassHint = Add-Ctl (New-Label "Kosongkan = password lama tidak diubah (tersimpan sebagai hash)." $false) $pad 240
$lblPassHint.ForeColor = [System.Drawing.Color]::Gray

$chkPersist = Add-Ctl (New-Object System.Windows.Forms.CheckBox) $pad 266 505 24
$chkPersist.Text = "Simpan pesan retained ke disk (persistence)"
$chkPersist.Checked = $curPersist

$btnSave = Add-Ctl (New-Object System.Windows.Forms.Button) $pad 300 150 32
$btnSave.Text = "Simpan Pengaturan"
$btnTest = Add-Ctl (New-Object System.Windows.Forms.Button) 180 300 120 32
$btnTest.Text = "Tes Koneksi"
$btnLog  = Add-Ctl (New-Object System.Windows.Forms.Button) 310 300 100 32
$btnLog.Text = "Buka Log"

$line2 = Add-Ctl (New-Object System.Windows.Forms.Label) $pad 345 505 2
$line2.BorderStyle = "Fixed3D"

# -- Contekan V-Net / V-Box
Add-Ctl (New-Label "Isi persis seperti ini di V-Net / V-Box (atau alat MQTT lain):" $true) $pad 358 | Out-Null
$txtCheat = Add-Ctl (New-Object System.Windows.Forms.TextBox) $pad 384 505 100
$txtCheat.Multiline = $true
$txtCheat.ReadOnly = $true
$txtCheat.Font = New-Object System.Drawing.Font("Consolas", 9.5)
$txtCheat.BackColor = [System.Drawing.Color]::WhiteSmoke
$lblNote = Add-Ctl (New-Label "Catatan: broker hidup/mati lewat tombol di atas atau saklar start/stop-scada." $false) $pad 492
$lblNote.ForeColor = [System.Drawing.Color]::Gray

function Update-Status {
    if (Test-BrokerRunning) {
        $lblStatus.Text = "BERJALAN - menerima koneksi di port $($txtPort.Text)"
        $lblStatus.ForeColor = [System.Drawing.Color]::Green
        $btnStart.Enabled = $false; $btnStop.Enabled = $true
    } else {
        $lblStatus.Text = "MATI - V-Box tidak bisa mengirim data sekarang"
        $lblStatus.ForeColor = [System.Drawing.Color]::Firebrick
        $btnStart.Enabled = $true; $btnStop.Enabled = $false
    }
}

function Update-Cheat {
    $ip = Get-LanIp
    $auth = if ($chkAnon.Checked) {
        "Username : (kosong - anonim diizinkan)`r`nPassword : (kosong)"
    } else {
        $pw = if ($txtPass.Text) { $txtPass.Text } else { "<password yang dibuat saat pasang>" }
        "Username : $($txtUser.Text)`r`nPassword : $pw"
    }
    $txtCheat.Text = "Host/Broker : $ip   (dari jaringan lokal yang sama)`r`n" +
                     "Port        : $($txtPort.Text)`r`n$auth`r`n" +
                     "Contoh topik: rnet/site1/mesin1/suhu"
}

$updateHandler = { Update-Cheat }
$txtPort.Add_TextChanged($updateHandler)
$txtUser.Add_TextChanged($updateHandler)
$txtPass.Add_TextChanged($updateHandler)
$chkAnon.Add_CheckedChanged($updateHandler)

# --- Aksi tombol -------------------------------------------------------------
$btnStart.Add_Click({
    if (-not (Test-Path $MqConf)) {
        Show-Err "mosquitto.conf belum ada - klik 'Simpan Pengaturan' dulu."
        return
    }
    Start-Process -FilePath $MqExe -ArgumentList "-c", "`"$MqConf`"" -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
    Update-Status
    if (-not (Test-BrokerRunning)) {
        Show-Err "Broker gagal menyala - cek log (tombol 'Buka Log'). Biasanya: port sudah dipakai aplikasi lain."
    }
})

$btnStop.Add_Click({
    Get-Process mosquitto -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 400
    Update-Status
})

$btnLog.Add_Click({
    if (Test-Path $MqLog) { Start-Process notepad.exe $MqLog }
    else { Show-Info "Belum ada file log (broker belum pernah dinyalakan dari config ini)." }
})

$btnSave.Add_Click({
    # Validasi
    $port = 0
    if (-not [int]::TryParse($txtPort.Text.Trim(), [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Show-Err "Port tidak valid. Isi angka 1 - 65535 (standar MQTT: 1883)."
        return
    }
    $user = $txtUser.Text.Trim()
    $pass = $txtPass.Text
    if (-not $chkAnon.Checked) {
        if (-not $user) { Show-Err "Username wajib diisi (atau centang 'anonim')."; return }
        if (-not (Test-Path $MqPasswd) -and -not $pass) {
            Show-Err "Belum ada file password - isi kolom Password untuk membuat akun."
            return
        }
        if ($user -ne $curUser -and -not $pass) {
            Show-Err "Username berubah - isi juga Password (file password dibuat ulang)."
            return
        }
    }

    if (-not (Test-Path $MqDir)) { New-Item -ItemType Directory -Path $MqDir -Force | Out-Null }

    # Akun (hanya kalau password diisi; kosong = biarkan yang lama)
    if (-not $chkAnon.Checked -and $pass) {
        & $MqPasswdExe -b -c $MqPasswd $user $pass
        if ($LASTEXITCODE -ne 0) { Show-Err "mosquitto_passwd gagal membuat akun - pengaturan TIDAK disimpan."; return }
    }

    # Tulis mosquitto.conf
    $lines = @(
        "# mosquitto.conf - broker MQTT R-Net (dibuat oleh Pengaturan MQTT)",
        "# Ubah lewat 'Pengaturan MQTT.bat' - tidak perlu edit file ini manual.",
        "listener $port 0.0.0.0",
        "allow_anonymous $(if ($chkAnon.Checked) { 'true' } else { 'false' })"
    )
    if (-not $chkAnon.Checked) { $lines += "password_file $MqPasswd" }
    $lines += @(
        "persistence $(if ($chkPersist.Checked) { 'true' } else { 'false' })",
        "log_dest file $MqLog",
        "log_type error",
        "log_type warning"
    )
    Write-TextNoBom $MqConf ($lines -join "`r`n")

    # Firewall untuk port baru (sekali per port; butuh klik "Yes" di UAC)
    $ruleName = "R-Net MQTT $port"
    $exists = netsh advfirewall firewall show rule name="$ruleName" 2>$null | Select-String $ruleName
    if (-not $exists) {
        try {
            Start-Process netsh -ArgumentList "advfirewall firewall add rule name=`"$ruleName`" dir=in action=allow protocol=TCP localport=$port" -Verb RunAs -Wait
        } catch {
            Show-Info "Aturan firewall port $port belum dibuat (dibatalkan). V-Box dari jaringan lokal mungkin tidak bisa konek."
        }
    }

    $script:curUser = $user

    # Terapkan langsung kalau broker sedang jalan
    if (Test-BrokerRunning) {
        Get-Process mosquitto -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 500
        Start-Process -FilePath $MqExe -ArgumentList "-c", "`"$MqConf`"" -WindowStyle Hidden
        Start-Sleep -Milliseconds 800
        Show-Info "Pengaturan disimpan dan broker DIRESTART dengan pengaturan baru."
    } else {
        Show-Info "Pengaturan disimpan. Nyalakan broker lewat tombol 'Nyalakan' atau start-scada.bat."
    }
    Update-Status
    Update-Cheat
})

$btnTest.Add_Click({
    if (-not (Test-BrokerRunning)) { Show-Err "Broker sedang MATI - nyalakan dulu."; return }
    if (-not (Test-Path $MqPubExe)) { Show-Err "mosquitto_pub.exe tidak ditemukan."; return }
    $port = $txtPort.Text.Trim()
    if ($chkAnon.Checked) {
        & $MqPubExe -h 127.0.0.1 -p $port -t "rnet/tes" -m "ping" 2>&1 | Out-Null
    } else {
        if (-not $txtPass.Text) {
            Show-Err "Untuk tes, isi kolom Password dengan password akun MQTT (tidak akan mengubah apa pun)."
            return
        }
        & $MqPubExe -h 127.0.0.1 -p $port -u $txtUser.Text.Trim() -P $txtPass.Text -t "rnet/tes" -m "ping" 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -eq 0) {
        Show-Info "BERHASIL - broker menerima publish di port $port dengan kredensial ini.`n`nV-Net/V-Box dengan isian yang sama pasti bisa konek (asal satu jaringan)."
    } else {
        Show-Err "GAGAL (kode $LASTEXITCODE) - biasanya username/password salah atau port keliru. Cek log untuk detail."
    }
})

Update-Status
Update-Cheat
$form.Add_Shown({ $form.Activate() })
[void]$form.ShowDialog()
