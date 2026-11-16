import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';

export function versionFolder(piece: string, source: string): string {
  if (!piece || !source) throw new Error('Choose a packaging version.');
  const parent = safeResolve('projects', path.join(piece, 'Packaging'));
  const from = safeResolve('projects', source);
  if (path.dirname(from).toLowerCase() !== parent.toLowerCase() || !/^(?:V\d+.*|Legacy)$/i.test(path.basename(from))) throw new Error('Choose a version in this video’s Packaging folder.');
  const stat = fs.lstatSync(from);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The version must be a real folder.');
  return from;
}

/** Move a version to a unique recoverable folder in HeartQuarters Trash. */
export function trashPackagingVersion(piece: string, source: string): { trashPath: string } {
  const from = versionFolder(piece, source);
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
  const pieceDir = safeResolve('projects', piece);
  if (!fs.statSync(pieceDir, { throwIfNoEntry: false })?.isDirectory()) throw new Error('The video folder is not available.');
  const parent = safeResolve('projects', path.join(piece, 'Packaging'));
  fs.mkdirSync(parent, { recursive: true });
  if (fs.lstatSync(parent).isSymbolicLink() || fs.readdirSync(parent).some(n => /^(?:V\d+|Legacy)/i.test(n))) throw new Error('A packaging version already exists or the folder is a shortcut.');
  const folder = safeResolve('projects', path.join(piece, 'Packaging', 'V01')); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'YouTube.md'), '# YouTube Info\n\nTitle:\n\nDescription:\n\nTags:\n\nPinned Comment:\n', { flag: 'wx' });
  return { name: 'V01', path: path.relative(safeResolve('projects', ''), folder).split(path.sep).join('/') };
}

const NOT_YET = 'On YouTube: not yet.';

/**
 * A copied version isn't on YouTube yet, whatever its source's Notes.md said: each "On YouTube: ..." line becomes
 * "On YouTube: not yet.", and the line is added when there was none. Everything else, and the line endings, stay.
 */
export function notYetOnYoutube(notes: string): string {
  const eol = notes.includes('\r\n') ? '\r\n' : '\n';
  if (/^On YouTube:.*$/im.test(notes)) return notes.replace(/^On YouTube:[^\r\n]*/gim, NOT_YET);
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
  const from = safeResolve('projects', source);
  if (path.dirname(from).toLowerCase() !== parent.toLowerCase() || !/^(?:V\d+|Legacy)/i.test(path.basename(from))) throw new Error('Choose a version in this video’s Packaging folder.');
  const to = safeResolve('projects', path.join(piece, 'Packaging', name));
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
