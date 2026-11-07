# Pemasangan dan verifikasi plugin

Tanggal: 5 November 2026.

## Hasil

- `ecc@ecc`: installed, enabled; versi 2.2.3. Sudah ada di profil Codex, sehingga tidak dipasang ganda.
- `rea@rea`: installed, enabled; paket `rea-agents` 6.8.0. Pengelola Codex menampilkan versi cache `local`, sedangkan `package.json`, CLI dan MCP server menyatakan 6.8.0.
- `.codex/config.toml` proyek mengaktifkan kedua plugin. Pemasangan paket dan marketplace tersimpan pada profil pengguna Codex; ini bukan isolasi plugin eksklusif untuk Rein.
- CLI REA `--version`: 6.8.0.
- Launcher plugin REA: JSON-RPC `initialize` mengembalikan `serverInfo.name = rea`, `version = 6.8.0`; `tools/list` mengembalikan **229 tools**, exit 0, stderr kosong.
- Tools REA yang tersedia pada sesi berhasil menganalisis tiga sumber JavaScript Odoo dan mengekspor bukti lengkap. Jumlah tools pada sesi dapat berbeda dari paket lokal; analisis memakai schema yang benar-benar tersedia.

## Perbaikan distribusi yang dilakukan

Marketplace resmi ditambahkan dari checkout lokal `.research/rea` setelah unduhan ulang melalui CLI tertahan. Checkout berasal dari URL resmi dan dipatok pada commit di `sources.json`.

`codex plugin add rea@rea --json` memasang paket 6.8.0, tetapi paket yang tersedia saat pemeriksaan tidak membawa konfigurasi plugin lengkap. Cache berisi manifest minimal, tanpa `.codex-plugin/mcp.json` dan tanpa `scripts/plugin-mcp-launcher.mjs`. Runtime CLI juga belum dapat memuat dependensi `zod`.

Perbaikan hanya pada cache plugin REA:

1. Memasang dependensi produksi menggunakan `npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false` pada direktori cache REA. Tidak mengubah dependensi Rein.
2. Menyalin `.codex-plugin/plugin.json`, `.codex-plugin/mcp.json`, dan `scripts/plugin-mcp-launcher.mjs` dari checkout resmi yang dipatok ke cache plugin.
3. Memakai skill `reverse-engineer-anything` yang sudah ada dalam paket.
4. Memverifikasi versi CLI dan handshake launcher MCP sesudah perbaikan.

Dokumentasi upstream bagian Agent plugins and marketplaces menjelaskan bahwa dukungan manifest ini baru tersedia pada rilis npm yang sudah menyertakannya. Perbaikan di atas menjembatani perbedaan checkout sumber dengan paket 6.8.0 yang terpublikasi. Pembaruan/reinstalasi plugin dapat mengganti cache ini; periksa kembali manifest dan handshake setelahnya.

Lokasi cache saat pekerjaan dilakukan: `C:/Users/Fikri Mustaqim/.codex/plugins/cache/rea/rea/local`. Marketplace REA menunjuk checkout proyek `.research/rea`; pertahankan folder tersebut selama marketplace ini dipakai. Sumber unduhan dan bukti besar diabaikan oleh Git, sehingga tidak ikut berpindah lewat clone Rein biasa.

## Batas kompatibilitas

Node pada komputer: **24.13.0**. Paket REA menyatakan `^22.23.4 || ^24.22.1 || >=26.12.1`. npm memberi peringatan engine; versi CLI, handshake MCP dan analisis sesi berhasil, tetapi kompatibilitas seluruh provider belum diverifikasi. Tidak mengganti Node global dalam pemasangan ini. Untuk penggunaan penuh, gunakan versi Node yang memenuhi persyaratan REA.

Jika sesi Codex berikutnya belum menampilkan plugin, buka ulang proyek/restart sesi agar konfigurasi plugin dimuat. Tidak perlu menjalankan `rea setup` karena registrasi dimiliki plugin.

## Sumber resmi

- [ECC](https://github.com/affaan-m/ecc)
- [REA](https://github.com/morluto/rea)
- [Panduan instalasi REA pada commit referensi](https://github.com/morluto/rea/blob/fe677f6cf9853fb12490dfb8ef23ccae3a551049/docs/installation.md)

Untuk komputer lain: tambahkan marketplace resmi lewat `codex plugin marketplace add affaan-m/ECC` dan `codex plugin marketplace add morluto/rea`, lalu pasang `ecc@ecc` dan `rea@rea`. Tinjau versi yang benar-benar terpasang dan jangan anggap perbaikan cache lokal otomatis ikut tersalin.
