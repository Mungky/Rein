"use client";

/** Apakah dinding Monitor sedang terlihat.
 *
 *  Dinding Monitor SENGAJA tidak pernah dilepas dari DOM: iframe halaman web di
 *  dalamnya butuh puluhan detik untuk boot, jadi melepasnya setiap kali user
 *  pindah ke tab Data berarti setiap kembali ke Monitor disambut layar kosong
 *  yang memuat ulang dari nol. Karena itu ia hanya disembunyikan (`hidden`).
 *
 *  Tapi "disembunyikan" hanya menghentikan penggambaran — TIDAK menghentikan
 *  kerjanya. Setiap panel tetap menjalankan jadwal 60 detiknya, jadi dinding
 *  10 panel tetap menembakkan 10 permintaan per menit sementara yang dilihat
 *  user adalah tabel di tab Data. Sepanjang shift, itu ribuan permintaan untuk
 *  piksel yang tidak pernah ada di layar.
 *
 *  Konteks ini memberi panel jawaban atas pertanyaan yang tidak bisa mereka
 *  jawab sendiri: "apakah ada yang sedang melihat saya?" Bawaannya `true`,
 *  supaya panel yang dipakai di luar dinding (pratinjau di halaman Channel,
 *  daftar versi ponsel) tetap berjalan seperti biasa tanpa provider apa pun. */

import { createContext, useContext } from "react";

const WallVisibleContext = createContext(true);

export const WallVisibleProvider = WallVisibleContext.Provider;

export function useWallVisible(): boolean {
  return useContext(WallVisibleContext);
}
