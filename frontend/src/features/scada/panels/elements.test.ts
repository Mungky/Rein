/** bun test — satu aturan angka di belakang koma untuk seluruh R-Net.
 *
 *  Yang dijaga di sini: setelan yang diisi user HARUS terpakai.
 *
 *  Sebelumnya tidak ada aturan bersama sama sekali. Hanya panel Gauge punya
 *  "Angka di Belakang Koma"; 17 tempat lain memanggil `toLocaleString("id")`
 *  polos — yang bawaannya maksimum 3 desimal. Jadi sensor yang diatur 1 desimal
 *  tetap tampil "23,457" di Level, LED, Tabel, Bar, Grafik, panel Alarm, dan
 *  lonceng. Setelan "Desimal" per sensor di tab Data juga tidak pernah ikut,
 *  karena itu membulatkan yang DISIMPAN, bukan yang ditampilkan.
 */

import { describe, expect, test } from "bun:test";
import {
  AUTO_MAX_FRACTION_DIGITS,
  formatValue,
  resolveDecimals,
} from "./elements";

describe("resolveDecimals", () => {
  test("setelan panel menang atas setelan sensor", () => {
    expect(resolveDecimals(0, { decimals: 3 })).toBe(0);
    expect(resolveDecimals(2, { decimals: 3 })).toBe(2);
  });

  test("panel kosong → jatuh ke setelan sensor", () => {
    // Ini inti keluhannya: mengisi "Desimal" di tab Data harus berpengaruh.
    expect(resolveDecimals(null, { decimals: 1 })).toBe(1);
    expect(resolveDecimals(undefined, { decimals: 1 })).toBe(1);
  });

  test("dua-duanya kosong → otomatis (null)", () => {
    expect(resolveDecimals(null, {})).toBeNull();
    expect(resolveDecimals(null, null)).toBeNull();
    expect(resolveDecimals(undefined, undefined)).toBeNull();
  });

  test("0 desimal itu pilihan sah, bukan 'kosong'", () => {
    // Jebakan klasik `||`: 0 itu falsy, jadi "bulat tanpa koma" akan hilang
    // dan diam-diam berubah jadi otomatis.
    expect(resolveDecimals(0, { decimals: 2 })).toBe(0);
    expect(resolveDecimals(null, { decimals: 0 })).toBe(0);
  });

  test("nilai tak masuk akal diabaikan, tidak diteruskan", () => {
    // toLocaleString akan melempar RangeError untuk angka negatif — satu sensor
    // dengan config aneh tidak boleh menjatuhkan seluruh panel.
    for (const bad of [-1, Number.NaN, Infinity, "2", null] as unknown[]) {
      expect(resolveDecimals(bad as number, {})).toBeNull();
    }
  });

  test("dibatasi 6 — sama dengan batas skema backend (ge=0, le=6)", () => {
    expect(resolveDecimals(99, {})).toBe(6);
  });

  test("desimal pecahan dibulatkan ke bawah", () => {
    expect(resolveDecimals(2.7, {})).toBe(2);
  });
});

describe("formatValue", () => {
  test("angka yang ditetapkan dipakai sebagai minimum sekaligus maksimum", () => {
    // Supaya kolom angka berbaris rata: "8,0" bukan "8".
    expect(formatValue(8, 1)).toBe("8,0");
    expect(formatValue(23.456789, 1)).toBe("23,5");
    expect(formatValue(23.456789, 0)).toBe("23");
  });

  test("otomatis = maksimum 3 desimal, persis bawaan lama", () => {
    // Tag yang belum diatur harus tampil sama seperti sebelum berkas ini ada.
    expect(formatValue(23.456789, null)).toBe(
      (23.456789).toLocaleString("id", {
        maximumFractionDigits: AUTO_MAX_FRACTION_DIGITS,
      })
    );
    expect(formatValue(8, null)).toBe("8");
  });

  test("otomatis membereskan ekor pecahan biner", () => {
    // 23.400000000000002 — inilah bentuk keluhan "angka di belakang koma"
    // yang paling sering muncul di layar.
    expect(formatValue(23.4 + 0.0000000000000018, null)).toBe("23,4");
  });

  test("pakai koma desimal Indonesia, bukan titik", () => {
    expect(formatValue(1.5, 1)).toBe("1,5");
  });

  test("nilai negatif dan nol tetap benar", () => {
    expect(formatValue(0, 2)).toBe("0,00");
    expect(formatValue(-3.14159, 2)).toBe("-3,14");
  });

  test("bukan angka jadi em dash, tidak pernah 'NaN'", () => {
    expect(formatValue(Number.NaN, 1)).toBe("—");
    expect(formatValue(Infinity, null)).toBe("—");
  });

  test("presisi tinggi tidak dipotong diam-diam", () => {
    expect(formatValue(1.23456, 4)).toBe("1,2346");
  });
});
