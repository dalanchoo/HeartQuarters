// John's thumbs up / thumbs down on an expression photo, saved in the photo's sidecar (.txt) as one line:
//   # Rating: Liked      # Rating: Meh      # Rating: Disliked
// The line starts with "#", so the tag readers and the AI assessment keep it as it is. Nothing else in the file changes.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { isExpressionPhoto, patchCachedPhoto, RATING_LINE, type ExpressionRating } from './expressions.js';
import { writable, writeFile } from './safe-files.js';

/** Sets the rating, or removes it when `rating` is null. */
export function setExpressionRating(photoPath: string, rating: unknown): void {
  if (rating !== null && rating !== 'liked' && rating !== 'meh' && rating !== 'disliked') throw new Error('Choose Like, Meh, Dislike or no rating.');
  if (!isExpressionPhoto(photoPath)) throw new Error('That expression photo is no longer available.');
  const sidecar = writable(safeResolve('expressions', photoPath.slice(0, -path.extname(photoPath).length) + '.txt'), 'expressions');
  let text = '';
  try {
    if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
    text = fs.readFileSync(sidecar, 'utf8');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const kept = text.split(/(?<=\n)/).filter(line => line && !RATING_LINE.test(line.trim()));
  let updated = kept.join('');
  if (rating) updated += (updated && !updated.endsWith('\n') ? newline : '') + `# Rating: ${label(rating)}${newline}`;
  if (updated === text) return;
  if (!text && !updated) return;
  writeFile(sidecar, updated, undefined, 'expressions');
  // Only this photo's rating changed, so the kept library list is updated rather than re-read from Drive.
  patchCachedPhoto(photoPath, photo => { const { rating: _old, ...rest } = photo; return rating ? { ...rest, rating } : rest; });
}

function label(rating: ExpressionRating): string { return rating === 'liked' ? 'Liked' : rating === 'meh' ? 'Meh' : 'Disliked'; }
