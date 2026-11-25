import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { writeFileSafely } from './files.js';
import { POSE_TAGS, THUMBNAIL_PHOTO_ATTRIBUTES } from './expression-attribute-vocabulary.js';

/**
 * Where a suggestion came from, and the exact words it used (kept so it is never added twice). `cues` are the gaze and
 * mouth the packaging asked for (photoAttributes): the same words with other cues are a different look (John, 2026-11-25).
 */
export interface ShotSource { piece: string; context: string; text?: string; cues?: string[] }
/**
 * One look to photograph. `category` is the main expression folder ("Composure/Calm"),
 * `description` says what the face should do, and the tag lists use the library's vocabulary.
 */
export interface ExpressionShot {
  id: string; category: string; title: string; description: string;
  framing: string[]; pose: string[]; morphology: string[]; alsoFits: string[];
  /** Tags the description rules out ("no squint" → Squint), from the same vocabulary. Older looks have none. */
  ruledOut?: string[];
  sources: ShotSource[]; addedAt: string; done: boolean;
}
export const SHOT_LIST_FILE = 'Expression Shot List.json';
export const INITIAL_SHOTS = [
  'Positive > Relief, Composure > Resolute, Positive > Warmth (open eyes, a quiet, relieved half-smile, the look of someone who has just come back)',
  'Composure > Calm, Positive > Relief, Composure > Meditative (eyes open, soft and steady, grounded rather than panicked)',
  'Positive > Warmth, Empathy > Compassion, Cognitive > Introspection (open eyes, warm and thoughtful, a gentle look rather than a worried one)',
];

export const shotKey = (expression: string) => expression.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const CATEGORY = /\b([A-Z][A-Za-z]+) > ([A-Z][A-Za-z]+)/g;
const capitalize = (text: string) => text ? text[0].toLocaleUpperCase() + text.slice(1) : text;

/**
 * Split a free-text suggestion such as "Positive > Relief, Composure > Calm (a tired, soft smile)"
 * into a main folder, other folders it fits, and the plain description of the face.
 */
export function parseShotSuggestion(text: string): Pick<ExpressionShot, 'category' | 'description' | 'alsoFits'> {
  const clean = text.trim().replace(/\s+/g, ' ');
  const folders = [...new Set([...clean.matchAll(CATEGORY)].map(m => `${m[1]}/${m[2]}`))];
  const bracket = clean.match(/\(([^()]{3,})\)/)?.[1];
  const rest = clean.replace(CATEGORY, '').replace(/\([^()]*\)/g, ' ')
    .replace(/\s+/g, ' ').replace(/^(?:[\s,;:.—-]|\b(?:or|and|with|as a third choice)\b)+/i, '').trim();
  const words = (bracket ?? (folders.length ? rest : clean)).trim().replace(/[.\s]+$/, '');
  const description = words ? capitalize(words) + '.' : '';
  return { category: folders[0] ?? '', alsoFits: folders.slice(1), description };
}

function fromText(text: string, sources: ShotSource[], addedAt: string, done: boolean, id: string = randomUUID()): ExpressionShot {
  return { id, ...parseShotSuggestion(text), title: '', framing: [], pose: [], morphology: [], sources, addedAt, done };
}

function location() {
  const file = safeResolve('expressions', SHOT_LIST_FILE);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('The shot list must be a real file.');
  return file;
}

const strings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
const validSources = (value: unknown) => Array.isArray(value) && value.every(s => s && typeof s.piece === 'string' && typeof s.context === 'string' && (s.text === undefined || typeof s.text === 'string') && (s.cues === undefined || strings(s.cues)));

function load(): { shots: ExpressionShot[]; original: string | null } {
  const file = location();
  if (!fs.existsSync(file)) return { shots: [], original: null };
  const original = fs.readFileSync(file, 'utf8');
  let value: unknown;
  try { value = JSON.parse(original.replace(/^﻿/, '')); }
  catch { throw new Error('The expression shot list could not be read. Nothing was changed.'); }
  const data = value as { version?: unknown; shots?: unknown };
  const unexpected = new Error('The expression shot list has an unexpected format. Nothing was changed.');
  if (!Array.isArray(data?.shots)) throw unexpected;
  // Version 1 kept each suggestion as one line of text; read it as unsorted looks.
  if (data.version === 1) {
    const old = data.shots as { id?: unknown; expression?: unknown; sources?: unknown; addedAt?: unknown; done?: unknown }[];
    if (old.some(s => !s || typeof s.id !== 'string' || typeof s.expression !== 'string' || typeof s.addedAt !== 'string' || typeof s.done !== 'boolean' || !validSources(s.sources))) throw unexpected;
    return { shots: old.map(s => {
      const text = s.expression as string; const sources = s.sources as ShotSource[];
      const withText = sources.length ? sources.map(src => ({ ...src, text: src.text ?? text })) : [{ piece: '', context: '', text }];
      return fromText(text, withText, s.addedAt as string, s.done as boolean, s.id as string);
    }), original };
  }
  if (data.version !== 2 || (data.shots as ExpressionShot[]).some(s => !s || typeof s.id !== 'string' || typeof s.category !== 'string' || typeof s.title !== 'string' || typeof s.description !== 'string' || !strings(s.framing) || !strings(s.pose) || !strings(s.morphology) || !strings(s.alsoFits) || (s.ruledOut !== undefined && !strings(s.ruledOut)) || typeof s.addedAt !== 'string' || typeof s.done !== 'boolean' || !validSources(s.sources))) throw unexpected;
  return { shots: data.shots as ExpressionShot[], original };
}

