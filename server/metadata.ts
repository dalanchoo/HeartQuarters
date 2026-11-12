// Saving a packaging file (YouTube.md etc.) changed on the page. The page sends the whole new text, plus the text it
// started from, so a change made elsewhere meanwhile (John in Notepad++, or Claude) is never silently overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { writeFileSafely } from './files.js';
import { NOTES_FILE } from './projects.js';

/**
 * The Notes box of a packaging version: saves its Notes.md, making it if the version has none yet. Like the other
 * files, it only saves if the file still says "was" ("" for a file that doesn't exist yet).
 */
export function saveVersionNotes(version: string, text: unknown, was: unknown) {
  if (typeof text !== 'string' || typeof was !== 'string') throw new Error('Nothing to save.');
  const dir = safeResolve('projects', version);
  const parts = dir.split(path.sep);
  // Only a version folder straight inside a Packaging folder: Packaging\V01.
  if (parts.at(-2) !== 'Packaging' || !/^(V\d+.*|Legacy)$/i.test(parts.at(-1) ?? '') || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("That isn't a packaging version folder.");
  }
  const file = path.join(dir, NOTES_FILE);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
  if (current !== was) throw new Error('These notes changed since the page loaded them, so nothing was saved. Reload the page and try again.');
  writeFileSafely(file, text);
}

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
  writeFileSafely(full, text);
}
