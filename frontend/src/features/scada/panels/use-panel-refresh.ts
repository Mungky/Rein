"use client";

/** Shared refresh cadence for historian panels: fetch on mount (deferred a
 *  tick so state lands after the effect commit), every 60s (the sampler
 *  cadence), and whenever the tab becomes visible again.
 *
 *  Dua rem menempel di jadwal ini, keduanya menjawab hal yang sama — kerja yang
 *  hasilnya tidak dilihat siapa pun:
 *
 *    - dinding Monitor tersembunyi (user di tab Data/Channel) → jadwal berhenti
 *      total; lihat wall-visibility.tsx
 *    - tab browser bolak-balik ke depan → pengambilan ulang diberi jarak minimum
 */

import { useEffect, useRef } from "react";
import { useWallVisible } from "./wall-visibility";

const REFRESH_MS = 60_000;

/** Jarak minimum antara dua pengambilan yang dipicu oleh tab kembali terlihat.
 *
 *  Tanpa ini, berpindah-pindah jendela menembakkan SATU permintaan PER PANEL
 *  setiap kali tab kembali ke depan. Di dinding 10 panel, tiga kali alt-tab
 *  dalam sepuluh detik = 30 permintaan yang menjawab pertanyaan yang sama
 *  seperti pengambilan beberapa detik sebelumnya. Data 60 detik yang menjadi
 *  cadens dasar tidak berubah dalam waktu sesingkat itu. */
const VISIBILITY_MIN_GAP_MS = 15_000;

export function usePanelRefresh(load: () => Promise<void>) {
  const visible = useWallVisible();
  const lastLoadAt = useRef(0);
  /** `load` yang terakhir benar-benar dijalankan — pembeda antara "pertanyaan
   *  berubah" dan "kita cuma kembali melihat panel yang sama". */
  const lastLoadFn = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    // Dinding tersembunyi (user ada di tab Data/Channel) → tidak ada jadwal
    // sama sekali. Saat kembali terlihat, efek ini terpasang lagi dan
    // pengambilan pertama di bawah langsung menyegarkan isinya.
    if (!visible) return;

    const run = () => {
      lastLoadAt.current = Date.now();
      lastLoadFn.current = load;
      void load();
    };
    const first = setTimeout(() => {
      // Pertanyaannya berubah (tag/rentang lain) → selalu ambil. Pertanyaannya
      // sama dan baru saja dijawab → jangan ambil lagi hanya karena user
      // bolak-balik antar tab.
      const sameQuery = lastLoadFn.current === load;
      if (sameQuery && Date.now() - lastLoadAt.current < VISIBILITY_MIN_GAP_MS) {
        return;
      }
      run();
    }, 0);
    const interval = setInterval(run, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadAt.current < VISIBILITY_MIN_GAP_MS) return;
      run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, visible]);
}
