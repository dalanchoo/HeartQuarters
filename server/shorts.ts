// The shorts plan: which clips of a longform become shorts. It lives with the video, in Shorts\Shorts Plan.json:
// Claude writes it ("Propose shorts"), John edits it on the video's page, and each short is made from a row of it
// ("Make this short"). Near misses are rows like any other, so John can move them back and forth.
// A pasted retention graph lives beside it, in Shorts\Retention Graph.png, for Claude to read when proposing.
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { chosenAi, requireCapCutAi } from './ai.js';
import { askInConversation, forgetRun, getRun, longformMetadataPrompt, metadataPrompt, pieceNotePrompt, startEdit, startShortBuild, stopRun, type ClaudeJob, type ClaudeRun } from './claude.js';
import { uploadsFor } from './youtube.js';
import { checkDraftName, createCapCutDraft, createVideoFolder, draftsForVideo, numberOf } from './create.js';
import { writeFileSafely } from './files.js';
import { deleteFolder, system, trashDraft } from './manage.js';

export interface PlannedShort {
  id: string;
  title: string;
  /** Seconds on the longform's timeline. */
  start: number;
  end: number;
  firstLine?: string;
  lastLine?: string;
  kind?: string;
  score?: number;
  why?: string;
  /** What the viewer sees during the clip. */
  visuals?: string;
  /** For a near miss: why it wasn't chosen. */
  reason?: string;
  /** The short's folder and CapCut project, once it has been made. */
  made?: string;
  /** The times Claude proposed, so John can go back to them. Null for a row John added himself. */
  proposed?: { start: number; end: number } | null;
}

export interface ShortsPlan {
  shorts: PlannedShort[];
  rejected: PlannedShort[];
}

function planFile(video: string): string {
  if (!video) throw new Error('No video given.');
  return safeResolve('projects', path.join(video, 'Shorts', 'Shorts Plan.json'));
}

/** Checks a list of shorts: the page sends what John typed, and Claude writes the file by hand. */
export function checkShorts(rows: unknown, seen = new Set<string>()): PlannedShort[] {
  if (!Array.isArray(rows)) throw new Error('The plan has no list of shorts.');
  return rows.map((r: Partial<PlannedShort>) => {
    const id = String(r?.id ?? '');
    const title = String(r?.title ?? '').trim();
    const start = Number(r?.start);
    const end = Number(r?.end);
    if (!/^S\d+$/.test(id)) throw new Error(`"${id}" isn't a short's number (S01, S02...).`);
    if (seen.has(id)) throw new Error(`Two shorts are numbered ${id}.`);
    seen.add(id);
    if (!title) throw new Error(`${id} has no title.`);
    if (/[<>:"/\\|?*]/.test(title) || /[. ]$/.test(title)) {
      throw new Error(`${id}'s title can't be a folder name: leave out < > : " / \\ | ? * and a dot at the end.`);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`${id}: the end must come after the start.`);
    }
    const { proposed, ...rest } = r;
    const usable = proposed === null || (Number.isFinite(proposed?.start) && Number.isFinite(proposed?.end));
    return { ...rest, id, title, start, end, ...(usable ? { proposed } : {}) };
  });
}

/**
 * Near misses written by Claude may be only a title and a reason, so they get what a row needs: a free number, a title
 * that can be a folder name, and times. Missing times are filled in and pointed out, not hidden.
 */
