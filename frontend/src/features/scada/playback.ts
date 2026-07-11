/** Unified playback: WebRTC (WHEP, sub-second) with automatic LL-HLS
 *  fallback. A stream opts in by having `webrtc_url` set (MediaMTX /whep
 *  endpoint). Viewers whose networks block UDP — or any WHEP failure/drop —
 *  silently land on HLS, so turning WebRTC on can never make things worse. */

import type { Stream } from "./types";
import { attachHls, type HlsHandle } from "./panels/hls-attach";

export type PlaybackMode = "webrtc" | "hls";

export interface PlaybackHandle {
  destroy: () => void;
}

function basicAuth(stream: Stream): string | null {
  if (!stream.read_user) return null;
  return "Basic " + btoa(`${stream.read_user}:${stream.read_pass ?? ""}`);
}

/** One WHEP session. Resolves once media is actually flowing; rejects on any
 *  setup failure. `onDrop` fires if the connection dies LATER. */
async function whepConnect(
  video: HTMLVideoElement,
  url: string,
  auth: string | null,
  onDrop: () => void
): Promise<() => void> {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const media = new MediaStream();
  pc.ontrack = (e) => {
    media.addTrack(e.track);
    if (video.srcObject !== media) {
      video.srcObject = media;
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => {});
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Non-trickle: wait for ICE gathering (cap at 2 s) then send one offer.
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = setTimeout(resolve, 2000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    };
  });

  const headers: Record<string, string> = { "Content-Type": "application/sdp" };
  if (auth) headers.Authorization = auth;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: pc.localDescription?.sdp ?? "",
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`WHEP ${res.status}`);
  }
  const location = res.headers.get("Location");
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });

  // Wait until actually connected (6 s budget), then arm the drop watcher.
  await new Promise<void>((resolve, reject) => {
    const fail = () => {
      pc.close();
      reject(new Error("WHEP connect failed"));
    };
    if (pc.connectionState === "connected") return resolve();
    const t = setTimeout(fail, 6000);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearTimeout(t);
        resolve();
      } else if (["failed", "closed"].includes(pc.connectionState)) {
        clearTimeout(t);
        fail();
      }
    };
  });

  let stopped = false;
  pc.onconnectionstatechange = () => {
    if (!stopped && ["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      onDrop();
    }
  };

  return () => {
    stopped = true;
    pc.close();
    if (video.srcObject === media) video.srcObject = null;
    if (location) {
      // Politely free the server-side session.
      fetch(new URL(location, url).toString(), {
        method: "DELETE",
        headers: auth ? { Authorization: auth } : undefined,
      }).catch(() => {});
    }
  };
}

/** Attach a stream to a <video>: WHEP first (when configured), HLS otherwise
 *  or on any WebRTC failure. Same handle shape as attachHls. */
export function attachPlayback(
  video: HTMLVideoElement,
  stream: Stream,
  opts: {
    onLive?: (live: boolean) => void;
    onMode?: (mode: PlaybackMode) => void;
  } = {}
): PlaybackHandle {
  const { onLive, onMode } = opts;
  let disposed = false;
  let stopWhep: (() => void) | null = null;
  let hls: HlsHandle | null = null;

  const startHls = () => {
    if (disposed || hls) return;
    onMode?.("hls");
    hls = attachHls(video, stream, onLive);
  };

  if (stream.webrtc_url && typeof RTCPeerConnection !== "undefined") {
    onLive?.(false);
    whepConnect(video, stream.webrtc_url, basicAuth(stream), () => {
      // Dropped after connecting — degrade to HLS instead of dying.
      stopWhep?.();
      stopWhep = null;
      if (!disposed) {
        onLive?.(false);
        startHls();
      }
    })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        stopWhep = stop;
        onMode?.("webrtc");
        onLive?.(true);
      })
      .catch(() => startHls());
  } else {
    startHls();
  }

  return {
    destroy: () => {
      disposed = true;
      stopWhep?.();
      stopWhep = null;
      hls?.destroy();
      hls = null;
    },
  };
}
