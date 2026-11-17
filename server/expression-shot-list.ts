import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { writeFileSafely } from './files.js';

export interface ShotSource { piece: string; context: string }
export interface ExpressionShot { id: string; expression: string; sources: ShotSource[]; addedAt: string; done: boolean }
export const SHOT_LIST_FILE = 'Expression Shot List.json';
export const INITIAL_SHOTS = [
  'Positive > Relief, Composure > Resolute, Positive > Warmth (open eyes, a quiet, relieved half-smile, the look of someone who has just come back)',
  'Composure > Calm, Positive > Relief, Composure > Meditative (eyes open, soft and steady, grounded rather than panicked)',
  'Positive > Warmth, Empathy > Compassion, Cognitive > Introspection (open eyes, warm and thoughtful, a gentle look rather than a worried one)',
];

export const shotKey = (expression: string) => expression.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function location() {
  const file = safeResolve('expressions', SHOT_LIST_FILE);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('The shot list must be a real file.');
  return file;
}

function load(): { shots: ExpressionShot[]; original: string | null } {
  const file = location();
  if (!fs.existsSync(file)) return { shots: [], original: null };
  const original = fs.readFileSync(file, 'utf8');
  let value: unknown;
  try { value = JSON.parse(original.replace(/^\uFEFF/, '')); }
  catch { throw new Error('The expression shot list could not be read. Nothing was changed.'); }
  const data = value as { version?: unknown; shots?: unknown };
  if (data?.version !== 1 || !Array.isArray(data.shots) || data.shots.some((s: ExpressionShot) => !s || typeof s.id !== 'string' || typeof s.expression !== 'string' || typeof s.addedAt !== 'string' || typeof s.done !== 'boolean' || !Array.isArray(s.sources) || s.sources.some(source => !source || typeof source.piece !== 'string' || typeof source.context !== 'string'))) throw new Error('The expression shot list has an unexpected format. Nothing was changed.');
  return { shots: data.shots as ExpressionShot[], original };
}

export function readShotList(): ExpressionShot[] { return load().shots; }

function save(shots: ExpressionShot[], original: string | null) {
  const file = location(); const text = JSON.stringify({ version: 1, shots }, null, 2) + '\n';
  if (original === null) fs.writeFileSync(file, text, { flag: 'wx' });
  else {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== original) throw new Error('The shot list changed elsewhere. Reload it and try again; nothing was changed.');
    writeFileSafely(file, text);
  }
}

/** Create the requested starting list once; never replace an existing file. */
export function seedShotList(): ExpressionShot[] {
  const shots = INITIAL_SHOTS.map(expression => ({ id: randomUUID(), expression, sources: [], addedAt: new Date().toISOString(), done: false }));
  fs.writeFileSync(location(), JSON.stringify({ version: 1, shots }, null, 2) + '\n', { flag: 'wx' });
  return shots;
}

/** Add the checked expressions, retaining where each suggestion came from. */
export function addExpressionShots(piece: string, input: unknown): ExpressionShot[] {
  const folder = safeResolve('projects', piece);
  const packaging = safeResolve('projects', path.join(piece, 'Packaging'));
  if (!piece || !fs.statSync(packaging, { throwIfNoEntry: false })?.isDirectory() || fs.lstatSync(packaging).isSymbolicLink() || fs.lstatSync(folder).isSymbolicLink()) throw new Error('Choose a video with packaging.');
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Choose one or more expressions.');
  const items = input.map((item: { expression?: unknown; context?: unknown }) => {
    if (!item || typeof item.expression !== 'string' || !item.expression.trim() || item.expression.length > 2000 || typeof item.context !== 'string' || item.context.length > 500) throw new Error('An expression suggestion is invalid.');
    return { expression: item.expression.trim(), context: item.context.trim() };
  });
  const { shots, original } = load();
  for (const item of items) {
    const source = { piece, context: item.context };
    const existing = shots.find(shot => shotKey(shot.expression) === shotKey(item.expression));
    if (existing) {
      if (!existing.sources.some(s => s.piece === piece && s.context === source.context)) existing.sources.push(source);
      existing.done = false;
    } else shots.push({ id: randomUUID(), expression: item.expression, sources: [source], addedAt: new Date().toISOString(), done: false });
  }
  save(shots, original); return shots;
}

export function setShotDone(id: unknown, done: unknown): ExpressionShot[] {
  if (typeof id !== 'string' || typeof done !== 'boolean') throw new Error('Choose a valid shot.');
  const { shots, original } = load(); const shot = shots.find(item => item.id === id);
  if (!shot) throw new Error('That shot is no longer on the list.');
  shot.done = done; save(shots, original); return shots;
}
