# Flow Node-RED

| File | Untuk apa |
|---|---|
| **`flow-generik-bulk.json`** | **Flow produksi baru.** Satu topik per gateway (`rnet/<site>/gw/<gateway>`), satu paket berisi semua nilai gateway itu. Tidak menyebut nama sensor sama sekali. |
| `flow-modbus-template.json` | Contoh (nonaktif) menerjemahkan PLC Modbus ke MQTT. |
| `flow-pabrik-simulasi.json` | Pabrik pura-pura untuk latihan tanpa alat asli. |
| `flow-line1.json` | **Usang.** Cara lama, satu kotak per sensor, hanya Line 1, port broker sudah salah. Disimpan sebagai rujukan sejarah — jangan diimpor. |
| `arsip/` | Rekaman flow lapangan sebelum diganti. Titik pulang. Jangan disunting. |
| `test-flow-generik.js` | Uji otomatis untuk `flow-generik-bulk.json`. |

---

## Memasang `flow-generik-bulk.json`

Flow ini **tidak mengganggu** flow lama. Keduanya bisa menyala berdampingan:
ID node-nya berbeda, topik tujuannya berbeda, dan sambungan broker-nya sendiri.

1. Buka `http://127.0.0.1:1880` di PC lapangan.
2. Menu **☰** (kanan atas) → **Import** → **select a file to import** →
   pilih `flow-generik-bulk.json` → **Import**.
   Muncul tab baru **"R-Net — Kirim Generik (BARU)"**.
3. Dobel-klik kotak ungu **mqtt** → klik **ikon pensil** di sebelah nama broker
   → tab **Security** → isi **username & password broker** (sama persis dengan
   yang ada di R-Net → Kelola Site) → **Update** → **Done**.

   > Password harus diketik di sini karena Node-RED tidak pernah ikut
   > mengekspor kredensial ke dalam file flow.

4. Klik **Deploy** (merah, kanan atas).

### Tanda flow sudah benar

Di bawah kotak **Tempel Label** muncul tulisan hijau yang berubah tiap detik:

    14 nilai dari 2 gateway (lombok1, lombok2)

Kalau tulisannya abu-abu `menunggu data gateway...` terus-menerus, berarti
pesan gateway tidak masuk — periksa sambungan broker (kotak mqtt harus
bertuliskan **connected**).

---

## Menjalankan ulang uji otomatisnya

Setiap kali flow disunting lewat Node-RED lalu diekspor kembali ke repo:

    node deploy/data/node-red/test-flow-generik.js

Harus berakhir dengan `SEMUA LULUS`.

---

## Menambah plant baru

Salin `flow-generik-bulk.json`, lalu ganti **satu baris** di kotak
Tempel Label:

```js
const SITE = 'lombok';   // -> ganti nama plant baru
```

Topik keluarnya ikut berubah sendiri jadi `rnet/<site>/gw/<gateway>`. Tidak ada
lagi yang perlu disunting, berapa pun jumlah sensornya.

## Menambah sensor atau line baru

Field baru di gateway yang sudah terdaftar: **tidak perlu membuka Node-RED**
sama sekali, langsung ikut terkirim.

Gateway baru: topik masuk ditulis lengkap (bukan `+`), jadi ia harus
didaftarkan sekali — salin salah satu kotak **mqtt in**, ganti Topic jadi
`fikri/vnet/lombok3`, tarik garis ke **Tempel Label**, Deploy. Kotak Tempel
Label tidak disentuh.

> Ini pilihan sadar: `+` membuat gateway baru ikut terkirim tanpa
> sepengetahuan siapa pun. Menukar kenyamanan itu dengan kendali.
Yang tersisa: daftarkan sensornya di **R-Net → Analisis → Sumber**, isi:

| Kolom | Isi |
|---|---|
| **Topik** | `rnet/lombok/gw/lombok1` — di R-Net > Analisis > Sumber |
| **Perangkat** | `waterlevel1` — nama nilai itu **apa adanya dari gateway**, diketik di kolom Perangkat pada tabel Analisis |

> ### ⚠️ Aturan yang menentukan: nama Perangkat harus unik DI DALAM satu topik
>
> Setiap line punya `waterlevel1`. Yang membedakannya adalah **topik**.
>
> | Bentuk topik terbit | Isi kolom Perangkat |
> |---|---|
> | `rnet/lombok/gw/lombok1` (satu topik per gateway) | `waterlevel1` |
> | `rnet/lombok/all` (satu topik seluruh plant) | `lombok1.waterlevel1` |
>
> Kalau satu topik memuat beberapa gateway dan Perangkat ditulis polos, sensor
> itu **bergantian membaca dua alat berbeda**. Tidak ada error, tidak ada data
> hilang, jumlah barisnya justru bertambah — terjadi 28 Juli 2026: satu tag
> tercatat 43,9% bernilai 0, ternyata tangki Line 2 (0) berselang-seling dengan
> tangki Line 1 (12–13). Jembatan sekarang menulis peringatan sekali di log
> begitu mendeteksinya.
>
> Untuk topik yang hanya membawa SATU nilai, kolom Perangkat tidak dipakai
> mencocokkan apa pun — isinya bebas, sekadar label.

Nama di kolom Field harus sama persis dengan yang dikirim gateway. Kalau
meleset, jembatan menulis satu baris peringatan di log yang menyebutkan nama
yang salah **dan** daftar nama yang sebenarnya dikirim — sensornya kosong,
bukan salah isi.
