import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { readText, writable, writeFile } from './safe-files.js';
import { NOTES_FILE } from './projects.js';
import { pacificDay } from './youtube-quota.js';

export function versionFolder(piece: string, source: string): string {
  if (!piece || !source) throw new Error('Choose a packaging version.');
  const parent = safeResolve('projects', path.join(piece, 'Packaging'));
  const from = writable(safeResolve('projects', source));
  if (path.dirname(from).toLowerCase() !== parent.toLowerCase() || !/^(?:V\d+.*|Legacy)$/i.test(path.basename(from))) throw new Error('Choose a version in this video’s Packaging folder.');
  const stat = fs.lstatSync(from);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The version must be a real folder.');
  return from;
}

/** Move a version to a unique recoverable folder in HeartQuarters Trash. */
export function trashPackagingVersion(piece: string, source: string): { trashPath: string } {
  const from = versionFolder(piece, source);
  if (!config.trashDir) throw new Error('No trash folder is set in config.json. Nothing was changed.');
  fs.mkdirSync(config.trashDir, { recursive: true });
  const holder = fs.mkdtempSync(path.join(config.trashDir, 'Packaging-'));
  const to = path.join(holder, path.basename(from));
  fs.renameSync(from, to);
  return { trashPath: to };
}

/** The next version's name: one more than the highest V number there, V01 if there's none. Never a name with words. */
export function nextVersionName(piece: string): string {
  const parent = safeResolve('projects', path.join(piece, 'Packaging'));
  const numbers = fs.existsSync(parent) ? fs.readdirSync(parent).map((d) => Number(/^V(\d+)$/i.exec(d)?.[1] ?? 0)) : [];
  return `V${String(Math.max(0, ...numbers) + 1).padStart(2, '0')}`;
}

/** Create the first packaging version when no version exists. */
export function createFirstPackagingVersion(piece: string): { name: string; path: string } {
  if (!piece) throw new Error('Choose a video.');
  const pieceDir = writable(safeResolve('projects', piece));
  if (!fs.statSync(pieceDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error('The video folder is not available.');
  const parent = writable(safeResolve('projects', path.join(piece, 'Packaging')));
  fs.mkdirSync(parent, { recursive: true });
  if (fs.lstatSync(parent).isSymbolicLink() || fs.readdirSync(parent).some(n => /^(?:V\d+|Legacy)/i.test(n))) throw new Error('A packaging version already exists or the folder is a shortcut.');
  const folder = writable(safeResolve('projects', path.join(piece, 'Packaging', 'V01'))); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'YouTube.md'), '# YouTube Info\n\nTitle:\n\nDescription:\n\nTags:\n\nPinned Comment:\n', { flag: 'wx' });
  return { name: 'V01', path: path.relative(safeResolve('projects', ''), folder).split(path.sep).join('/') };
}

const NOT_YET = 'On YouTube: not yet.';

/** Record what YouTube accepted, even when only part of this version was sent. */
export function recordYoutubePackaging(piece: string, version: string, fields: string[], when = new Date()): void {
  const folder = versionFolder(piece, version);
  const name = fs.readdirSync(folder).find((file) => file.toLowerCase() === NOTES_FILE.toLowerCase()) ?? NOTES_FILE;
  const file = writable(path.join(folder, name));
  const notes = fs.existsSync(file) ? readText(file) : '';
  const eol = notes.includes('\r\n') ? '\r\n' : '\n';
  const entry = `On YouTube: ${pacificDay(when)} (sent ${fields.join(', ')}).`;
  const placeholder = /^(\uFEFF?)On YouTube: not yet\.[ \t]*$/im;
  const next = placeholder.test(notes)
    ? notes.replace(placeholder, (_match, bom: string) => bom + entry)
    : `${notes}${notes && !notes.endsWith('\n') ? eol : ''}${entry}${eol}`;
  writeFile(file, next);
}

/**
 * A copied version starts with one "On YouTube: not yet." line. Its source's publication history stays with the source.
 */
export function notYetOnYoutube(notes: string): string {
  const eol = notes.includes('\r\n') ? '\r\n' : '\n';
  let first = true;
  if (/^\uFEFF?On YouTube:/im.test(notes)) return notes.replace(/^(\uFEFF?)On YouTube:[^\r\n]*(\r?\n|$)/gim, (_match, bom: string, ending: string) => {
    if (!first) return '';
    first = false;
    return bom + NOT_YET + ending;
  });
  if (!notes.trim()) return `${NOT_YET}${eol}`;
  return `${notes.replace(/\s+$/, '')}${eol}${eol}${NOT_YET}${eol}`;
}

/**
 * Create an independent copy of one packaging version, as the next version (V01, V02...); never replace a file.
 * The copy's Notes.md says it isn't on YouTube yet (see notYetOnYoutube).
 */
export async function copyPackagingVersion(piece: string, source: string): Promise<{ name: string; path: string }> {
  if (!piece || !source) throw new Error('Choose a packaging version to copy.');
  const name = nextVersionName(piece);
  const parent = safeResolve('projects', path.join(piece, 'Packaging'));
  const from = writable(safeResolve('projects', source));
  if (path.dirname(from).toLowerCase() !== parent.toLowerCase() || !/^(?:V\d+|Legacy)/i.test(path.basename(from))) throw new Error('Choose a version in this video’s Packaging folder.');
  const to = writable(safeResolve('projects', path.join(piece, 'Packaging', name)));
  if (!(await fs.promises.lstat(from)).isDirectory()) throw new Error('The source version is not a folder.');
  // Never follow a shortcut out of the source tree, including nested shortcuts.
  const inspect = async (dir: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name); const stat = await fs.promises.lstat(full);
      if (stat.isSymbolicLink()) throw new Error('This version contains a shortcut or junction. Copy it manually instead.');
      if (stat.isDirectory()) await inspect(full);
      else if (!stat.isFile()) throw new Error('This version contains an unsupported item.');
    }
  };
  await inspect(from);
  try { await fs.promises.mkdir(to); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`A version named "${name}" already exists. Nothing was overwritten.`); throw e; }
  const copy = async (src: string, dst: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
      const a = path.join(src, entry.name); const b = path.join(dst, entry.name);
      const stat = await fs.promises.lstat(a);
      if (stat.isSymbolicLink()) throw new Error('A shortcut appeared in the source folder.');
      if (stat.isDirectory()) { await fs.promises.mkdir(b); await copy(a, b); }
      else if (stat.isFile()) await fs.promises.copyFile(a, b, fs.constants.COPYFILE_EXCL);
      else throw new Error('The source contains an unsupported item.');
    }
  };
  try { await copy(from, to); }
  catch (e) { throw new Error(`The copy stopped. The new folder "${name}" may be incomplete; check it before using it. ${e instanceof Error ? e.message : String(e)}`); }
  const notesFile = (await fs.promises.readdir(to)).find((f) => f.toLowerCase() === 'notes.md') ?? 'Notes.md';
  const notesPath = path.join(to, notesFile);
  const notes = fs.existsSync(notesPath) ? await fs.promises.readFile(notesPath, 'utf8') : '';
  await fs.promises.writeFile(notesPath, notYetOnYoutube(notes));
  return { name, path: path.relative(safeResolve('projects', ''), to).split(path.sep).join('/') };
}
