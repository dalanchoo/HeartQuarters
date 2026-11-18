// Comparing a captions file with YouTube's: the words, and when each caption shows. The words alone can match while
// the timing doesn't (YouTube Studio's editor re-times them into long blocks), so both are checked.
import { metadataDiff, type DiffPart } from './metadataDiff';

export interface Cue { start: number; end: number; text: string }

const TIME = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{1,3})/;
const seconds = (h: string, m: string, s: string, ms: string) => +h * 3600 + +m * 60 + +s + +ms.padEnd(3, '0') / 1000;

/** The cues of an .srt or .vtt: when each shows, and its words on one line. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = TIME.exec(lines[i]);
    if (!m) continue;
    const words: string[] = [];
    for (i++; i < lines.length && lines[i].trim(); i++) words.push(lines[i].trim());
    cues.push({ start: seconds(m[1], m[2], m[3], m[4]), end: seconds(m[5], m[6], m[7], m[8]), text: words.join(' ') });
  }
  return cues;
}

/** All the words of a captions file, in order, on one line. */
export function captionText(text: string): string {
  return parseCues(text).map((c) => c.text).join(' ');
}

export interface CaptionComparison {
  same: boolean;
  wordsSame: boolean;
  timingSame: boolean;
  /** Word-by-word highlighting of each side, for showing what changed. */
  left: DiffPart[];
  right: DiffPart[];
}

/** Same means the same captions, one by one: the same words, shown at the same times (within 50 milliseconds). */
export function compareCaptions(left: string, right: string): CaptionComparison {
  const a = parseCues(left);
  const b = parseCues(right);
  const words = metadataDiff('Captions', a.map((c) => c.text).join(' '), b.map((c) => c.text).join(' '));
  const close = (x: number, y: number) => Math.abs(x - y) <= 0.05;
  const timingSame = a.length === b.length && a.every((c, i) => close(c.start, b[i].start) && close(c.end, b[i].end) && c.text === b[i].text);
  return { same: words.same && timingSame, wordsSame: words.same, timingSame, left: words.left, right: words.right };
}
