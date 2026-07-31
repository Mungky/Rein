/** bun test — mengubah kegagalan API jadi kalimat yang bisa ditindaklanjuti.
 *
 *  Yang dijaga di sini: alasan yang SUDAH dikirim server tidak boleh dibuang.
 *
 *  ApiError.message berisi body mentah FastAPI, jadi hampir semua pemanggil
 *  menulis `catch { toast.error("Gagal ...") }` dan membuang penjelasannya.
 *  Akibatnya nyata: 422 "URL web harus diawali http:// atau https://" tampil
 *  sebagai "Gagal menyimpan sumber" — user membaca itu sebagai fiturnya rusak,
 *  padahal jaraknya satu kata dari berhasil.
 */

import { describe, expect, test } from "bun:test";
import { ApiError, apiErrorText } from "./client";

const FB = "Gagal menyimpan sumber";

describe("apiErrorText", () => {
  test("detail string HTTPException ikut ditampilkan", () => {
    const e = new ApiError(404, JSON.stringify({ detail: "Halaman tidak ditemukan" }));
    expect(apiErrorText(e, FB)).toBe(`${FB}: Halaman tidak ditemukan`);
  });

  test("galat validasi 422 — pesan diangkat dari daftar", () => {
    const e = new ApiError(
      422,
      JSON.stringify({
        detail: [
          {
            loc: ["body", "url"],
            msg: "Value error, URL web harus diawali http:// atau https://",
            type: "value_error",
          },
        ],
      })
    );
    // Prefiks "Value error," itu bocoran pydantic, bukan bahasa manusia.
    expect(apiErrorText(e, FB)).toBe(
      `${FB}: URL web harus diawali http:// atau https://`
    );
  });

  test("beberapa galat digabung, duplikat dibuang", () => {
    const e = new ApiError(
      422,
      JSON.stringify({
        detail: [
          { msg: "Nama wajib diisi" },
          { msg: "Nomor minimal 1" },
          { msg: "Nama wajib diisi" },
        ],
      })
    );
    expect(apiErrorText(e, FB)).toBe(`${FB}: Nama wajib diisi; Nomor minimal 1`);
  });

  test("body bukan JSON → pakai kalimat pemanggil", () => {
    // Halaman error HTML dari proxy lebih menyesatkan daripada membantu kalau
    // ditumpahkan mentah-mentah ke dalam toast.
    const e = new ApiError(502, "<html><body>Bad Gateway</body></html>");
    expect(apiErrorText(e, FB)).toBe(FB);
  });

  test("JSON tanpa detail, detail kosong, atau bentuk aneh → fallback", () => {
    for (const body of [
      "{}",
      JSON.stringify({ detail: "" }),
      JSON.stringify({ detail: "   " }),
      JSON.stringify({ detail: [] }),
      JSON.stringify({ detail: [{ loc: ["body"] }] }),
      JSON.stringify({ detail: 42 }),
    ]) {
      expect(apiErrorText(new ApiError(400, body), FB)).toBe(FB);
    }
  });

  test("bukan Error sama sekali → fallback, tidak melempar", () => {
    // Sebuah `catch` bisa menerima apa pun. Pembuat pesan error tidak boleh
    // menjadi error kedua.
    for (const thrown of [undefined, null, "boom", 0, {}, []]) {
      expect(apiErrorText(thrown, FB)).toBe(FB);
    }
  });

  test("Error biasa tanpa body JSON → fallback", () => {
    expect(apiErrorText(new Error("Failed to fetch"), FB)).toBe(FB);
    expect(apiErrorText(new Error(""), FB)).toBe(FB);
  });

  test("status tetap terbaca untuk penanganan khusus", () => {
    // Fase gerbang session akan bercabang pada 401 — pastikan tetap tersedia.
    expect(new ApiError(401, "{}").status).toBe(401);
  });
});