function readNearMisses(raw: unknown, shorts: PlannedShort[]): PlannedShort[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set(shorts.map((s) => s.id));
  const numbered = (n: number) => `S${String(n).padStart(2, '0')}`;
  let next = Math.max(0, ...shorts.map((s) => Number(s.id.slice(1)) || 0));
  const rows = raw.map((r: Partial<PlannedShort>) => {
    let id = String(r?.id ?? '');
    if (!/^S\d+$/.test(id) || taken.has(id)) {
      do next++;
      while (taken.has(numbered(next)));
      id = numbered(next);
    }
    taken.add(id);
    const title = String(r?.title ?? '').replace(/[<>:"/\\|?*]/g, ' ').replace(/[. ]+$/, '').trim() || 'Untitled';
    const hasTimes = Number(r?.end) > Number(r?.start) && Number(r?.start) >= 0;
    return {
      ...r,
      id,
      title,
      start: hasTimes ? Number(r.start) : 0,
      end: hasTimes ? Number(r.end) : 30,
      ...(hasTimes ? {} : { reason: `${r?.reason ?? ''} (Claude gave no times, so these are placeholders.)`.trim() }),
    };
  });
  return checkShorts(rows, new Set(shorts.map((s) => s.id)));
}

/** The video's plan, or null if there isn't one yet. A damaged file is reported, not ignored. */
export function readPlan(video: string): ShortsPlan | null {
  const file = planFile(video);
  if (!fs.existsSync(file)) return null;
  let raw: { shorts?: unknown; rejected?: unknown };
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    throw new Error('Shorts Plan.json is not readable. Propose shorts again, or fix the file.');
  }
  const shorts = checkShorts(raw.shorts ?? []);
  return { shorts, rejected: readNearMisses(raw.rejected, shorts) };
}

function writePlan(video: string, plan: ShortsPlan) {
  const file = planFile(video);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileSafely(file, JSON.stringify(plan, null, 1));
}

/**
 * Saves John's edits. Without a near-miss list the saved one stays. Which rows have been made is the engine's to say,
 * so a page that hadn't noticed yet can't undo it.
 */
export function savePlan(video: string, rows: unknown, nearMisses?: unknown): ShortsPlan {
  const seen = new Set<string>();
  const shorts = checkShorts(rows, seen);
  const old = fs.existsSync(planFile(video)) ? readPlan(video) : null;
  const rejected = nearMisses === undefined ? (old?.rejected ?? []) : checkShorts(nearMisses, seen);
  const before = new Map([...(old?.shorts ?? []), ...(old?.rejected ?? [])].map((s) => [s.id, s]));
  // What's done and what Claude proposed come from the file, never from the page. Times the file has before a row's
  // first edit are Claude's own, so that's when they get remembered.
  const finish = (s: PlannedShort): PlannedShort => {
    const { made: _made, proposed: _proposed, ...rest } = s;
    const was = before.get(s.id);
    const row: PlannedShort = rest;
    if (was?.made) row.made = was.made;
    if (old) row.proposed = !was ? null : was.proposed !== undefined ? was.proposed : { start: was.start, end: was.end };
    return row;
  };
  const plan: ShortsPlan = { shorts: shorts.map(finish), rejected: rejected.map(finish) };
  writePlan(video, plan);
  return plan;
}

function stamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Before proposing again: the current plan is renamed, never overwritten, so John's edits can't be lost. */
export function keepOldPlan(video: string, now = new Date()): string | null {
  const file = planFile(video);
  if (!fs.existsSync(file)) return null;
  const kept = path.join(path.dirname(file), `Shorts Plan - before ${stamp(now)}.json`);
  fs.renameSync(file, kept);
  return kept;
}

// ---- The words of a clip --------------------------------------------------------

export interface TimedWord {
  start: number;
  end: number;
  word: string;
}

/**
 * The longform's word-by-word transcript, for showing what each clip says. The final video's is in Subtitles, named
 * "NNN-captions.words.json"; older episodes kept it elsewhere as "... - edit" or "... - final". Otherwise the newest.
 * The takes' own transcripts aren't on the longform's timeline.
 */
export function readTranscript(video: string): { file: string; words: TimedWord[] } | null {
  const longform = safeResolve('projects', path.join(video, 'Longform'));
  const found: { name: string; full: string; time: number; rank: number }[] = [];
  // Subtitles first: that's where the final video's transcript lives now. The others hold older episodes' and work in progress.
  const dirs = ['Subtitles', path.join('Intermediate', 'Transcript'), path.join('Claude', 'transcript')];
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(longform, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.words.json') || /^take\b/i.test(name)) continue;
      const full = path.join(longform, dir, name);
      found.push({ name, full, time: fs.statSync(full).mtimeMs, rank: dirs.indexOf(dir) });
    }
  }
  const finished = (name: string) => (/(-captions| - (edit|final))\.words\.json$/i.test(name) ? 1 : 0);
  found.sort((a, b) => finished(b.name) - finished(a.name) || a.rank - b.rank || b.time - a.time);
  if (!found[0]) return null;
  const raw = JSON.parse(fs.readFileSync(found[0].full, 'utf8').replace(/^﻿/, '')) as {
    words?: TimedWord[];
    segments?: { words?: TimedWord[] }[];
  };
  const all = raw.segments ? raw.segments.flatMap((s) => s.words ?? []) : (raw.words ?? []);
  return {
    file: found[0].name,
    words: all.map((w) => ({ start: w.start, end: w.end, word: w.word.trim() })),
  };
}

