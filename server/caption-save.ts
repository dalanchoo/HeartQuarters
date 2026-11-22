// Copies the captions YouTube sent for a video down into its Drive folder: Subtitles\<prefix>-captions.txt (plain words) and
// .srt (timed, exactly as sent), named the way John's other captions are ("022-captions.txt", "022_S09-captions.txt",
// "999-2026-01-captions.txt"). This is the "copy from YouTube" half of the Captions row; John chooses it and unlocks the version first.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { makeFolder, writable, writeFile } from './safe-files.js';
import { requirePiece } from './video-profile.js';

const MAX_TEXT = 2 * 1024 * 1024;

/** The number a video is known by: its folder name up to " - ". A longform is named after its project or series part. */
export function captionPrefix(piece: string): string {
  const parts = piece.split('/');
  if (parts.at(-1) === 'Longform') parts.pop();
  const name = parts.at(-1) ?? '';
  const m = /^(999-\d{4}-\d+|\d{3}[A-Z]?_S\d+|\d{3}[A-Z]?)(?=\s*[-–]|\s*$)/.exec(name);
  if (!m) throw new Error(`Can't tell this video's number from the folder name "${name}".`);
  return m[1];
}

/** SRT (or WebVTT) to just the words, joined with spaces, like the other captions .txt files. */
export function captionPlainText(srt: string): string {
  return srt.split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->') && l.trim() !== 'WEBVTT')
    .map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
}

export interface SavedCaptions { written: { name: string; path: string; replaced: boolean }[] }

/** Writes <number>-captions.txt (the words) and <number>-captions.srt (the captions as sent), replacing either if it is already there. */
export function saveYoutubeCaptions(piece: unknown, srt: unknown): SavedCaptions {
  const checked = requirePiece(piece);
  if (typeof srt !== 'string' || !srt.trim() || srt.length > MAX_TEXT) throw new Error('There are no captions to save.');
  const words = captionPlainText(srt);
  if (!words) throw new Error('The captions have no words in them.');
  const prefix = captionPrefix(checked);
  const folder = safeResolve('projects', path.join(checked, 'Subtitles'));
  if (!fs.existsSync(folder)) makeFolder(folder);
  const files: [string, string][] = [[`${prefix}-captions.txt`, `${words}\r\n`], [`${prefix}-captions.srt`, srt]];
  const written: SavedCaptions['written'] = [];
  for (const [name, content] of files) {
    const file = path.join(folder, name);
    writable(file);
    const replaced = fs.existsSync(file);
    writeFile(file, content);
    written.push({ name, path: path.join(checked, 'Subtitles', name).split(path.sep).join('/'), replaced });
  }
  return { written };
}
