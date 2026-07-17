"use client";

/** VNC panel — mirrors a dedicated PC's screen (e.g. a browser showing a
 *  cloud SCADA) via noVNC's RFB client over websockify, VIEW-ONLY selamanya.
 *
 *  R-Net owns the connection (no iframe): viewOnly is forced in code, the
 *  password comes from the Source config so the wall auto-connects, and a
 *  dropped connection reconnects itself with backoff — 24/7 tanpa disentuh.
 *  An optional `crop` shows only part of the remote screen (same per-channel
 *  crop as video/web), applied with CSS via CropFrame.
 *  NOTE: client-side viewOnly is a courtesy lock; the real guard is the VNC
 *  server's own view-only / input-block setting.
 */

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import RFB from "@novnc/novnc";
import type { CropRect } from "../types";
import { OrbitFallback } from "./orbit-fallback";
import { CropFrame } from "./crop-frame";

/** Normalize the stored URL to a WebSocket URL: https→wss, http→ws,
 *  ws(s) passes through. Returns null when the scheme is unusable. */
export function vncSocketUrl(raw: string): string | null {
  const url = raw.trim();
  if (!/^(https?|wss?):\/\//i.test(url)) return null;
  return url.replace(/^http/i, "ws");
}

type VncStatus =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "error"; reason: string; retrying: boolean };

/** Reconnect backoff: fast first (blip on the wall heals quickly), then eases
 *  off so a PC that's down for hours isn't hammered. */
function retryDelay(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4));
}

export function VncPanel({
  url: rawUrl,
  password,
  crop,
  srcW,
  srcH,
  onResolution,
}: {
  url: string;
  password?: string | null;
  crop?: CropRect | null;
  /** Reference resolution the crop was drawn against (remote framebuffer). */
  srcW?: number | null;
  srcH?: number | null;
  /** Fired when the live framebuffer size is known (used by the crop editor). */
  onResolution?: (w: number, h: number) => void;
}) {
  // A callback ref in STATE, not a plain ref: the RFB target lives inside
  // CropFrame and may mount a tick later than this component. A useRef would
  // still be null when the effect first runs, and the effect would never re-run
  // — leaving the panel stuck on "connecting" forever, never even dialling.
  const [screenEl, setScreenEl] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<VncStatus>({ state: "connecting" });
  const [nonce, setNonce] = useState(0); // manual reconnect
  // Live framebuffer size, detected from the canvas RFB injects — so the crop
  // frame's aspect matches the real remote screen (no letterbox mismatch).
  const [fb, setFb] = useState<{ w: number; h: number } | null>(null);

  const wsUrl = vncSocketUrl(rawUrl);
  const pass = password ?? undefined;

  useEffect(() => {
    const screen = screenEl;
    if (!screen || !wsUrl) return;

    let rfb: RFB | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fbTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;
    let disposed = false;
    // Retrying can't fix a missing password — stop until manual reconnect.
    let halted = false;

    const connect = () => {
      if (disposed) return;
      setStatus({ state: "connecting" });
      try {
        rfb = new RFB(screen, wsUrl, {
          credentials: pass ? { password: pass } : undefined,
          shared: true,
        });
      } catch {
        scheduleRetry("Alamat VNC tidak valid");
        return;
      }

      // View-only, always — no input ever leaves this panel. The server must
      // ALSO be view-only; this flag alone is not a security boundary.
      rfb.viewOnly = true;
      rfb.focusOnClick = false;
      rfb.scaleViewport = true; // fill the (framebuffer-aspect) crop box
      rfb.clipViewport = false;
      rfb.background = "rgb(0,0,0)";
      // noVNC defaults qualityLevel to 6 — that's JPEG quality, and on a SCADA
      // screen (text, thin lines, flat colour) JPEG at 6 shows as blocky mush,
      // worse still once a crop is magnified. 9 costs some bandwidth on a wall
      // that is mostly static anyway, and keeps text legible.
      rfb.qualityLevel = 9;

      rfb.addEventListener("connect", () => {
        attempt = 0;
        setStatus({ state: "connected" });
        // Poll the injected canvas a few times for the framebuffer size.
        fbTimer = setInterval(() => {
          const canvas = screen.querySelector("canvas");
          if (canvas && canvas.width && canvas.height) {
            setFb((prev) =>
              prev && prev.w === canvas.width && prev.h === canvas.height
                ? prev
                : { w: canvas.width, h: canvas.height }
            );
          }
        }, 1000);
      });
      rfb.addEventListener("credentialsrequired", () => {
        halted = true;
        rfb?.disconnect();
        setStatus({
          state: "error",
          reason: "Server VNC minta password — isi di pengaturan sumber",
          retrying: false,
        });
      });
      rfb.addEventListener("securityfailure", (e) => {
        const detail = (e as CustomEvent<{ reason?: string }>).detail;
        attempt = Math.max(attempt, 4);
        setStatus({
          state: "error",
          reason: detail?.reason || "Autentikasi VNC gagal (password salah?)",
          retrying: true,
        });
      });
      rfb.addEventListener("disconnect", () => {
        rfb = null;
        if (fbTimer) {
          clearInterval(fbTimer);
          fbTimer = null;
        }
        scheduleRetry("Koneksi VNC terputus");
      });
    };

    const scheduleRetry = (reason: string) => {
      if (disposed || halted || timer) return;
      setStatus((s) =>
        s.state === "error"
          ? { ...s, retrying: true }
          : { state: "error", reason, retrying: true }
      );
      const delay = retryDelay(attempt);
      attempt += 1;
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, delay);
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (fbTimer) clearInterval(fbTimer);
      try {
        rfb?.disconnect();
      } catch {
        // already closed
      }
    };
  }, [screenEl, wsUrl, pass, nonce]);

  useEffect(() => {
    if (fb) onResolution?.(fb.w, fb.h);
  }, [fb, onResolution]);

  if (!wsUrl) {
    return <OrbitFallback kind="error" reason="Alamat VNC tidak valid" />;
  }

  const sw = fb?.w ?? srcW ?? 1920;
  const sh = fb?.h ?? srcH ?? 1080;

  return (
    <div className="group relative h-full w-full overflow-hidden bg-black">
      {/* RFB attaches its canvas into screenRef; CropFrame scales/positions it.
          pointer-events-none = belt on top of the viewOnly suspenders: the
          wall can never poke the source PC. */}
      <CropFrame srcW={sw} srcH={sh} crop={crop}>
        <div ref={setScreenEl} className="pointer-events-none h-full w-full" />
      </CropFrame>

      {status.state !== "connected" && (
        <div className="absolute inset-0">
          {status.state === "connecting" ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-sidebar text-text-muted">
              <Loader2 className="size-6 animate-spin" />
              <span className="text-[12px]">Menghubungkan ke sumber VNC…</span>
            </div>
          ) : (
            <OrbitFallback
              kind="error"
              reason={
                status.reason +
                (status.retrying ? " — mencoba ulang otomatis" : "")
              }
            />
          )}
        </div>
      )}

      {/* Manual reconnect — hover only, never covers the screen while watching */}
      <button
        type="button"
        onClick={() => setNonce((n) => n + 1)}
        className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover:opacity-100"
        title="Sambungkan ulang VNC"
      >
        <RefreshCw className="size-3.5" />
      </button>
    </div>
  );
}
