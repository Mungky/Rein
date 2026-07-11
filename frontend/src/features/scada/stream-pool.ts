/** Shared stream decoder pool — one hidden <video> per distinct stream, no
 *  matter how many channels crop from it. Nine crops of one OBS mosaic cost
 *  ONE decode + ONE download, exactly like the old Video Wall. Ref-counted:
 *  the decoder tears down when the last user releases it. */

import type { Stream } from "./types";
import { attachPlayback, type PlaybackHandle } from "./playback";

interface Entry {
  video: HTMLVideoElement;
  handle: PlaybackHandle;
  refs: number;
  sig: string;
}

const entries = new Map<string, Entry>();
let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(host);
  }
  return host;
}

/** Borrow the shared decoder for a stream. ALWAYS call release() on cleanup.
 *  `nonce` = streamReconnectNonce; bumping it rebuilds the connection. */
export function acquireStreamVideo(
  stream: Stream,
  nonce: number
): { video: HTMLVideoElement; release: () => void } {
  const sig = `${stream.hls_url}|${stream.webrtc_url}|${stream.read_user}|${stream.read_pass}|${nonce}`;
  let entry = entries.get(stream.id);
  if (entry && entry.sig !== sig) {
    // URL/creds rotated or manual reconnect — rebuild for everyone.
    entry.handle.destroy();
    entry.video.remove();
    entries.delete(stream.id);
    entry = undefined;
  }
  if (!entry) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    ensureHost().appendChild(video);
    const handle = attachPlayback(video, stream);
    entry = { video, handle, refs: 0, sig };
    entries.set(stream.id, entry);
  }
  entry.refs += 1;
  const mine = entry;
  let released = false;
  return {
    video: mine.video,
    release: () => {
      if (released) return;
      released = true;
      mine.refs -= 1;
      if (mine.refs <= 0) {
        mine.handle.destroy();
        mine.video.remove();
        entries.delete(stream.id);
      }
    },
  };
}
