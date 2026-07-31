"use client";

/** Sel grafik mini untuk SATU baris sensor di tab Data.
 *
 *  KENAPA INI KOMPONEN TERSENDIRI, bukan sepotong JSX di dalam tabel.
 *
 *  Ini bagian termahal dari halaman Data, dan dulu seluruhnya dikerjakan ulang
 *  untuk SETIAP sensor setiap kali SATU sensor mana pun berdetak:
 *
 *    - memo `rows` di AnalysisView bergantung pada `store.liveBuffers`, yang
 *      berganti identitas pada setiap sampel masuk. Jadi tiap sampel memicu
 *      pembangunan ulang deret untuk seluruh sensor di lembar itu — menyalin
 *      100 baris tersimpan, lalu menjalankan `new Date(p.ts).getTime()` atas
 *      SELURUH ekor live (batasnya 400 titik) per sensor. Di 50 sensor pada
 *      irama 5 detik, itu sekitar 200.000 konstruksi Date per detik untuk
 *      menggambar ulang gambar yang 49 di antaranya identik dengan sebelumnya.
 *    - lalu `withLiveTail` dijalankan lagi INLINE saat render, di luar memo,
 *      untuk ke-50 baris.
 *
 *  Sekarang tiap sel berlangganan ekor live SENSORNYA SENDIRI. Satu sensor
 *  berdetak → satu sel bekerja. Sisanya tidak digambar ulang sama sekali,
 *  karena React.memo di bawah melihat props yang benar-benar sama. */

import { memo, useMemo } from "react";
import type { RecentSample } from "../types";
import { useTagLiveBuffer } from "../store";
import { TagSparkline, type SparkStatus } from "./tag-sparkline";
import { withLiveTail } from "./live-tail";

/** Deret naik = baris tersimpan + setiap titik live sesi ini yang LEBIH BARU
 *  dari baris tersimpan terakhir.
 *
 *  Dipakai bersama oleh sel sparkline dan baris detail, supaya keduanya tidak
 *  bisa menggambar sensor yang sama dari dua kumpulan titik yang berbeda. */
export function buildSeries(
  storedNewestFirst: RecentSample[],
  buffer: { ts: string; value: number }[] | undefined,
  cap = 100
): RecentSample[] {
  const series = [...storedNewestFirst].reverse();
  const newestStoredMs =
    storedNewestFirst.length > 0
      ? new Date(storedNewestFirst[0].ts).getTime()
      : null;
  for (const p of buffer ?? []) {
    if (newestStoredMs === null || new Date(p.ts).getTime() > newestStoredMs) {
      series.push({ ts: p.ts, value: p.value });
    }
  }
  return series.length > cap ? series.slice(series.length - cap) : series;
}

export const TagSparkCell = memo(function TagSparkCell({
  tagId,
  stored,
  base,
  pending,
  status,
}: {
  tagId: string;
  /** Baris mentah untuk sensor ini (terbaru dulu); kosong kalau tidak dimuat. */
  stored: RecentSample[] | undefined;
  /** Deret ber-bucket dari /sparklines untuk jendela Rentang saat ini. */
  base: RecentSample[] | undefined;
  /** Jendela yang diminta belum tiba — gambar placeholder yang diam. */
  pending: boolean;
  status: SparkStatus;
}) {
  const buffer = useTagLiveBuffer(tagId);

  const samples = useMemo(() => {
    const series = buildSeries(stored ?? [], buffer);
    // Sama seperti sebelumnya: pakai deret ber-bucket kalau sudah ada, dan
    // sambung ekor live-nya dengan bucket yang sejajar (lihat live-tail.ts).
    // Kalau belum, tampilkan ekor live apa adanya — sensor yang baru saja
    // dipasang belum punya bucket sama sekali.
    return (base?.length ?? 0) >= 2
      ? withLiveTail(base!, series)
      : series.slice(-50);
  }, [stored, buffer, base]);

  return <TagSparkline pending={pending} samples={samples} status={status} />;
});
