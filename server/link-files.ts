// A video's YouTube address, kept in its own Drive folder as "YouTube Link.txt" (one line, like Longform URL.txt).
// This is the lasting record of which YouTube video a piece is; the upload records in data/ are rebuilt from it.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { readText, writeFile } from './safe-files.js';
import { youtubeVideoId } from './youtube-video.js';

export const LINK_FILE = 'YouTube Link.txt';

function linkFile(piece: string): string | null {
  const folder = safeResolve('projects', piece);
  try { if (!fs.statSync(folder).isDirectory()) return null; } catch { return null; }
  return path.join(folder, LINK_FILE);
}

/** The YouTube video id saved for this piece, or null when there is no file or it holds no usable address. */
export function linkFileVideoId(piece: string): string | null {
  const file = linkFile(piece);
  if (!file) return null;
  try { return youtubeVideoId(readText(file).trim()); } catch { return null; }
}

/**
 * Save the address. With `overwrite` false an existing file is left exactly as it is (used when filling in old videos);
 * with true it is replaced (used when you link or upload a video, so the file follows your latest choice).
 * Returns 'skipped' when the piece folder doesn't exist.
 */
export function saveLinkFile(piece: string, videoId: string, overwrite: boolean): 'written' | 'exists' | 'skipped' {
  const file = linkFile(piece);
  if (!file) return 'skipped';
  const id = youtubeVideoId(videoId);
  if (!overwrite && fs.existsSync(file)) return 'exists';
  writeFile(file, `https://www.youtube.com/watch?v=${id}\n`);
  return 'written';
}
