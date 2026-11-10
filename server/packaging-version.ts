import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { checkFolderName } from './create.js';

/** Create an independent copy of one packaging version; never replace an existing file. */
export async function copyPackagingVersion(piece: string, source: string, requestedName: unknown): Promise<{ name: string; path: string }> {
  if (!piece || !source) throw new Error('Choose a packaging version to copy.');
  const name = checkFolderName(requestedName);
  if (!/^V\d+(?:[ _-].*)?$/i.test(name)) throw new Error('Use a version name such as V02 or V02 - Alternative.');
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
  return { name, path: path.relative(safeResolve('projects', ''), to).split(path.sep).join('/') };
}
