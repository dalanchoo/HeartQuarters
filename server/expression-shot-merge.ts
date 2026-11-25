// Keeping the Expression Shot List free of looks that are the same photo in other words (John, 2026-11-25).
// Every expression a packaging brief suggests is added automatically. An AI compares the new looks with the ones
// already in the same expression folder, and a look that would be the same photo is merged into the one that stays:
// its words and video are kept in that look's sources, and its AI pictures are copied over, so nothing is lost.
// Merge Duplicates runs the same comparison over the whole list, after saving a copy of the list as it was.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, safeResolve } from './config.js';
import { addToMatchingShot, changeShotList, checkShotSuggestions, readShotList, shotFromSuggestion, SHOT_LIST_FILE, shotKey, type ExpressionShot } from './expression-shot-list.js';
import { copyShotPictures } from './shot-reference.js';
import { tagShots } from './expression-shot-tags.js';
import { writable } from './safe-files.js';

/** Asks an AI one question and gives back its answer. */
export type AskText = (prompt: string) => Promise<string>;

/** A folder for the AI to work in; it reads nothing there, but every AI program needs one. */
export function mergeWorkFolder(): string {
  const dir = process.env.VITEST ? path.join(os.tmpdir(), 'hq-shot-merge-tests') : path.join(appDir, 'data', 'shot-merge');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The question: which looks in the same folder would be the same photo. Each folder lists its looks by id. */
export function duplicatesPrompt(shots: ExpressionShot[]): string {
  const folders = new Map<string, { id: string; look: string; wordings: string[] }[]>();
  for (const shot of shots) {
    const wordings = [...new Set(shot.sources.map(s => s.text?.trim()).filter((t): t is string => !!t))].slice(0, 3);
    folders.set(shot.category, [...(folders.get(shot.category) ?? []), { id: shot.id, look: [shot.title, shot.description].filter(Boolean).join('. '), wordings }]);
  }
  const data = [...folders].map(([folder, looks]) => ({ folder: folder.replace('/', ' > '), looks }));
  return [
    'You are tidying a shot list of facial expressions a YouTuber, John, wants photographed of himself for thumbnails. Each look is in one expression folder. Different videos described the looks, so the same look is often worded differently.',
    'Within each folder, find looks that would be the same photo: the same expression at the same strength, with the same eyes, gaze and head position. Only the wording differs. Looks that differ in something a photographer would shoot differently are NOT duplicates, for example eyes open versus closed, looking at the camera versus away, a smile versus no smile, a head tilt or turn, or a hand on the face. A short note such as "No finger on the chin." is a detail of its folder\'s look: group it with the look it most resembles only if nothing in it conflicts. When unsure, keep them apart.',
    'Never group looks from different folders.',
    'Answer with JSON only, in this form: {"duplicates": [["id of the best-described look", "id", ...], ...]}. Put each group\'s most specific, most photographable description first. Leave out looks with no duplicate. If there are none, answer {"duplicates": []}.',
    'The looks, by folder ("wordings" are the original suggestions):',
    JSON.stringify(data, null, 1),
  ].join('\n\n');
}

/** The AI's groups, each with at least two known ids, no id in two groups, all from one folder. */
export function parseDuplicates(answer: string, shots: ExpressionShot[]): string[][] {
  const start = answer.indexOf('{'); const end = answer.lastIndexOf('}');
  let value: unknown;
  try { value = JSON.parse(answer.slice(start, end + 1)); } catch { throw new Error('The AI did not answer with a list of duplicates.'); }
  const groups = (value as { duplicates?: unknown })?.duplicates;
  if (start < 0 || !Array.isArray(groups)) throw new Error('The AI did not answer with a list of duplicates.');
  const byId = new Map(shots.map(s => [s.id, s]));
  const used = new Set<string>();
  const result: string[][] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    const ids = [...new Set(group.filter((id): id is string => typeof id === 'string' && byId.has(id) && !used.has(id)))];
    const folder = ids.length ? byId.get(ids[0])!.category : '';
    const same = ids.filter(id => byId.get(id)!.category === folder);
    if (same.length < 2) continue;
    same.forEach(id => used.add(id));
    result.push(same);
  }
  return result;
}

/**
 * Merges each group into one look: the first of `keep` in the group, else the group's first. The look that stays gets
 * the others' sources, any title or tags it lacks, and is done if any of them was. Returns [merged id, kept id] pairs.
 */
export function applyDuplicates(shots: ExpressionShot[], groups: string[][], keep: Set<string> = new Set()): [string, string][] {
  const merged: [string, string][] = [];
  for (const group of groups) {
    const present = group.filter(id => shots.some(s => s.id === id));
    if (present.length < 2) continue;
    const keptId = present.find(id => keep.has(id)) ?? present[0];
    const kept = shots.find(s => s.id === keptId)!;
    for (const id of present) {
      if (id === keptId) continue;
      const at = shots.findIndex(s => s.id === id); const other = shots[at];
      for (const source of other.sources) {
        if (!kept.sources.some(s => s.piece === source.piece && s.context === source.context && shotKey(s.text ?? '') === shotKey(source.text ?? ''))) kept.sources.push(source);
      }
      if (!kept.title) kept.title = other.title;
      for (const key of ['framing', 'pose', 'morphology'] as const) if (!kept[key].length) kept[key] = [...other[key]];
      if (!kept.ruledOut?.length && other.ruledOut?.length) kept.ruledOut = [...other.ruledOut];
      kept.alsoFits = [...new Set([...kept.alsoFits, ...other.alsoFits])].filter(f => f !== kept.category);
      kept.done = kept.done || other.done;
      shots.splice(at, 1);
      merged.push([id, keptId]);
    }
  }
  return merged;
}

