/** Channel addressing for the Video Wall.
 *
 *  A "channel" is one cell of a stream's mosaic. Each stream owns a contiguous
 *  range of global channel numbers starting at `channel_start`:
 *    stream A (3×3, start 1)  → channels 1..9   (cell 0..8, row-major)
 *    stream B (2×2, start 10) → channels 10..13 (cell 0..3)
 *  A 1×1 stream is a single channel = the whole frame.
 *
 *  The wall stores resolved {stream_id, cell} per display cell (robust against
 *  later renumbering); the number is just a friendly way to pick one.
 */

import type { Stream, WallCell } from "./types";

export interface Channel {
  number: number;
  stream_id: string;
  cell: number; // 0-based, row-major, within the stream's mosaic
  row: number;
  col: number;
  streamName: string;
  label: string; // e.g. "Line Tanobel · kotak 5"
}

export function mosaicCellCount(stream: Stream): number {
  return Math.max(1, stream.mosaic_rows) * Math.max(1, stream.mosaic_cols);
}

/** All channels across the given streams, sorted by channel number. */
export function listChannels(streams: Stream[]): Channel[] {
  const out: Channel[] = [];
  for (const s of streams) {
    const rows = Math.max(1, s.mosaic_rows);
    const cols = Math.max(1, s.mosaic_cols);
    const base = Math.max(1, s.channel_start);
    const count = rows * cols;
    for (let i = 0; i < count; i++) {
      out.push({
        number: base + i,
        stream_id: s.id,
        cell: i,
        row: Math.floor(i / cols),
        col: i % cols,
        streamName: s.name,
        label: count === 1 ? s.name : `${s.name} · kotak ${i + 1}`,
      });
    }
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Resolve a global channel number to its stream+cell, or undefined. */
export function findChannelByNumber(
  streams: Stream[],
  number: number
): Channel | undefined {
  return listChannels(streams).find((c) => c.number === number);
}

/** The global channel number for a stored {stream_id, cell}, or null. */
export function channelNumberOf(
  streams: Stream[],
  ref: WallCell | null
): number | null {
  if (!ref) return null;
  const s = streams.find((st) => st.id === ref.stream_id);
  if (!s) return null;
  return Math.max(1, s.channel_start) + ref.cell;
}
