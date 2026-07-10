"use client";

/** HLS video panel — built for an unattended 24/7 monitoring wall.
 *
 *  Reliability behavior:
 *  - Fatal hls.js errors retry forever with capped backoff (2s → 15s).
 *  - Stale watchdog: if the video clock stops advancing for 15s while we
 *    think we're "live" (e.g. OBS died but MediaMTX still serves the last
 *    playlist), force a full restart. Never a dead black box.
 */

import { useEffect, useRef, useState } from "react";
import Hls, { type ErrorData } from "hls.js";
import { Loader2, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useScadaStore } from "../store";
import type { Stream, VideoPanelConfig } from "../types";

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 15000;
const WATCHDOG_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 15000;

type PlayerStatus = "connecting" | "live" | "reconnecting";

/** MediaMTX (>= 1.12) only accepts HLS read credentials via the
 *  `Authorization: Basic` header on every request — query params
 *  (?user=&pass=) are no longer honored for reads. */
function basicAuthHeader(stream: Stream): string | null {
  if (!stream.read_user) return null;
  return "Basic " + btoa(`${stream.read_user}:${stream.read_pass ?? ""}`);
}

/** Turn an hls.js error into a short code + a plain-language cause so the wall
 *  operator can act without reading logs. HTTP status is the most telling
 *  signal (401 = auth, 404 = OBS off, 5xx = server/tunnel). */
function describeError(data: ErrorData): { code: string; hint: string } {
  const httpCode = data.response?.code;
  if (httpCode) {
    if (httpCode === 401 || httpCode === 403)
      return { code: `HTTP ${httpCode}`, hint: "Akses ditolak — cek user/password di Kelola Stream" };
    if (httpCode === 404)
      return { code: "HTTP 404", hint: "Stream tidak ada — OBS mungkin belum 'Start Streaming'" };
    if (httpCode >= 500)
      return { code: `HTTP ${httpCode}`, hint: "Server stream bermasalah — cek MediaMTX / tunnel" };
    return { code: `HTTP ${httpCode}`, hint: "Gangguan pada server stream" };
  }
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR)
    return { code: data.details || "NETWORK", hint: "Tak terjangkau — tunnel/koneksi mungkin mati" };
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR)
    return { code: data.details || "MEDIA", hint: "Masalah decoding video" };
  return { code: data.details || "UNKNOWN", hint: "Gangguan tidak dikenal" };
}

