"use client";

/** Web-embed panel (DIRECT variant — Channel-page preview & mobile list).
 *  The page is laid out at the channel's native resolution (view_w×view_h,
 *  like an OBS source) and scaled to fit its container — so what you see here
 *  is pixel-identical to the Monitor wall. The monitor wall itself uses the
 *  keep-alive WebLiveLayer instead (iframes survive page flips).
 *
 *  No fullscreen permission: the embedded site's own fullscreen fills its
 *  viewport (= this panel), never the whole monitor. */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import type { CropRect, WebPanelConfig } from "../types";
import { OrbitFallback } from "./orbit-fallback";
import { CropFrame } from "./crop-frame";

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Berhenti menunggu setelah ini dan katakan sesuatu. Halaman HMI yang sehat
 *  membangkitkan `load` dalam beberapa detik; kalau tidak, penyebabnya biasanya
 *  host tak terjangkau atau tunnel mati — dan diam-diam menampilkan kotak putih
 *  selamanya adalah jawaban paling tidak berguna yang bisa diberikan. */
const LOAD_TIMEOUT_MS = 8000;

/** Izin sandbox untuk halaman yang disematkan.
 *
 *  Sebelumnya hanya `allow-scripts allow-same-origin allow-forms`, dan itu
 *  penyebab "putih" yang paling sering bisa kita perbaiki sendiri: HMI cloud
 *  (Wecon V-Net dan sejenisnya) memanggil window.open, alert(), atau membuka
 *  unduhan saat boot. Di dalam sandbox seketat itu panggilan tersebut MELEMPAR,
 *  skrip boot-nya mati di tengah jalan, dan yang tersisa di layar adalah <body>
 *  kosong — bukan pesan error, cuma putih.
 *
 *  `allow-top-navigation` sengaja TIDAK diberikan: halaman tersemat tidak boleh
 *  bisa membawa seluruh REIN pindah alamat. */
export const WEB_SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-modals",
  "allow-downloads",
  "allow-storage-access-by-user-activation",
].join(" ");

