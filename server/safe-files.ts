// Shared checks for files inside John's folders, so no feature has to remember them on its own (code review,
// 2026-11-18). safeResolve checks one path; these make sure every path a feature builds inside a checked folder is
// checked too, right before it's used:
//   readable(...)  the path really ends up inside the folder, after following any shortcut or junction;
//   writable(...)  the same, and nothing on the way is a shortcut or junction at all, so a move, a new folder or a write
//                  can never land somewhere else.
// The small wrappers below check and then act.
import fs from 'node:fs';
import path from 'node:path';
import { isInside, rootDir, safeResolve, type RootId } from './config.js';

/** `full` (an absolute path) checked to lie inside `root`, after following any links. Throws if it doesn't. */
export function readable(full: string, root: RootId = 'projects'): string {
  const base = path.resolve(rootDir(root));
  const target = path.resolve(full);
  if (!isInside(base, target)) throw new Error('That path is outside the allowed folder.');
  return safeResolve(root, path.relative(base, target));
}

/**
 * `full` checked to lie inside `root`, with no shortcut or junction anywhere from the folder down to it (the parts that
 * exist yet). Use it before writing, moving or creating anything.
 */
export function writable(full: string, root: RootId = 'projects'): string {
  const target = readable(full, root);
  const base = path.resolve(rootDir(root));
  let at = base;
  for (const part of path.relative(base, target).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(at);
    } catch {
      break; // the rest doesn't exist yet
    }
    if (stat.isSymbolicLink()) throw new Error(`"${path.relative(base, at)}" is a shortcut or junction, so HeartQuarters won't change anything through it.`);
  }
  return target;
}

export function readText(full: string, root: RootId = 'projects'): string {
  return fs.readFileSync(readable(full, root), 'utf8');
}

export function writeFile(full: string, data: string | Uint8Array, options?: fs.WriteFileOptions): void {
  fs.writeFileSync(writable(full), data, options);
}

export function appendText(full: string, data: string): void {
  fs.appendFileSync(writable(full), data);
}

/** Creates a folder (and any missing parents), then checks again that it's a real folder. */
export function makeFolder(full: string): string {
  fs.mkdirSync(writable(full), { recursive: true });
  return writable(full);
}

export function moveFile(from: string, to: string): void {
  fs.renameSync(writable(from), writable(to));
}

/** Copies a file from any allowed folder (`fromRoot`) into the Video Projects folder, never over an existing file. */
export function copyNewFile(from: string, to: string, fromRoot: RootId = 'projects'): void {
  const source = readable(from, fromRoot);
  const target = writable(to);
  if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}