export function VideoPanel({
  stream,
  config,
}: {
  stream: Stream | undefined;
  config: VideoPanelConfig;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<PlayerStatus>("connecting");
  // Network ping (segment fetch time-to-first-byte, ms) — shown as a game-style
  // signal meter. NOT the glass-to-glass latency (HLS keeps that a few seconds).
  const [pingMs, setPingMs] = useState<number | null>(null);
  // Last diagnostic while not live — {code, hint} so operators know why.
  const [errorInfo, setErrorInfo] = useState<{ code: string; hint: string } | null>(null);
  const isMobile = useIsMobile();
  // Bumped by "Segarkan Stream" in Kelola Stream — forces a fresh reconnect.
  const reconnectNonce = useScadaStore((s) => s.streamReconnectNonce);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    let hls: Hls | null = null;
    let retries = 0;
    let disposed = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    // Avoid re-setting state on every repeat of the same error detail.
    let lastErrCode: string | null = null;

    const scheduleRestart = () => {
      if (disposed) return;
      setStatus("reconnecting");
      const delay = Math.min(RETRY_BASE_MS * 2 ** retries, RETRY_MAX_MS);
      retries += 1;
      restartTimer = setTimeout(start, delay);
    };

    const teardown = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };

    const start = () => {
      if (disposed) return;
      teardown();

      const src = stream.hls_url;
      const auth = basicAuthHeader(stream);

      if (Hls.isSupported()) {
        // Desktop wall: aggressive low latency (~3s). Mobile: thin LL buffers
        // stutter on flaky phone networks — trade a few seconds of latency
        // for a deeper buffer and smooth playback.
        const tuning = isMobile
          ? {
              lowLatencyMode: false,
              liveSyncDuration: 6,
              liveMaxLatencyDuration: 16,
              maxLiveSyncPlaybackRate: 1.2,
            }
          : {
              lowLatencyMode: true,
              // Target ~3s behind live; if playback ever drifts more than 10s
              // behind (early stall, background tab, hiccup), hls.js
              // force-seeks back to the live edge instead of replaying old
              // buffer forever.
              liveSyncDuration: 3,
              liveMaxLatencyDuration: 10,
              maxLiveSyncPlaybackRate: 1.5,
            };
        hls = new Hls({
          ...tuning,
          xhrSetup: (xhr, url) => {
            xhr.open("GET", url, true);
            if (auth) xhr.setRequestHeader("Authorization", auth);
          },
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Surface real problems (any HTTP error, or a fatal) — but ignore
          // benign non-fatal blips (e.g. buffer stalls) that self-recover.
          if (data.fatal || data.response?.code) {
            const desc = describeError(data);
            if (desc.code !== lastErrCode) {
              lastErrCode = desc.code;
              setErrorInfo(desc);
            }
          }
          if (!data.fatal || !hls) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          teardown();
          scheduleRestart();
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          retries = 0;
          setStatus("live");
          lastErrCode = null;
          setErrorInfo(null);
        });
        // Ping = time-to-first-byte of each segment fetch, smoothed (EMA) so the
        // meter doesn't jitter. A game-style network-health readout in ms.
        hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
          const load = data.frag.stats.loading;
          const ttfb = load.first - load.start;
          if (!Number.isFinite(ttfb) || ttfb < 0) return;
          setPingMs((prev) =>
            prev === null ? Math.round(ttfb) : Math.round(prev * 0.6 + ttfb * 0.4)
          );
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari — native HLS can't attach custom headers; the 401 challenge
        // triggers Safari's built-in login prompt (enter the read user/pass once)
        video.src = src;
        const onPlaying = () => {
          retries = 0;
          setStatus("live");
          setErrorInfo(null);
          // Native HLS (Safari) doesn't expose per-fragment fetch stats, so the
          // ping meter stays hidden here.
        };
        const onError = () => {
          setErrorInfo({ code: "SRC", hint: "Gagal memuat stream — cek koneksi/kredensial" });
          scheduleRestart();
        };
        video.addEventListener("playing", onPlaying);
        video.addEventListener("error", onError);
      }

      void video.play().catch(() => {
        /* autoplay is allowed because the video is muted */
      });
    };

    // Stale watchdog — hls.js can sit "connected" on a frozen live edge
    let lastTime = -1;
    let stalledSince: number | null = null;
    const watchdog = setInterval(() => {
      if (disposed) return;
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        stalledSince = null;
        return;
      }
      stalledSince = stalledSince ?? Date.now();
      if (Date.now() - stalledSince >= STALE_AFTER_MS) {
        stalledSince = null;
        teardown();
        scheduleRestart();
      }
    }, WATCHDOG_INTERVAL_MS);

    // Background tabs are throttled and fall behind live; snap back to the
    // live edge the moment the wall becomes visible again.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !hls) return;
      const livePos = hls.liveSyncPosition;
      if (livePos != null && livePos - video.currentTime > 5) {
        video.currentTime = livePos;
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    setStatus("connecting");
    start();

    return () => {
      disposed = true;
      clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      if (restartTimer) clearTimeout(restartTimer);
      teardown();
      video.removeAttribute("src");
    };
    // Restart the whole pipeline when the stream target or tuning changes,
    // or when the user hits "Segarkan Stream" (reconnectNonce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stream?.id,
    stream?.hls_url,
    stream?.read_user,
    stream?.read_pass,
    isMobile,
    reconnectNonce,
  ]);

  if (!stream) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/90 text-text-inv">
        <VideoOff className="size-6 opacity-60" />
        <span className="text-[12px] opacity-80">
          Stream tidak ditemukan — hubungi admin
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        muted={config.muted}
        autoPlay
        playsInline
        className={cn(
          "h-full w-full",
          config.object_fit === "cover" ? "object-cover" : "object-contain"
        )}
      />

      {/* Network ping meter (ms) — green normal, kuning bila > 70ms, merah bila parah */}
      {status === "live" && pingMs !== null && <PingBadge ms={pingMs} />}

      {/* Reconnect / connecting overlay — never a silent black box, and always
          show a diagnostic code + cause when something is wrong. */}
      {status !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-4 text-center">
          <Loader2 className="size-6 animate-spin text-amber-400" />
          <span className="text-[12px] font-medium text-white">
            {status === "connecting"
              ? "Menghubungkan ke stream…"
              : "Stream terputus — menyambung ulang…"}
          </span>
          {errorInfo && (
            <span className="flex flex-col items-center gap-1">
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                {errorInfo.code}
              </span>
              <span className="text-[11px] text-white/70">{errorInfo.hint}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Game-style ping readout: just the number, colored by health.
 *  < 70ms hijau · 70–120ms kuning · > 120ms merah. */
function PingBadge({ ms }: { ms: number }) {
  const textColor =
    ms < 70 ? "text-green-400" : ms <= 120 ? "text-amber-300" : "text-red-400";
  const dotColor =
    ms < 70 ? "bg-green-500" : ms <= 120 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5">
      <span className={cn("size-1.5 rounded-full", dotColor)} />
      <span className={cn("text-[10px] font-bold tabular-nums", textColor)}>{ms}ms</span>
    </div>
  );
}