export function WebPanel({
  config,
  crop,
}: {
  config: WebPanelConfig;
  /** Screen-channel crop (in view_w×view_h pixels). When set, the page is
   *  cropped via CropFrame instead of the legacy zoom/offset box. */
  crop?: CropRect | null;
}) {
  const zoom = clamp(config.zoom ?? 1, 0.25, 3);
  const ox = Math.max(0, config.offset_x ?? 0);
  const oy = Math.max(0, config.offset_y ?? 0);
  const vw = config.view_w ?? 1920;
  const vh = config.view_h ?? 1080;
  const [nonce, setNonce] = useState(0);
  const [phase, setPhase] = useState<"loading" | "loaded" | "timeout">("loading");

  // Batas waktu per percobaan muat. Direset oleh `nonce` supaya tombol muat
  // ulang benar-benar memberi kesempatan baru, bukan langsung kembali ke pesan
  // gagal yang sama.
  useEffect(() => {
    const t = setTimeout(
      () => setPhase((p) => (p === "loading" ? "timeout" : p)),
      LOAD_TIMEOUT_MS
    );
    return () => clearTimeout(t);
  }, [nonce, config.url]);

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

  const url = /^https?:\/\//i.test(config.url) ? config.url : null;
  if (!url) {
    return <OrbitFallback kind="error" reason="Alamat web tidak valid" />;
  }

  const s = box.w > 0 && box.h > 0 ? Math.min(box.w / vw, box.h / vh) : 0;

  const reload = () => {
    setPhase("loading");
    setNonce((n) => n + 1);
  };

  const frameProps = {
    key: nonce,
    src: url,
    title: url,
    onLoad: () => setPhase("loaded"),
    sandbox: WEB_SANDBOX,
    // Dulu "no-referrer". Sebagian situs menolak disematkan justru ketika
    // Referer-nya hilang, jadi mereka tampil putih tanpa alasan yang terlihat.
    // Ini mengirimkan asal REIN saja (bukan alamat lengkap), dan hanya ke HTTPS.
    referrerPolicy: "strict-origin-when-cross-origin" as const,
  };

  const frame = (
    <iframe
      {...frameProps}
      className="absolute left-0 top-0 h-full w-full border-0"
    />
  );

  // DI ATAS iframe, bukan di bawahnya.
  //
  // Ini inti perbaikannya. Penjelasan tadi digambar SEBELUM iframe, jadi ketika
  // situs menolak disematkan, halaman error opaque milik browser menutupinya —
  // dan karena bg-bg-sidebar itu putih di mode terang, yang tersisa hanyalah
  // kotak putih tanpa satu pun petunjuk. Pesannya ada; tidak pernah terlihat.
  const overlay =
    phase === "loading" ? (
      <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-bg-sidebar text-center text-text-muted">
        <Loader2 className="size-5 animate-spin" />
        <span className="px-4 text-[11.5px]">Memuat halaman…</span>
      </div>
    ) : phase === "timeout" ? (
      <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-bg-sidebar px-4 text-center text-text-muted">
        <Globe className="size-6 opacity-50" />
        <span className="text-[11.5px]">
          Halaman tidak merespons dalam 8 detik. Periksa alamatnya, atau apakah
          perangkat/tunnel-nya sedang hidup.
        </span>
        <OpenExternally url={url} />
      </div>
    ) : null;

  // Sudah termuat tapi mungkin tetap kosong — dan itu TIDAK bisa dideteksi dari
  // sini: halaman yang diblokir X-Frame-Options tetap membangkitkan `load`, dan
  // isinya lintas-asal sehingga tak bisa diperiksa. Jadi jangan menebak; sediakan
  // penjelasan + jalan keluar yang muncul saat kursor masuk, sama seperti tombol
  // muat ulang. Menonton di dinding tidak terganggu; yang sedang menyiapkan
  // channel langsung menemukannya.
  const blankHelp = phase === "loaded" && (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex items-center justify-center gap-2 bg-black/65 px-3 py-1.5 text-[10.5px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
      <span className="truncate">
        Kosong? Situs ini mungkin menolak ditampilkan di dalam REIN
        (X-Frame-Options).
      </span>
      <OpenExternally url={url} light />
    </div>
  );

  // Screen-channel crop path: the page is laid out at its native viewport and
  // CropFrame scales/positions it so only the crop region shows.
  if (crop) {
    return (
      <div className="group relative h-full w-full overflow-hidden bg-black">
        <CropFrame srcW={vw} srcH={vh} crop={crop}>
          {frame}
        </CropFrame>
        {overlay}
        {blankHelp}
        <ReloadButton onClick={reload} />
      </div>
    );
  }

  return (
    <div ref={ref} className="group relative h-full w-full overflow-hidden bg-black">
      {s > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: (box.w - vw * s) / 2,
            top: (box.h - vh * s) / 2,
            width: vw,
            height: vh,
            transform: `scale(${s})`,
            transformOrigin: "top left",
          }}
        >
          <iframe
            {...frameProps}
            className="absolute left-0 top-0 border-0"
            style={{
              width: `calc(${100 / zoom}% + ${ox}px)`,
              height: `calc(${100 / zoom}% + ${oy}px)`,
              transform: `scale(${zoom}) translate(-${ox}px, -${oy}px)`,
              transformOrigin: "top left",
            }}
          />
        </div>
      )}

      {overlay}
      {blankHelp}

      {/* Reload — appears on hover so it never covers the HMI while watching */}
      <ReloadButton onClick={reload} />
    </div>
  );
}

/** "Buka di tab baru" — jalan keluar ketika penyematan memang tidak mungkin.
 *  Situs yang mengirim X-Frame-Options tidak akan pernah tampil di dalam frame,
 *  seberapa sering pun tombol muat ulang ditekan. */
function OpenExternally({ url, light }: { url: string; light?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        light
          ? "inline-flex shrink-0 items-center gap-1 font-semibold underline decoration-white/40 underline-offset-2 hover:decoration-white"
          : "btn btn-secondary btn-sm gap-1.5"
      }
    >
      <ExternalLink className="size-3" /> Buka di tab baru
    </a>
  );
}

/** Hover-only reload button (shared by the crop & legacy render paths). */
function ReloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover:opacity-100"
      title="Muat ulang halaman"
    >
      <RefreshCw className="size-3.5" />
    </button>
  );
}