/** Folders worth asking about: those with two or more looks, at least one of them in `among` when given. */
function worthComparing(shots: ExpressionShot[], among?: Set<string>): ExpressionShot[] {
  const count = new Map<string, number>();
  for (const s of shots) count.set(s.category, (count.get(s.category) ?? 0) + 1);
  const folders = new Set(shots.filter(s => s.category && (count.get(s.category) ?? 0) > 1 && (!among || among.has(s.id))).map(s => s.category));
  return shots.filter(s => folders.has(s.category));
}

export interface ShotAddResult { shots: ExpressionShot[]; added: number; merged: number; error?: string }

/**
 * Adds a video's suggestions: word-for-word repeats join their look; the rest are compared by the AI with the looks
 * in the same folder, and a duplicate joins the look already there. If the AI fails, the new looks are added unmerged
 * (Merge Duplicates can tidy them later) and `error` says why. Then the AI fills in the new looks' tags.
 */
export async function addShotsMerging(piece: string, input: unknown, ask: AskText): Promise<ShotAddResult> {
  const items = checkShotSuggestions(piece, input);
  const before = readShotList();
  const fresh: ExpressionShot[] = [];
  for (const item of items) {
    const source = { piece, context: item.context, text: item.expression };
    if (!before.some(s => s.sources.some(src => shotKey(src.text ?? '') === shotKey(item.expression))) && !fresh.some(s => shotKey(s.sources[0].text ?? '') === shotKey(item.expression))) fresh.push(shotFromSuggestion(item.expression, source));
  }
  const freshIds = new Set(fresh.map(s => s.id));
  let groups: string[][] = []; let error: string | undefined;
  const compare = worthComparing([...before, ...fresh], freshIds);
  if (compare.length) {
    try { groups = parseDuplicates(await ask(duplicatesPrompt(compare)), compare).filter(g => g.some(id => freshIds.has(id))); }
    catch (e) { error = `The new looks were added without checking for duplicates: ${e instanceof Error ? e.message : String(e)}`; }
  }
  let merged: [string, string][] = [];
  const shots = changeShotList(list => {
    const existing = new Set(list.map(s => s.id));
    list.push(...fresh);
    // Each suggestion joins the look with its exact words (a new look already has its first one's).
    for (const item of items) addToMatchingShot(list, { piece, context: item.context, text: item.expression });
    merged = applyDuplicates(list, groups, existing);
  });
  for (const [from, to] of merged) copyShotPictures(from, to);
  const kept = new Set(fresh.filter(s => shots.some(look => look.id === s.id)).map(s => s.id));
  // The new looks' tags are filled in from their descriptions (expression-shot-tags.ts).
  let final = shots;
  if (kept.size) {
    try { final = (await tagShots(ask, kept)).shots; }
    catch (e) { error = [error, `The new looks' tags were not filled in: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join(' '); }
  }
  return { shots: final, added: kept.size, merged: items.length - kept.size, ...(error ? { error } : {}) };
}

let merging = false;

/** Saves a copy of the list as it is ("Expression Shot List (Before Merging 2026-11-25 1430).json"). Returns its name. */
function keepCopy(): string {
  const file = safeResolve('expressions', SHOT_LIST_FILE);
  const now = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
  for (let n = 1; ; n++) {
    const name = `Expression Shot List (Before Merging ${stamp}${n > 1 ? ` ${n}` : ''}).json`;
    const copy = writable(path.join(path.dirname(file), name), 'expressions');
    if (fs.existsSync(copy)) continue;
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
    return name;
  }
}

/** Merge Duplicates: compares every folder's looks and merges the duplicates, after saving a copy of the list. */
export async function mergeDuplicateShots(ask: AskText): Promise<{ shots: ExpressionShot[]; merged: number; copy?: string }> {
  if (merging) throw new Error('Duplicates are already being merged.');
  merging = true;
  try {
    const compare = worthComparing(readShotList());
    if (!compare.length) return { shots: readShotList(), merged: 0 };
    const groups = parseDuplicates(await ask(duplicatesPrompt(compare)), compare);
    if (!groups.length) return { shots: readShotList(), merged: 0 };
    const copy = keepCopy();
    let merged: [string, string][] = [];
    const shots = changeShotList(list => { merged = applyDuplicates(list, groups); });
    for (const [from, to] of merged) copyShotPictures(from, to);
    return { shots, merged: merged.length, copy };
  } finally { merging = false; }
}
