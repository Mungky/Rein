/** Attach an HLS stream to a <video> element with the same resilience the
 *  single VideoPanel uses (auth header, fatal-error retry with backoff, media
 *  recovery). Kept standalone so the Video Wall can drive several videos at
 *  once — one decoder per distinct mosaic stream — without duplicating logic. */

import Hls from "hls.js";
import type { Stream } from "../types";

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 15000;

export interface HlsHandle {
  destroy: () => void;
}

function basicAuthHeader(stream: Stream): string | null {
  if (!stream.read_user) return null;
  return "Basic " + btoa(`${stream.read_user}:${stream.read_pass ?? ""}`);
}

export function attachHls(
  video: HTMLVideoElement,
  stream: Stream,
  onLive?: (live: boolean) => void
): HlsHandle {
  let hls: Hls | null = null;
  let retries = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const auth = basicAuthHeader(stream);

  const scheduleRestart = () => {
    if (disposed) return;
    onLive?.(false);
    const delay = Math.min(RETRY_BASE_MS * 2 ** retries, RETRY_MAX_MS);
    retries += 1;
    timer = setTimeout(start, delay);
  };

  const teardown = () => {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  };

  function start() {
    if (disposed) return;
    teardown();
    const src = stream.hls_url;

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDuration: 3,
        liveMaxLatencyDuration: 10,
        maxLiveSyncPlaybackRate: 1.5,
        xhrSetup: (xhr, url) => {
          xhr.open("GET", url, true);
          if (auth) xhr.setRequestHeader("Authorization", auth);
        },
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
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
        onLive?.(true);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari — native HLS (Basic-auth challenge prompts once)
      video.src = src;
      video.addEventListener("playing", () => {
        retries = 0;
        onLive?.(true);
      });
      video.addEventListener("error", scheduleRestart);
    }

    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => {
      /* autoplay allowed because muted */
    });
  }

  start();

  return {
    destroy: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      teardown();
      video.removeAttribute("src");
    },
  };
}
