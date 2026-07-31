/** bun test — jatah titik grafik Monitor.
 *
 *  Yang dijaga di sini adalah satu sifat yang kalau hilang tidak menimbulkan
 *  error apa pun, cuma setelan yang berhenti bekerja: GAYA GARIS HARUS TERLIHAT.
 *
 *  Versi lama memberi jatah mati 360 titik untuk rentang 24 jam. Di panel
 *  selebar ~760 px itu 2 px per titik — dan pada jarak 2 px, "Patah", "Halus",
 *  dan "Tangga" menggambar lintasan yang sama persis. Setelannya sampai ke
 *  recharts dengan benar; hasilnya saja yang mustahil dilihat mata. Jadi user
 *  melaporkannya sebagai "Tipe Grafik tidak bisa diubah".
 */

import { describe, expect, test } from "bun:test";
import { RANGE_POINTS, pointBudget } from "./chart-panel";

describe("pointBudget", () => {
  test("belum terukur → jatah penuh, bukan jatah minimum", () => {
    // Grafik tidak boleh lahir kasar lalu diam-diam diperbaiki sedetik kemudian.
    for (const w of [0, -1, Number.NaN]) {
      expect(pointBudget(w, "24h", "linear")).toBe(RANGE_POINTS["24h"]);
    }
  });

  test("tidak pernah melebihi jatah rentangnya", () => {
    for (const range of ["1h", "6h", "24h", "7d", "30d"] as const) {
      expect(pointBudget(20_000, range, "linear")).toBeLessThanOrEqual(
        RANGE_POINTS[range]
      );
    }
  });

  test("panel sempit minta titik lebih sedikit daripada panel lebar", () => {
    expect(pointBudget(320, "1h", "linear")).toBeLessThan(
      pointBudget(1600, "1h", "linear")
    );
  });

  test("Halus dan Tangga minta titik lebih renggang daripada Patah", () => {
    // Inti perbaikannya: kurva dan tapak tangga perlu ruang untuk terbaca.
    const patah = pointBudget(760, "24h", "linear");
    const halus = pointBudget(760, "24h", "smooth");
    const tangga = pointBudget(760, "24h", "step");
    expect(halus).toBeLessThan(patah);
    expect(tangga).toBeLessThan(patah);
  });

  test("panel 760 px dapat jarak titik yang cukup untuk membedakan gaya", () => {
    // Ambang praktisnya: minimal 4 px antar titik untuk Patah, dan 8 px untuk
    // Halus/Tangga. Di bawah itu bentuk garisnya kembali tidak terbedakan.
    const w = 760;
    expect(w / pointBudget(w, "24h", "linear")).toBeGreaterThanOrEqual(4);
    expect(w / pointBudget(w, "24h", "smooth")).toBeGreaterThanOrEqual(8);
    expect(w / pointBudget(w, "24h", "step")).toBeGreaterThanOrEqual(8);
  });

  test("line_style kosong diperlakukan sebagai Patah (bawaan lama)", () => {
    // Panel yang dibuat sebelum "Gaya Garis" ada tidak punya field ini, dan
    // tampilannya tidak boleh berubah sendiri hanya karena kode diperbarui.
    expect(pointBudget(760, "24h", undefined)).toBe(
      pointBudget(760, "24h", "linear")
    );
  });

  test("lebar dibulatkan — geseran kecil tidak mengubah jatah", () => {
    // Kalau tiap piksel mengubah jatah, menyeret gagang ukuran panel akan
    // memicu satu pengambilan riwayat per piksel.
    expect(pointBudget(755, "24h", "linear")).toBe(
      pointBudget(765, "24h", "linear")
    );
  });

  test("selalu ada titik, bahkan di panel sepetak", () => {
    expect(pointBudget(40, "24h", "step")).toBeGreaterThan(0);
  });
});