/** The newest export of the longform, for previewing clips. Relative to Video Projects, like a project's other files. */
export function latestExport(video: string): string | null {
  const dir = safeResolve('projects', path.join(video, 'Longform', 'Exports'));
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.(mp4|mov|m4v|webm)$/i.test(n));
  } catch {
    return null;
  }
  const newest = names
    .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  return newest ? `${video}/Longform/Exports/${newest.n}` : null;
}

// ---- The retention graph ---------------------------------------------------------

const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function retentionFile(video: string): string {
  if (!video) throw new Error('No video given.');
  return safeResolve('projects', path.join(video, 'Shorts', 'Retention Graph.png'));
}

export function hasRetention(video: string): boolean {
  return fs.existsSync(retentionFile(video));
}

/** Where the page can show the graph, with a number that changes when the graph does. */
export function retentionInfo(video: string): { path: string; version: number } | null {
  const stat = fs.statSync(retentionFile(video), { throwIfNoEntry: false });
  return stat ? { path: `${video}/Shorts/Retention Graph.png`, version: Math.round(stat.mtimeMs) } : null;
}

/** Takes the graph out of use. It's only renamed, so nothing is lost. */
export function retireRetention(video: string, now = new Date()) {
  const file = retentionFile(video);
  if (fs.existsSync(file)) fs.renameSync(file, path.join(path.dirname(file), `Retention Graph - before ${stamp(now)}.png`));
}

