/** bun test — penggabungan baris tersimpan + ekor live untuk satu sensor.
 *
 *  Fungsi ini pindah keluar dari memo `rows` di AnalysisView, tempat ia dulu
 *  dijalankan untuk SETIAP sensor pada SETIAP sampel masuk. Yang dijaga di sini
 *  adalah sifat-sifat yang mudah hilang saat sepotong kode dipindahkan: arah
 *  urutan, batas jumlah, dan aturan "titik live hanya yang lebih baru".
 */

import { describe, expect, test } from "bun:test";
import { buildSeries } from "./tag-spark-cell";

const T0 = Date.UTC(2026, 6, 30, 12, 0, 0);
const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

/** Seperti yang datang dari server: TERBARU DULU. */
function stored(offsets: number[]) {
  return offsets.map((o) => ({ ts: iso(o), value: o }));
}

describe("buildSeries", () => {
  test("membalik baris tersimpan jadi urut naik", () => {
    // Server mengirim terbaru dulu; grafik menggambar kiri-ke-kanan.
    const out = buildSeries(stored([30, 20, 10]), []);
    expect(out.map((s) => s.value)).toEqual([10, 20, 30]);
  });

  test("hanya titik live yang LEBIH BARU dari baris tersimpan terakhir", () => {
    // Titik live yang lebih tua sudah terwakili oleh baris tersimpan; memasukkan
    // keduanya menggambar sensor yang sama dua kali di rentang waktu yang sama.
    const out = buildSeries(stored([30, 20, 10]), [
      { ts: iso(25), value: 999 }, // lebih tua dari 30 → dibuang
      { ts: iso(30), value: 998 }, // sama persis → dibuang
      { ts: iso(40), value: 40 },
    ]);
    expect(out.map((s) => s.value)).toEqual([10, 20, 30, 40]);
  });

  test("tanpa baris tersimpan, seluruh ekor live dipakai", () => {
    // Sensor yang baru dipasang belum punya baris tersimpan sama sekali —
    // menampilkan kosong akan terbaca sebagai sensor mati.
    const out = buildSeries([], [
      { ts: iso(1), value: 1 },
      { ts: iso(2), value: 2 },
    ]);
    expect(out.map((s) => s.value)).toEqual([1, 2]);
  });

  test("buffer kosong atau tidak ada tidak menggagalkan apa pun", () => {
    expect(buildSeries(stored([10]), undefined).map((s) => s.value)).toEqual([10]);
    expect(buildSeries(stored([10]), []).map((s) => s.value)).toEqual([10]);
    expect(buildSeries([], undefined)).toEqual([]);
  });

  test("dipotong ke batas, dan yang DIBUANG adalah yang tertua", () => {
    // Grafik mini menampilkan yang terbaru. Memotong dari ujung yang salah
    // menghasilkan sparkline yang membeku di masa lalu sambil tetap terlihat
    // hidup.
    const out = buildSeries(stored([]), Array.from({ length: 250 }, (_, i) => ({
      ts: iso(i),
      value: i,
    })));
    expect(out).toHaveLength(100);
    expect(out[0].value).toBe(150);
    expect(out[out.length - 1].value).toBe(249);
  });

  test("batasnya bisa diatur", () => {
    const buf = Array.from({ length: 10 }, (_, i) => ({ ts: iso(i), value: i }));
    expect(buildSeries([], buf, 3).map((s) => s.value)).toEqual([7, 8, 9]);
  });

  test("tidak mengubah array masukan", () => {
    // Deret tersimpan itu state React yang dipakai bersama; membalikkannya di
    // tempat akan merusak setiap pembaca lain secara diam-diam.
    const src = stored([30, 20, 10]);
    const copy = [...src];
    buildSeries(src, [{ ts: iso(40), value: 40 }]);
    expect(src).toEqual(copy);
  });
});
