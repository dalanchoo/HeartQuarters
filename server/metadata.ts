// Saving a packaging file (YouTube.md etc.) changed on the page. The page sends the whole new text, plus the text it
// started from, so a change made elsewhere meanwhile (John in Notepad++, or Claude) is never silently overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';

export function savePackagingText(file: string, text: unknown, was: unknown) {
  if (typeof text !== 'string' || typeof was !== 'string') throw new Error('Nothing to save.');
  const full = safeResolve('projects', file);
  // Only text files inside a Packaging folder, whatever the page asks for.
  if (!full.split(path.sep).includes('Packaging') || path.extname(full).toLowerCase() !== '.md') {
    throw new Error("That isn't a packaging file.");
  }
  if (!fs.existsSync(full)) throw new Error('That file no longer exists. Reload the page.');
  // A browser drops the invisible mark some Windows editors put at the start of a file, so it doesn't count.
  const current = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  if (current !== was) throw new Error('This file changed since the page loaded it, so nothing was saved. Reload the page and try again.');
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, full); // all or nothing: a crash can't leave half a file
}