/** Saves a pasted screenshot (a PNG, sent as base64). An earlier graph is kept under another name. */
export function saveRetention(video: string, base64: unknown, now = new Date()) {
  const file = retentionFile(video);
  const bytes = Buffer.from(String(base64 ?? ''), 'base64');
  if (!bytes.subarray(0, PNG_START.length).equals(PNG_START)) throw new Error("That picture isn't a PNG.");
  retireRetention(video, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

// ---- Making a short --------------------------------------------------------------

const making = new Set<string>();

/**
 * "Make this short": the short's folder from the template, the longform's CapCut project copied under the short's name,
 * then Claude cuts that copy down and turns it portrait. Each row is made once; after that John talks to Claude.
 */
export async function makeShort(video: string, id: string, sourceDraft: string): Promise<ClaudeRun> {
  requireCapCutAi(chosenAi());
  const plan = readPlan(video);
  const row = plan && [...plan.shorts, ...plan.rejected].find((s) => s.id === id);
  if (!plan || !row) throw new Error(`There's no ${id} in this video's list.`);
  if (row.made) throw new Error(`${id} has already been made: "${row.made}".`);
  if (system.isCapCutRunning()) throw new Error('Close CapCut first, then try again. Nothing was changed.');
  const source = checkDraftName(sourceDraft);
  const name = `${numberOf(video)}_${id} - ${row.title}`;
  const key = `${video}#${id}`;
  if (making.has(key)) throw new Error(`${id} is already being made.`);
  making.add(key);
  try {
    const made = await createVideoFolder('short', video, name, source);
    if (!made.capcut.created) {
      // Only ever removes the template copy that createVideoFolder just made: it refuses a folder that already exists.
      fs.rmSync(safeResolve('projects', made.path), { recursive: true, force: true });
      throw new Error(made.capcut.message);
    }
    // Read again: the copy can take minutes, and John may have edited the list meanwhile.
    const now = readPlan(video) ?? plan;
    const mark = (s: PlannedShort) => (s.id === id ? { ...s, made: name } : s);
    writePlan(video, { shorts: now.shorts.map(mark), rejected: now.rejected.map(mark) });
    const notes = [row.visuals, row.why].filter(Boolean).join(' ');
    return startShortBuild(video, { id, title: row.title, start: row.start, end: row.end, name, source, notes });
  } finally {
    making.delete(key);
  }
}

/**
 * "Regenerate": moves the short's folder and CapCut project to the trash (nothing is really deleted), then makes the
 * short again from a fresh copy of the longform, with a new conversation. For trying changed instructions from scratch.
 */
export async function regenerateShort(video: string, id: string, sourceDraft: string): Promise<ClaudeRun> {
  requireCapCutAi(chosenAi());
  const plan = readPlan(video);
  const row = plan && [...plan.shorts, ...plan.rejected].find((s) => s.id === id);
  if (!plan || !row) throw new Error(`There's no ${id} in this video's list.`);
  const old = row.made;
  if (!old) throw new Error(`${id} hasn't been made yet.`);
  if (getRun(video, `short-${id}`)?.status === 'running') throw new Error('The AI is still working on this short. Stop it first.');
  if (system.isCapCutRunning()) throw new Error('Close CapCut first, then try again. Nothing was changed.');
  // Checked now, because after this the old short is already in the trash.
  const source = checkDraftName(sourceDraft);
  if (source === old) throw new Error("A short can't be remade from its own CapCut project. Choose the longform's.");
  if (!fs.existsSync(path.join(config.capcutDraftsDir, source))) throw new Error(`There's no CapCut draft called "${source}".`);

  const draftDir = path.join(config.capcutDraftsDir, old);
  const hadDraft = fs.existsSync(draftDir);
  if (fs.existsSync(safeResolve('projects', path.join(video, 'Shorts', old)))) {
    deleteFolder(`${video}/Shorts/${old}`, hadDraft ? [old] : []);
  }
  if (fs.existsSync(draftDir)) {
    throw new Error(`The CapCut project "${old}" couldn't be moved to the trash. Its folder has been; close whatever is using the project, then click Make this short.`);
  }
  const unmark = ({ made: _made, ...rest }: PlannedShort): PlannedShort => (rest.id === id ? rest : { ...rest, made: _made });
  writePlan(video, { shorts: plan.shorts.map(unmark), rejected: plan.rejected.map(unmark) });
  return makeShort(video, id, source);
}

/** A short's number from its folder's name: "022_S01 - Title" is S01. Its conversation is named after that. */
function shortId(short: string): string {
  const id = /^[^\\/]*_(S\d+) - [^\\/]+$/.exec(short)?.[1];
  if (!id) throw new Error(`"${short}" isn't named like a short (022_S01 - Title).`);
  return id;
}

// ---- One piece's AI conversation: the longform's or a short's --------------------
// Every card on a video's page has the same AI box. "Longform" means the longform's conversation (the "edit" job);
// anything else is a short's folder name, whose conversation is named after its number.

interface PieceJob {
  job: ClaudeJob;
  /** Its CapCut project's name. */
  draft: string;
}

/** Which conversation a card talks to. A short goes by its folder, so one John made by hand works too. */
export function pieceJob(video: string, piece: string): PieceJob {
  if (!video) throw new Error('No video given.');
  if (piece === 'Longform') {
    if (!fs.existsSync(safeResolve('projects', path.join(video, 'Longform')))) throw new Error(`"${video}" has no Longform folder.`);
    return { job: 'edit', draft: path.basename(video) };
  }
  const id = shortId(piece);
  if (!fs.existsSync(safeResolve('projects', path.join(video, 'Shorts', piece)))) {
    throw new Error(`There's no short called "${piece}" in this video.`);
  }
  return { job: `short-${id}`, draft: piece };
}

/** That piece's conversation, if it has one. */
export function pieceRun(video: string, piece: string): ClaudeRun | null {
  return getRun(video, pieceJob(video, piece).job);
}

/** John's note to a piece's AI. Without a conversation yet, it starts one that knows which piece and skill it's about. */
export function notePiece(video: string, piece: string, text: unknown): ClaudeRun {
  const note = String(text ?? '').trim();
  if (!note) throw new Error('The note is empty.');
  const { job, draft } = pieceJob(video, piece);
  if (getRun(video, job)) return askInConversation(video, job, draft, note);
  const videoDir = safeResolve('projects', video);
  return askInConversation(video, job, draft, pieceNotePrompt(videoDir, job, draft, note), note);
}

/**
 * "Write YouTube metadata", the same button on every card. Any AI can do this one, since it only writes a text file
 * in the video's folder.
 */
export function writePieceMetadata(video: string, piece: string): ClaudeRun {
  const { job, draft } = pieceJob(video, piece);
  // A clean conversation every time: metadata doesn't need what came before, and a long history costs tokens.
  forgetRun(video, job);
  const message = job === 'edit' ? longformMetadataPrompt() : metadataPrompt(piece, readLongformUrl(video));
  return askInConversation(video, job, draft, message);
}

// ---- Generate and Regenerate, the same button on every card -----------------------

export interface PieceState {
  /** True once the piece exists: the longform has a first cut, or the short has been made. */
  generated: boolean;
  canGenerate: boolean;
  /** Why the button can't be used, when it can't. */
  reason?: string;
}

/** Whether a CapCut project has anything on its timeline. A copy of the empty template has nothing. */
function hasFirstCut(draft: string): boolean {
  const file = path.join(config.capcutDraftsDir, draft, 'draft_content.json');
  try {
    return /"segments"\s*:\s*\[\s*\{/.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

/** The plan's row for a short made from it, or null for one John made by hand. */
function plannedRowFor(video: string, short: string): PlannedShort | null {
  try {
    const plan = readPlan(video);
    return [...(plan?.shorts ?? []), ...(plan?.rejected ?? [])].find((s) => s.made === short) ?? null;
  } catch {
    return null;
  }
}

export function pieceState(video: string, piece: string): PieceState {
  const { job, draft } = pieceJob(video, piece);
  if (job === 'edit') return { generated: hasFirstCut(draft), canGenerate: true };
  if (plannedRowFor(video, piece)) return { generated: true, canGenerate: true };
  return {
    generated: true,
    canGenerate: false,
    reason: "This short isn't in the shorts plan, so where its clip starts and ends isn't known. Only shorts made from the plan can be regenerated.",
  };
}

/**
 * The card's Generate / Regenerate button. A longform without a first cut gets one, made from its takes. Regenerate,
 * which the page only sends after "Are you sure?", moves the current CapCut project to the trash and starts again:
 * the longform from a fresh copy of the template, a short from a fresh copy of the longform's project. Changes go in
 * as notes instead.
 */
export async function generatePiece(video: string, piece: string, regenerate: unknown): Promise<ClaudeRun> {
  const { job, draft } = pieceJob(video, piece);
  const confirmed = regenerate === true;
  if (job !== 'edit') {
    const row = plannedRowFor(video, piece);
    if (!row) throw new Error(pieceState(video, piece).reason);
    if (!confirmed) throw new Error('This short has already been made. Confirm to regenerate it.');
    const source = fs.existsSync(path.join(config.capcutDraftsDir, path.basename(video))) ? path.basename(video) : draftsForVideo(video).find((d) => d !== draft) ?? '';
    return regenerateShort(video, row.id, source);
  }
  requireCapCutAi(chosenAi());
  if (getRun(video, 'edit')?.status === 'running') throw new Error('The AI is still working on this longform. Stop it first.');
  if (hasFirstCut(draft)) {
    if (!confirmed) throw new Error('This longform already has a first cut. Confirm to regenerate it.');
    if (system.isCapCutRunning()) throw new Error('Close CapCut first, then try again. Nothing was changed.');
    forgetRun(video, 'edit');
    const slot = trashDraft(draft);
    const made = await createCapCutDraft(draft, 'longform');
    if (!made.created) throw new Error(`The old CapCut project is in ${slot}, but a new one couldn't be made: ${made.message}`);
  } else {
    forgetRun(video, 'edit');
  }
  return startEdit(video);
}

export function clearPiece(video: string, piece: string) {
  forgetRun(video, pieceJob(video, piece).job);
}

export function stopPiece(video: string, piece: string): ClaudeRun | null {
  return stopRun(video, pieceJob(video, piece).job);
}

/** Kept for the old page's calls: a short's conversation and its metadata. */
export function metadataRun(video: string, short: string): ClaudeRun | null {
  shortId(short);
  return pieceRun(video, short);
}

export function writeShortMetadata(video: string, short: string): ClaudeRun {
  shortId(short);
  return writePieceMetadata(video, short);
}

// A small file beside the plan, so it lives in Drive with the video. Every short's metadata links to this.
function longformUrlFile(video: string): string {
  if (!video) throw new Error('No video given.');
  return safeResolve('projects', path.join(video, 'Shorts', 'Longform URL.txt'));
}

/**
 * The longform's YouTube address. The one place to set it is the longform's "YouTube upload & settings": the video
 * linked there wins. Shorts\Longform URL.txt, from an earlier version of the page, is the fallback.
 */
export function readLongformUrl(video: string): string | null {
  const linked = uploadsFor(path.posix.join(video, 'Longform')).find((j) => j.status === 'done' && j.videoId);
  if (linked?.videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(linked.videoId)}`;
  try {
    return fs.readFileSync(longformUrlFile(video), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Saves the longform's YouTube address. Empty clears it. Anything but a YouTube address is refused. */
export function saveLongformUrl(video: string, value: unknown) {
  const url = String(value ?? '').trim();
  if (url && !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+$/.test(url)) {
    throw new Error("That isn't a YouTube address. It should start with https://www.youtube.com/ or https://youtu.be/.");
  }
  const file = longformUrlFile(video);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, url);
}

// ---- What the page shows ---------------------------------------------------------

export interface ShortsOverview {
  plan: ShortsPlan | null;
  /** Why the plan can't be read. It's reported beside the run, so Propose shorts stays usable. */
  planError: string | null;
  /** The conversation about the list. */
  run: ClaudeRun | null;
  /** The conversation of each short that's been made, by its number. */
  builds: Record<string, ClaudeRun>;
  exportFile: string | null;
  retention: { path: string; version: number } | null;
  longformUrl: string | null;
  /** CapCut projects a short could be copied from, best guess first. */
  drafts: string[];
}

export function shortsOverview(video: string): ShortsOverview {
  let plan: ShortsPlan | null = null;
  let planError: string | null = null;
  try {
    plan = readPlan(video);
  } catch (e) {
    planError = e instanceof Error ? e.message : String(e);
  }
  const builds: Record<string, ClaudeRun> = {};
  for (const s of [...(plan?.shorts ?? []), ...(plan?.rejected ?? [])]) {
    const build = s.made ? getRun(video, `short-${s.id}`) : null;
    if (build) builds[s.id] = build;
  }
  let drafts: string[] = [];
  try {
    if (config.capcutDraftsDir) drafts = draftsForVideo(video);
  } catch {
    // A folder without a number at the start of its name has no matching CapCut projects.
  }
  return {
    plan,
    planError,
    run: getRun(video, 'shorts'),
    builds,
    exportFile: latestExport(video),
    retention: retentionInfo(video),
    longformUrl: readLongformUrl(video),
    drafts,
  };
}
