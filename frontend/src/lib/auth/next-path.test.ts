/** bun test — ke mana halaman login boleh mengarahkan setelah berhasil masuk.
 *
 *  Dua hal dijaga di sini, dan yang kedua lebih penting daripada yang pertama.
 *
 *  1. `?next=` HARUS dipatuhi. Gerbang REIN sudah lama melampirkannya, tapi
 *     halaman login mengabaikannya dan selalu ke /dcc — jadi sesi yang mati di
 *     tengah pekerjaan membuang user ke halaman lain.
 *
 *  2. HANYA path relatif yang diterima. `?next=https://evil.example` adalah
 *     redirect terbuka: penyerang mengirim tautan ke halaman login REIN yang
 *     ASLI — domain benar, sertifikat benar, tampilan benar — dan begitu user
 *     mengetikkan kredensialnya, halaman itu sendiri yang memantulkan mereka ke
 *     situs tiruan.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_LANDING, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  test("path relatif dipakai apa adanya", () => {
    expect(safeNextPath("?next=%2Fr-net")).toBe("/r-net");
    expect(safeNextPath("?next=%2Fdcc%2Faccess")).toBe("/dcc/access");
  });

  test("query dan fragment ikut terbawa", () => {
    // Dikunci dari sebuah tampilan tertentu harus mengembalikan ke tampilan itu.
    expect(safeNextPath("?next=%2Fr-net%3Ftab%3Ddata")).toBe("/r-net?tab=data");
  });

  test("tanpa next → tujuan bawaan", () => {
    expect(safeNextPath("")).toBe(DEFAULT_LANDING);
    expect(safeNextPath("?")).toBe(DEFAULT_LANDING);
    expect(safeNextPath("?next=")).toBe(DEFAULT_LANDING);
    expect(safeNextPath("?other=1")).toBe(DEFAULT_LANDING);
  });

  test("URL absolut DITOLAK — ini inti perlindungannya", () => {
    for (const evil of [
      "https://evil.example",
      "http://evil.example",
      "HTTPS://evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>",
    ]) {
      expect(safeNextPath(`?next=${encodeURIComponent(evil)}`)).toBe(DEFAULT_LANDING);
    }
  });

  test("protocol-relative DITOLAK — browser membacanya sebagai situs lain", () => {
    // "//evil.example" terlihat seperti path karena diawali "/", tapi browser
    // memuatnya sebagai https://evil.example. Begitu juga varian backslash,
    // yang dinormalkan sebagian browser jadi "//".
    for (const evil of ["//evil.example", "/\\evil.example", "//\\evil.example"]) {
      expect(safeNextPath(`?next=${encodeURIComponent(evil)}`)).toBe(DEFAULT_LANDING);
    }
  });

  test("path tanpa garis miring di depan DITOLAK", () => {
    // "evil.example" akan diselesaikan relatif terhadap halaman saat ini —
    // bukan serangan, tapi juga bukan tujuan yang pernah kita maksudkan.
    expect(safeNextPath("?next=evil.example")).toBe(DEFAULT_LANDING);
    expect(safeNextPath("?next=dcc")).toBe(DEFAULT_LANDING);
  });

  test("karakter kendali DITOLAK", () => {
    // Browser membuang \n dan \t dari URL, jadi "/\n/evil.example" bisa lolos
    // pemeriksaan awalan lalu berubah bentuk setelahnya.
    expect(safeNextPath("?next=%2F%0A%2Fevil.example")).toBe(DEFAULT_LANDING);
    expect(safeNextPath("?next=%2F%09%2Fevil.example")).toBe(DEFAULT_LANDING);
  });

  test("garis miring tunggal tetap sah", () => {
    // Jangan sampai perlindungannya menolak halaman utama itu sendiri.
    expect(safeNextPath("?next=%2F")).toBe("/");
  });
});