export function readShotList(): ExpressionShot[] { return load().shots; }

function save(shots: ExpressionShot[], original: string | null) {
  const file = location(); const text = JSON.stringify({ version: 2, shots }, null, 2) + '\n';
  if (original === null) fs.writeFileSync(file, text, { flag: 'wx' });
  else {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== original) throw new Error('The shot list changed elsewhere. Reload it and try again; nothing was changed.');
    writeFileSafely(file, text);
  }
}

/** Create the requested starting list once; never replace an existing file. */
export function seedShotList(): ExpressionShot[] {
  const now = new Date().toISOString();
  const shots = INITIAL_SHOTS.map(text => fromText(text, [{ piece: '', context: '', text }], now, false));
  fs.writeFileSync(location(), JSON.stringify({ version: 2, shots }, null, 2) + '\n', { flag: 'wx' });
  return shots;
}

/** The cues as one comparable string: order and repeats don't matter. */
export const cueKey = (cues?: string[]) => [...new Set(cues ?? [])].sort().join(',');

/** Has this exact suggestion (ignoring case and spacing), with the same cues, already been added to a look? */
export const shotHasSuggestion = (shot: ExpressionShot, text: string, cues?: string[]) =>
  shot.sources.some(s => s.text !== undefined && shotKey(s.text) === shotKey(text) && cueKey(s.cues) === cueKey(cues));

/** A new look made from one suggestion's words. Its cues become the look's gaze (Pose) and mouth (Morphology) tags. */
export const shotFromSuggestion = (text: string, source: ShotSource): ExpressionShot => {
  const shot = fromText(text, [source], new Date().toISOString(), false);
  const cues = [...new Set(source.cues ?? [])];
  shot.pose = cues.filter(cue => POSE_TAGS.includes(cue));
  shot.morphology = cues.filter(cue => !POSE_TAGS.includes(cue));
  return shot;
};

/** Reads the list, lets `change` edit it, and saves it (refused if the file changed meanwhile). */
export function changeShotList(change: (shots: ExpressionShot[]) => void): ExpressionShot[] {
  const { shots, original } = load(); change(shots); save(shots, original); return shots;
}

/**
 * Adds a suggestion to a look it matches word for word, keeping where it came from. A look already photographed stays
 * done: being suggested again doesn't make it needed again. Returns false when no look has these words.
 */
export function addToMatchingShot(shots: ExpressionShot[], source: ShotSource & { text: string }): boolean {
  const existing = shots.find(shot => shotHasSuggestion(shot, source.text, source.cues));
  if (!existing) return false;
  if (!existing.sources.some(s => s.piece === source.piece && s.context === source.context)) existing.sources.push(source);
  return true;
}

/** Checks a video's suggestions before anything is added. */
export function checkShotSuggestions(piece: string, input: unknown): { expression: string; context: string; cues?: string[] }[] {
  const folder = safeResolve('projects', piece);
  const packaging = safeResolve('projects', path.join(piece, 'Packaging'));
  if (!piece || !fs.statSync(packaging, { throwIfNoEntry: false })?.isDirectory() || fs.lstatSync(packaging).isSymbolicLink() || fs.lstatSync(folder).isSymbolicLink()) throw new Error('Choose a video with packaging.');
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new Error('Choose one or more expressions.');
  return input.map((item: { expression?: unknown; context?: unknown; cues?: unknown }) => {
    if (!item || typeof item.expression !== 'string' || !item.expression.trim() || item.expression.length > 2000 || typeof item.context !== 'string' || item.context.length > 500) throw new Error('An expression suggestion is invalid.');
    const cues = Array.isArray(item.cues) ? item.cues.filter((cue): cue is string => typeof cue === 'string' && THUMBNAIL_PHOTO_ATTRIBUTES.includes(cue)) : [];
    return { expression: item.expression.trim(), context: item.context.trim(), ...(cues.length ? { cues } : {}) };
  });
}

/** Add a video's suggestions word for word, retaining where each came from (no AI; see expression-shot-merge.ts). */
export function addExpressionShots(piece: string, input: unknown): ExpressionShot[] {
  const items = checkShotSuggestions(piece, input);
  return changeShotList(shots => {
    for (const item of items) {
      const source = { piece, context: item.context, text: item.expression, ...(item.cues ? { cues: item.cues } : {}) };
      if (!addToMatchingShot(shots, source)) shots.push(shotFromSuggestion(item.expression, source));
    }
  });
}

export function setShotDone(id: unknown, done: unknown): ExpressionShot[] {
  if (typeof id !== 'string' || typeof done !== 'boolean') throw new Error('Choose a valid shot.');
  const { shots, original } = load(); const shot = shots.find(item => item.id === id);
  if (!shot) throw new Error('That shot is no longer on the list.');
  shot.done = done; save(shots, original); return shots;
}

/** Remove one look from the list. Only the list file changes; no photos are touched. */
export function deleteShot(id: unknown): ExpressionShot[] {
  if (typeof id !== 'string') throw new Error('Choose a valid shot.');
  const { shots, original } = load(); const at = shots.findIndex(item => item.id === id);
  if (at < 0) throw new Error('That shot is no longer on the list.');
  shots.splice(at, 1); save(shots, original); return shots;
}
