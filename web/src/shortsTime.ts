// Small helpers for the shorts list. Times are stored as seconds, shown and typed as minutes:seconds.

/** 83.4 -> "1:23.4" */
export function showTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** "1:23.4", "1:23" or "83.4" -> seconds. Null if it isn't a time. */
export function parseTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  if (m[1] !== undefined && Number(m[2]) >= 60) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

/** The next free short number after the ones in the list: S01, S02 -> "S03". */
export function nextShortId(ids: string[]): string {
  const top = Math.max(0, ...ids.map((id) => Number(id.slice(1)) || 0));
  return `S${String(top + 1).padStart(2, '0')}`;
}

type Word = { start: number; end: number; word: string };

/** Whether a word belongs to a clip: its middle falls inside, so a word cut in half counts once. */
export function wordInClip(w: Word, start: number, end: number): boolean {
  const middle = (w.start + w.end) / 2;
  return middle >= start && middle < end;
}

/**
 * Which word is being said at a moment in the video, or -1 during a real pause. A word stays lit for a moment
 * after it ends, so the highlight doesn't flicker in the tiny gaps between words.
 */
export function wordAt(words: Word[], time: number): number {
  let low = 0;
  let high = words.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (words[middle].start <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found >= 0 && time <= words[found].end + 0.3 ? found : -1;
}

/** The clip that runs from one word to another, whichever way round they were selected. */
export function rangeOfWords(words: Word[], a: number, b: number): { start: number; end: number } {
  return { start: words[Math.min(a, b)].start, end: words[Math.max(a, b)].end };
}

const SHORTEST_CLIP = 1; // seconds
const SNAP_TO_WORD = 0.25; // seconds

/**
 * Where a dragged trim handle lands. It snaps to the edge of a nearby word, so a clip doesn't begin or end
 * mid-word, and it can't cross the other handle or leave the video. Pass no words to place it exactly.
 */
export function dragEdge(
  edge: 'start' | 'end',
  to: number,
  clip: { start: number; end: number },
  total: number,
  words: Word[] | null,
): { start: number; end: number } {
  let best = to;
  let bestGap = SNAP_TO_WORD;
  for (const w of words ?? []) {
    const gap = Math.abs(w[edge] - to);
    if (gap <= bestGap) {
      best = w[edge];
      bestGap = gap;
    }
  }
  return edge === 'start'
    ? { start: Math.max(0, Math.min(best, clip.end - SHORTEST_CLIP)), end: clip.end }
    : { start: clip.start, end: Math.min(total, Math.max(best, clip.start + SHORTEST_CLIP)) };
}

export type TrimWindow = { from: number; to: number };

/**
 * The stretch of the video the trim bar shows: the clip with room either side, because the whole longform would
 * leave only a few pixels per second. It stays put while the clip fits, so handles don't jump under the mouse,
 * and moves on once a handle comes near its edge.
 */
export function trimWindow(start: number, end: number, total: number, previous?: TrimWindow): TrimWindow {
  const nearEdge = 5; // seconds
  if (
    previous &&
    (previous.from === 0 ? start >= 0 : start - previous.from >= nearEdge) &&
    (previous.to === total ? end <= total : previous.to - end >= nearEdge)
  ) {
    return previous;
  }
  const room = Math.max(30, (end - start) / 2);
  return { from: Math.max(0, start - room), to: Math.min(total, end + room) };
}

/** Moves a row from one list to the other, keeping the destination in the order of the video. */
export function moveRow<T extends { id: string; start: number }>(from: T[], to: T[], id: string): { from: T[]; to: T[] } {
  const row = from.find((r) => r.id === id);
  if (!row) return { from, to };
  return { from: from.filter((r) => r.id !== id), to: [...to, row].sort((a, b) => a.start - b.start) };
}
