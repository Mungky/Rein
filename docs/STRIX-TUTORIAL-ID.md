# Tutorial Strix untuk Codex dan PowerShell

Strix adalah alat pengujian keamanan berbasis AI. Integrasi Codex menggunakan sembilan skill global di `C:\Users\Fikri Mustaqim\.codex\skills`. CLI dipasang terpisah sebagai tool Python melalui `uv`, tanpa menambah dependensi aplikasi Rein.

## Menggunakan dari chat Codex

Skill tersedia mulai giliran berikutnya setelah instalasi. Ketik `$` lalu nama skill, atau sebutkan namanya dalam permintaan.

| Skill | Kegunaan |
|---|---|
| `penetration-testing-with-strix` | Menjalankan pengujian dan membaca hasil |
| `find-security-vulnerabilities-in-code` | Menguji keamanan source code |
| `web-app-penetration-testing` | Menguji aplikasi web |
| `api-security-testing` | Menguji API |
| `owasp-top-10-testing` | Menilai kategori OWASP Top 10 |
| `application-security-testing` | Menggabungkan pengujian keamanan aplikasi |
| `fix-security-vulnerabilities-with-strix` | Memperbaiki temuan dan menguji ulang |
| `ci-security-scanning-with-strix` | Menyiapkan scan di CI/CD |
| `managed-pentesting-with-strix` | Menggunakan platform cloud Strix |

Contoh prompt:

```text
Gunakan $penetration-testing-with-strix untuk scan quick pada salinan
proyek saya di D:\security-tests\Rein. Gunakan CLI lokal dengan anggaran
LLM maksimum USD 5. Laporkan temuan, bukti, dan rekomendasi perbaikannya.
```

```text
Gunakan $fix-security-vulnerabilities-with-strix untuk membaca hasil
di strix_runs/<nama-run>, memperbaiki temuan high dan critical,
lalu memverifikasi perbaikannya.
```

## Persiapan CLI di PowerShell

Periksa instalasi dan Docker:

```powershell
strix --version
strix --help
docker info
```

Jika terminal lama belum menemukan `strix`, buka terminal baru. Alternatif:

```powershell
uv tool run --from strix-agent strix --version
```

### Menggunakan langganan ChatGPT

Login ChatGPT untuk Strix terpisah dari login Codex. CLI 1.7.0 mendukung akun ChatGPT Plus/Pro tanpa API key terpisah:

```powershell
strix auth login chatgpt
strix auth status
$env:STRIX_LLM = 'chatgpt/gpt-6.1-sol'
```

Selesaikan otorisasi di browser. Gunakan model yang tersedia untuk akun Anda; pemakaian mengikuti batas paket ChatGPT. Model `gpt-6.1-sol` lolos pemeriksaan awal pada akun ini, sedangkan contoh `gpt-5.4` dari bantuan Strix ditolak sebagai model yang tidak tersedia. Setelah login, lanjutkan ke langkah scan di bawah. Tidak perlu mengisi `LLM_API_KEY` untuk jalur ini.

### Menggunakan API key provider

Sebagai alternatif, pilih model yang tersedia pada akun provider Anda. Berikut contoh OpenRouter dari dokumentasi resmi. Masukkan API key melalui prompt terminal, bukan chat atau file proyek:

```powershell
$env:STRIX_LLM = 'openrouter/z-ai/glm-5.3'
$strixSecret = Read-Host 'API key provider LLM' -AsSecureString
$env:LLM_API_KEY = [System.Net.NetworkCredential]::new('', $strixSecret).Password
Remove-Variable strixSecret
```

Variabel tersebut berlaku untuk proses PowerShell ini dan proses turunannya. Strix dapat menyimpan konfigurasi ke `~/.strix/cli-config.json`; perlakukan file tersebut sebagai rahasia. Sandbox berjalan di Docker, tetapi penggunaan model melalui API tetap mengirim konteks pengujian ke provider model.

## Menjalankan pengujian pertama

Gunakan target milik sendiri atau yang diizinkan untuk diuji. Untuk source code, gunakan salinan proyek yang boleh diubah: direktori target dipasang writable ke sandbox. Proyek Rein saat instalasi memiliki banyak perubahan yang belum di-commit, sehingga sebaiknya jangan langsung memakai working tree aktif sebagai target.

Ganti path contoh dengan salinan proyek Anda:

```powershell
Set-Location 'D:\security-tests\Rein'
strix -n -t . --scan-mode quick --scope-mode full --max-budget 5
```

`-n` menjalankan tanpa antarmuka interaktif. `quick` memilih scan singkat. `full` meminta cakupan seluruh source tree. `--max-budget 5` menetapkan ambang biaya LLM USD 5; biaya dihitung setelah respons model, sehingga jangan menganggapnya sebagai batas tagihan yang selalu presisi. Saat scan pertama, Strix mengunduh image sandbox Docker.

Untuk aplikasi staging yang Anda kelola:

```powershell
strix -n -t 'https://staging.example.com' --scan-mode quick --max-budget 5
```

Ganti URL contoh dengan target sebenarnya. Scan ini melakukan pengujian aktif dan dapat memengaruhi data target; gunakan lingkungan pengujian.

## Membaca hasil

Hasil disimpan di `strix_runs/<nama-run>/`. Buka `penetration_test_report.md` terlebih dahulu, lalu detail di `vulnerabilities/` atau `vulnerabilities.json`. `run.json` menyimpan status dan penggunaan biaya. Untuk dashboard lokal:

```powershell
strix view
```

Pada mode headless, exit code `0` berarti tidak ada temuan yang memenuhi kriteria kegagalan, `1` berarti error, dan `2` berarti ditemukan kerentanan. Periksa status, cakupan laporan, dan penggunaan anggaran; hasil tanpa temuan tidak membuktikan seluruh aplikasi aman.

## Pemeliharaan dan masalah umum

```powershell
# Memperbarui CLI yang dipasang dengan uv
uv tool upgrade strix-agent

# Memeriksa tool yang terpasang
uv tool list
```

- Docker tidak terhubung: buka Docker Desktop, gunakan Linux containers, lalu ulangi `docker info`.
- Error autentikasi model: periksa model, API key, akses model, serta saldo provider.
- Skill tidak muncul: mulai giliran atau sesi Codex baru.
- Mode cloud merupakan layanan terpisah yang memerlukan akun dan dapat mengenakan biaya. Jangan mengunggah source code sebelum memeriksa file yang akan dikirim.

## Sumber resmi

- Repositori dan integrasi agent: https://github.com/usestrix/strix
- Memulai: https://docs.strix.ai/quickstart
- Referensi perintah: https://docs.strix.ai/usage/cli
- Konfigurasi model: https://docs.strix.ai/llm-providers/overview

