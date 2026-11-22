import fs from 'node:fs';
import path from 'node:path';
import { appDir, isInside, rootDir } from './config.js';
import { writeFileSafely } from './files.js';
import { readText, writeFile } from './safe-files.js';

// Both lists live in the Expressions library in Drive, next to Expression Shot List.json, so they are backed up
// and survive a deleted data folder. (They used to be in data/; the first read copies the old file across.)
export const STARRED_FILE = 'Expression Starred Photos.json';
export const LIKENESS_FILE = 'Expression Reference Photos.json';
const LEGACY = { [STARRED_FILE]: 'expression-references.json', [LIKENESS_FILE]: 'likeness-references.json' };

const location = () => process.env.HQ_EXPRESSION_REFS_FILE ?? path.join(rootDir('expressions'), STARRED_FILE);
const inLibrary = (file: string) => isInside(path.resolve(rootDir('expressions')), path.resolve(file));
function readJson(file: string): unknown { return JSON.parse(inLibrary(file) ? readText(file, 'expressions') : fs.readFileSync(file, 'utf8')); }
/** `create` makes a new file and fails with EEXIST if there already is one; otherwise the file is replaced. */
function writeJson(file: string, value: unknown, create: boolean): void {
  const text = JSON.stringify(value, null, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (inLibrary(file)) writeFile(file, text, create ? { flag: 'wx' } : undefined, 'expressions');
  else if (create) fs.writeFileSync(file, text, { flag: 'wx' });
  else writeFileSafely(file, text);
}

/** Copy a list from the old data folder into Drive, once. Never replaces a file that is already in Drive. */
export function migrateReferenceFiles(): number {
  if (process.env.HQ_EXPRESSION_REFS_FILE) return 0; // a test or custom location: nothing to move
  let copied = 0;
  for (const [name, legacy] of Object.entries(LEGACY)) {
    const from = path.join(process.env.HQ_LEGACY_DATA_DIR ?? path.join(appDir, 'data'), legacy);
    if (!fs.existsSync(from) || fs.existsSync(path.join(rootDir('expressions'), name))) continue;
    try { writeJson(path.join(rootDir('expressions'), name), validate(JSON.parse(fs.readFileSync(from, 'utf8'))), true); copied++; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  return copied;
}

function validate(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some((p) => typeof p !== 'string' || !p || p.length > 1000 || p.includes('\\') || p.includes(':') || p.split('/').some((s: string) => !s || s === '.' || s === '..'))) throw new Error('Invalid reference photo list.');
  return [...new Set(value as string[])];
}
export function readExpressionReferences(): { initialized: boolean; paths: string[] } {
  migrateReferenceFiles();
  try { return { initialized: true, paths: validate(readJson(location())) }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { initialized: false, paths: [] }; throw e; }
}
export function saveExpressionReferences(value: unknown, initialize: boolean): { initialized: boolean; paths: string[] } {
  const paths = validate(value); const file = location();
  if (initialize) {
    try { writeJson(file, paths, true); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    return readExpressionReferences();
  }
  writeJson(file, paths, false);
  return { initialized: true, paths };
}

// ---- Reference Photos: the photos that show the AI what John looks like ------------------------------
// A separate list from the stars above (stars are favourites for thumbnails). The first time it is read it
// starts as a copy of the starred photos, so AI generation keeps working; after that the two never mix.

// Kept next to the starred list, so anything that moves that list (tests included) moves this one too.
const likenessLocation = () => process.env.HQ_LIKENESS_REFS_FILE ?? path.join(path.dirname(location()), LIKENESS_FILE);

export function readLikenessReferences(): string[] {
  migrateReferenceFiles();
  const file = likenessLocation();
  try { return validate(readJson(file)); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const copy = readExpressionReferences().paths;
    try { writeJson(file, copy, true); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; return readLikenessReferences(); }
    return copy;
  }
}

export function saveLikenessReferences(value: unknown): string[] {
  readLikenessReferences(); // make sure the one-time copy happened first
  const paths = validate(value);
  writeJson(likenessLocation(), paths, false);
  return paths;
}
