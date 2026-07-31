/** bun test — penyambungan ekor live ke deret historis.
 *
 *  Yang dijaga di sini adalah satu sifat yang kalau hilang tidak menimbulkan
 *  error apa pun, cuma grafik yang berbohong: SATU GARIS, SATU RESOLUSI.
 *
 *  Versi lama menempelkan titik live apa adanya ke deret yang sudah di-bucket
 *  server, jadi 23 jam pertama digambar sebagai rata-rata 12 menit dan
 *  beberapa menit terakhir sebagai nilai per detik. Hasilnya terbaca seperti
 *  sensor yang mendadak tidak stabil, padahal yang berubah cuma penggambarnya.
 */

import { describe, expect, test } from "bun:test";
import { bucketMsOf, withLiveTail } from "./live-tail";

const T0 = Date.UTC(2026, 6, 30, 0, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** Deret historis: n titik, jarak `stepMs`. */
function base(n: number, stepMs: number, from = T0) {
  return Array.from({ length: n }, (_, i) => ({
    ts: iso(from + i * stepMs),
    value: 10 + i,
  }));
}

describe("bucketMsOf", () => {
  test("membaca lebar bucket dari jarak antar titik", () => {
    expect(bucketMsOf(base(5, 48_000))).toBe(48_000);
  });

  test("lubang di deret tidak membuatnya salah membaca lebar", () => {
    // Server hanya mengirim bucket yang ada isinya. Sensor yang sempat diam
    // meninggalkan jarak 3x lebar — kalau yang dibaca jarak PERTAMA yang
    // kebetulan lubang, seluruh ekornya akan di-bucket terlalu kasar.
    const withGap = [
      { ts: iso(T0), value: 1 },
      { ts: iso(T0 + 144_000), value: 2 }, // lubang: 3 x 48 dtk
      { ts: iso(T0 + 192_000), value: 3 }, // 48 dtk
    ];
    expect(bucketMsOf(withGap)).toBe(48_000);
  });

  test("deret terlalu pendek tidak punya lebar yang bisa dipercaya", () => {
    expect(bucketMsOf([])).toBeNull();
    expect(bucketMsOf([{ ts: iso(T0) }])).toBeNull();
  });
});

describe("withLiveTail", () => {
  test("ekor per detik diringkas ke lebar bucket deretnya", () => {
    const b = base(3, 60_000); // 0, 60, 120 dtk
    // 10 nilai per detik di dalam SATU bucket berikutnya (180 dtk).
    // Dulu ini jadi 10 titik rapat yang menempel pada garis 60-detikan.
    const live = Array.from({ length: 10 }, (_, i) => ({
      ts: iso(T0 + 180_000 + (i + 1) * 1_000),
      value: 100 + i,
    }));

    const out = withLiveTail(b, live);

    expect(out.length).toBe(4); // 3 historis + SATU bucket ekor
    expect(out[3].value).toBeCloseTo(104.5, 5); // rata-rata 100..109
  });

  test("ekor yang melintasi dua bucket jadi dua titik", () => {
    const b = base(2, 60_000); // titik terakhir di 60 dtk
    const live = [
      { ts: iso(T0 + 130_000), value: 10 },
      { ts: iso(T0 + 140_000), value: 20 },
      { ts: iso(T0 + 190_000), value: 60 },
    ];

    const out = withLiveTail(b, live);

    expect(out.length).toBe(4);
    expect(out[2].value).toBe(15); // bucket 120 dtk: rata-rata 10 & 20
    expect(out[3].value).toBe(60); // bucket 180 dtk
  });

  test("hasilnya tetap urut menaik", () => {
    const b = base(3, 48_000);
    const live = [
      { ts: iso(T0 + 300_000), value: 5 },
      { ts: iso(T0 + 200_000), value: 4 }, // sengaja tidak urut
    ];
    const out = withLiveTail(b, live);
    const times = out.map((p) => new Date(p.ts).getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  test("titik live yang lebih tua dari deret historis diabaikan", () => {
    const b = base(3, 60_000);
    const live = [{ ts: iso(T0 + 30_000), value: 99 }];
    expect(withLiveTail(b, live)).toEqual(b);
  });

  test("bucket yang tumpang tindih titik historis terakhir tidak ditimpa", () => {
    // Kalau ditimpa, titik itu melompat tiap kali halaman dibuka: server
    // memberi rata-rata bucket PENUH, sesi ini cuma punya sebagiannya.
    const b = base(2, 60_000); // terakhir di 60 dtk
    const live = [{ ts: iso(T0 + 70_000), value: 999 }]; // masih bucket 60 dtk
    expect(withLiveTail(b, live)).toEqual(b);
  });

  test("deret kosong: ekornya dipakai apa adanya", () => {
    // Sensor yang baru dibuat belum punya riwayat; menampilkan nilai live
    // sesi ini lebih berguna daripada kotak kosong.
    const live = [{ ts: iso(T0), value: 1 }];
    expect(withLiveTail([], live)).toEqual(live);
  });

  test("deret ber-bucket sedetik tidak diringkas lagi", () => {
    // Di rentang 1 jam bucket-nya 6 detik; kalau lebih rapat dari itu,
    // meringkas ekornya hanya menghapus titik tanpa memperbaiki apa pun.
    const b = [
      { ts: iso(T0), value: 1 },
      { ts: iso(T0 + 1_000), value: 2 },
    ];
    const live = [
      { ts: iso(T0 + 2_000), value: 3 },
      { ts: iso(T0 + 3_000), value: 4 },
    ];
    expect(withLiveTail(b, live).length).toBe(4);
  });
});
