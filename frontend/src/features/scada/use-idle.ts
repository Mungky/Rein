"use client";

/** Sudah berapa lama tidak ada tanda kehadiran manusia di halaman ini.
 *
 *  KENAPA INI ADA, dan kenapa bukan "sesi kedaluwarsa".
 *
 *  Laporan aslinya: "ketika session habis saya masih bebas buka halaman apapun".
 *  Yang sebenarnya terjadi lebih mendasar daripada gerbang yang bolong — SESINYA
 *  TIDAK PERNAH HABIS. proxy.ts memanggil supabase.auth.getUser() pada setiap
 *  navigasi, dan panggilan itu memperbarui access token selama refresh token
 *  masih hidup. Tidak ada batas umur mutlak maupun batas diam di mana pun, jadi
 *  tab yang dibiarkan terbuka semalaman tetap masuk penuh keesokan paginya.
 *  Menambal daftar rute terjaga tidak mengubah itu sedikit pun.
 *
 *  Jadi yang diukur di sini bukan token, melainkan KEHADIRAN. Setelah sekian
 *  lama tanpa satu pun tanda ada orang di depan layar, R-Net memperlakukan
 *  sesinya sebagai basi dan meminta login ulang sebelum membuka halaman yang
 *  bisa mengubah sesuatu.
 *
 *  Ini gerbang KENYAMANAN, bukan gerbang keamanan — dan bedanya penting. Siapa
 *  pun bisa melewatinya dengan menekan tombol muat ulang. Yang benar-benar
 *  menjaga data tetap backend: setiap endpoint R-Net menuntut permission-nya
 *  sendiri, dan tak satu pun dari mereka terbuka tanpa auth.
 *
 *  Monitor sengaja dibiarkan hidup saat basi: layar dinding memang dipasang
 *  untuk ditonton berjam-jam tanpa disentuh, dan mengunci layar pemantauan
 *  justru kebalikan dari gunanya. */

import { useEffect, useState } from "react";

/** Peristiwa yang dihitung sebagai "ada orang di sini".
 *
 *  Sengaja TIDAK termasuk `mousemove`: kursor bisa tergeser oleh getaran meja
 *  atau kucing, dan yang lebih menentukan — banyak layar dinding memakai mouse
 *  yang menganggur di dekat pengguna lain. Yang dihitung adalah niat: menekan,
 *  mengetik, menggulir, menyentuh. */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/** Seberapa sering diperiksa. Tidak perlu presisi detik untuk ambang 30 menit,
 *  dan pemeriksaan yang jarang berarti tab yang menganggur benar-benar diam. */
const CHECK_MS = 30_000;

/**
 * `true` kalau sudah lebih dari `idleMs` sejak tanda kehadiran terakhir.
 *
 * Kembali `false` seketika begitu ada aktivitas lagi — memanggilnya "basi"
 * setelah user kembali menyentuh layar hanya akan mengunci orang yang jelas-jelas
 * sedang ada di sana.
 */
export function useIdle(idleMs: number): boolean {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let lastActivity = Date.now();

    const markActive = () => {
      lastActivity = Date.now();
      setStale((prev) => (prev ? false : prev));
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, markActive, { passive: true });
    }
    // Kembali ke tab ini juga tanda kehadiran — user baru saja memilihnya.
    const onVisible = () => {
      if (document.visibilityState === "visible") markActive();
    };
    document.addEventListener("visibilitychange", onVisible);

    const timer = setInterval(() => {
      setStale(Date.now() - lastActivity >= idleMs);
    }, CHECK_MS);

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, markActive);
      }
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [idleMs]);

  return stale;
}
