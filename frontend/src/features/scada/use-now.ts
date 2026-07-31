"use client";

/** Jam dinding bersama untuk R-Net.
 *
 *  R-Net punya EMPAT jam yang berdetak sendiri-sendiri, dua di antaranya kode
 *  yang identik baris demi baris (data-refresh.tsx dan analysis-view.tsx: sama
 *  persis, sampai ke `setTimeout(update, 0)` di depannya). Setiap salinan
 *  membangunkan React-nya sendiri pada jadwalnya sendiri, jadi "10 detik"
 *  sebenarnya berarti empat kebangunan yang tersebar acak dalam sepuluh detik.
 *
 *  Satu ticker per interval, dipakai bersama oleh semua pemanggil dengan
 *  interval yang sama: yang meminta 10 detik bangun BERSAMAAN, sekali.
 *
 *  Kenapa state, bukan Date.now() saat render: memanggil Date.now() di dalam
 *  render melanggar aturan kemurnian React (react-hooks/purity) — hasilnya
 *  berubah tanpa ada yang memberi tahu React, jadi tampilan bisa menua tanpa
 *  pernah digambar ulang. Nilai awalnya `null` supaya server dan klien
 *  merender hal yang sama pada bingkai pertama. */

import { useEffect, useState } from "react";

type Tick = { now: number; subs: Set<(n: number) => void>; timer: number | null };

const tickers = new Map<number, Tick>();

function subscribe(stepMs: number, fn: (n: number) => void): () => void {
  let t = tickers.get(stepMs);
  if (!t) {
    t = { now: Date.now(), subs: new Set(), timer: null };
    tickers.set(stepMs, t);
  }
  const tick = t;
  tick.subs.add(fn);
  if (tick.timer === null) {
    tick.timer = window.setInterval(() => {
      tick.now = Date.now();
      for (const s of tick.subs) s(tick.now);
    }, stepMs);
  }
  return () => {
    tick.subs.delete(fn);
    // Pemakai terakhir pergi → matikan timer-nya. Ticker yang menganggur akan
    // membangunkan tab yang sedang tidak dipakai selama halaman terbuka.
    if (tick.subs.size === 0 && tick.timer !== null) {
      window.clearInterval(tick.timer);
      tick.timer = null;
      tickers.delete(stepMs);
    }
  };
}

/** Waktu sekarang (epoch ms), diperbarui tiap `stepMs`. `null` pada bingkai
 *  pertama — pemanggil memperlakukannya sebagai "belum diketahui". */
export function useNowMs(stepMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Tick pertama ditunda satu putaran, bukan setState langsung di badan efek
    // (aturan react-hooks/set-state-in-effect) — pola yang sama dipakai
    // use-panel-refresh dan jam-jam yang digantikan berkas ini.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const unsubscribe = subscribe(stepMs, setNow);
    return () => {
      clearTimeout(first);
      unsubscribe();
    };
  }, [stepMs]);
  return now;
}
