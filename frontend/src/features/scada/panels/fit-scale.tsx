"use client";

/** FitScale — "ukuran persen" untuk komponen data/HMI: isi panel dirender
 *  pada ukuran DESAIN tetap (canvas px) lalu diskala uniform mengikuti box.
 *  Panel dikecilkan → semua isi (angka, label, chip status) ikut mengecil
 *  proporsional — tidak ada yang terpotong. Box layout dalam dibuat
 *  boxW/s × boxH/s (bukan letterbox), jadi isi tetap memenuhi seluruh sel
 *  apa pun aspeknya. */

import { useEffect, useRef, useState } from "react";

export function FitScale({
  designW,
  designH,
  children,
}: {
  /** Ukuran desain (canvas px) — konten tampil 1:1 saat box tepat seukuran ini. */
  designW: number;
  designH: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const s = box.w > 0 && box.h > 0 ? Math.min(box.w / designW, box.h / designH) : 0;

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      {s > 0 && (
        <div
          className="absolute left-0 top-0"
          style={{
            width: box.w / s,
            height: box.h / s,
            transform: `scale(${s})`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
