import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './config.js';
import { writeFileSafely } from './files.js';

const location = () => process.env.HQ_EXPRESSION_REFS_FILE ?? path.join(appDir, 'data', 'expression-references.json');
function validate(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some((p) => typeof p !== 'string' || !p || p.length > 1000 || p.includes('\\') || p.includes(':') || p.split('/').some((s: string) => !s || s === '.' || s === '..'))) throw new Error('Invalid reference photo list.');
  return [...new Set(value as string[])];
}
export function readExpressionReferences(): { initialized: boolean; paths: string[] } {
  try { return { initialized: true, paths: validate(JSON.parse(fs.readFileSync(location(), 'utf8'))) }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { initialized: false, paths: [] }; throw e; }
}
export function saveExpressionReferences(value: unknown, initialize: boolean): { initialized: boolean; paths: string[] } {
  const paths = validate(value); const file = location();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (initialize) {
    try { fs.writeFileSync(file, JSON.stringify(paths, null, 2), { flag: 'wx' }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    return readExpressionReferences();
  }
  writeFileSafely(file, JSON.stringify(paths, null, 2));
  return { initialized: true, paths };
}

// ---- Reference Photos: the photos that show the AI what John looks like ------------------------------
// A separate list from the stars above (stars are favourites for thumbnails). The first time it is read it
// starts as a copy of the starred photos, so AI generation keeps working; after that the two never mix.

// Kept next to the starred list, so anything that moves that list (tests included) moves this one too.
const likenessLocation = () => process.env.HQ_LIKENESS_REFS_FILE ?? path.join(path.dirname(location()), 'likeness-references.json');

export function readLikenessReferences(): string[] {
  const file = likenessLocation();
  try { return validate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const copy = readExpressionReferences().paths;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(file, JSON.stringify(copy, null, 2), { flag: 'wx' }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; return readLikenessReferences(); }
    return copy;
  }
}

export function saveLikenessReferences(value: unknown): string[] {
  readLikenessReferences(); // make sure the one-time copy happened first
  const paths = validate(value);
  writeFileSafely(likenessLocation(), JSON.stringify(paths, null, 2));
  return paths;
}
