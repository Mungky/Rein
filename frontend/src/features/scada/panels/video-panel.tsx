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
import Hls from "hls.js";
import { Loader2, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
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

export function VideoPanel({
  stream,
  config,
}: {
  stream: Stream | undefined;
  config: VideoPanelConfig;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<PlayerStatus>("connecting");
  const isMobile = useIsMobile();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    let hls: Hls | null = null;
    let retries = 0;
    let disposed = false;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;

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
        };
        const onError = () => scheduleRestart();
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
    // Restart the whole pipeline when the stream target or tuning changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.id, stream?.hls_url, stream?.read_user, stream?.read_pass, isMobile]);

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

      {/* Status badge */}
      {status === "live" && (
        <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5">
          <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
          <span className="text-[10px] font-bold tracking-wide text-white">
            LANGSUNG
          </span>
        </div>
      )}

      {/* Reconnect / connecting overlay — never a silent black box */}
      {status !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
          <Loader2 className="size-6 animate-spin text-amber-400" />
          <span className="text-[12px] font-medium text-white">
            {status === "connecting"
              ? "Menghubungkan ke stream…"
              : "Stream terputus — menyambung ulang…"}
          </span>
        </div>
      )}
    </div>
  );
}
