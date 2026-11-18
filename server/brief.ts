// "Write Brief": the thumbnail and title brief for one video or Short, by three AIs in turn (see the
// thumbnails-and-titles skill, "Writing the brief"):
//   1. Claude reads the source and writes the brief, using vidIQ for research.
//   2. ChatGPT reads the source and the brief, and adds its review.
//   3. Gemini does the same.
//   4. Claude picks the top 3 title and thumbnail pairs, saved as Picks.json for the page to show.
// They run in turn whatever AI is picked at the top of the app. The AIs only answer: HeartQuarters writes
// Packaging\Drafts\Brief.md from their answers, so no AI edits John's files. An existing Brief.md is kept, renamed
// with its date and time. Jobs live only in the engine's memory, like conversations.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import { AI_NAMES, aiCommand, type AiId } from './ai.js';
import { appDir, config, safeResolve } from './config.js';
import { CHOICE_FILE, DRAFTS_FOLDER, PICKS_FILE, parsePicks, readChoice, readPicks, type BriefChoice, type BriefPick } from './projects.js';
import { decodeReference, isShort } from './thumbnails.js';
import { appendText, makeFolder, moveFile, readable, readText, writable, writeFile } from './safe-files.js';

export interface BriefSource {
  kind: 'transcript' | 'script';
  /** Relative to the Video Projects folder, with forward slashes. */
  path: string;
}

export interface BriefStep {
  ai: AiId;
  name: string;
  role: 'writes' | 'reviews' | 'picks';
  state: 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
  error?: string;
}

export interface BriefJob {
  piece: string;
  status: 'running' | 'done' | 'failed';
  source: BriefSource;
  steps: BriefStep[];
  startedAt: string;
  /** The earlier Brief.md's new name, when there was one. */
  kept?: string;
  error?: string;
}

/** Asks one AI one question in `cwd` and gives back its answer. Real AIs in askAi; tests pass a fake. */
/** Asks one AI. `images` are screenshots John pasted; ChatGPT gets them attached (the others open them as files). */
export type AskAi = (ai: AiId, prompt: string, cwd: string, images?: string[]) => Promise<string>;

const BRIEF_FILE = 'Brief.md';
/** Each vidIQ call costs John credits, so Claude is told to keep to a few. */
const VIDIQ_CALLS = 4;
/** vidIQ's research tools only: nothing that could change the channel. */
const VIDIQ_TOOLS = ['keyword_research', 'youtube_search', 'outliers', 'title_thumbnail_wins', 'similar_thumbnails', 'user_videos', 'channel_analytics'].map(
  (t) => `mcp__claude_ai_vidIQ_for_Claude__vidiq_${t}`,
);
const ONE_RUN_MS = 20 * 60 * 1000;

// ---- The source: the transcript, or before recording, the script --------------------------------------

/** An .srt file's words only: no numbers or times. */
export function srtToText(srt: string): string {
  return srt
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->'))
    .map((l) => l.trim())
    .join(' ');
}

function rel(full: string): string {
  return path.relative(config.videoProjectsDir, full).split(path.sep).join('/');
}

function filesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Which file the brief is made from: the transcript in Subtitles\ (the -captions.txt, else an .srt, else another
 * .txt), or with none, the newest script in the piece's folder (a file with "script" in its name: .docx, .md or .txt).
 */
export function findSource(pieceDir: string): { kind: BriefSource['kind']; full: string } | null {
  const subs = path.join(pieceDir, 'Subtitles');
  const subFiles = filesIn(subs);
  const pick = subFiles.find((f) => /-captions\.txt$/i.test(f)) ?? subFiles.find((f) => /\.srt$/i.test(f)) ?? subFiles.find((f) => /\.txt$/i.test(f));
  if (pick) return { kind: 'transcript', full: path.join(subs, pick) };
  const scripts = filesIn(pieceDir)
    .filter((f) => /script/i.test(f) && /\.(docx|md|txt)$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(pieceDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return scripts.length ? { kind: 'script', full: scripts[0] } : null;
}

/** The source as plain text. */
export async function readSource(full: string): Promise<string> {
  readable(full); // the transcript or script really is inside Video Projects, even through a shortcut (code review #2)
  if (/\.docx$/i.test(full)) return (await mammoth.extractRawText({ path: full })).value;
  const text = readText(full).replace(/^﻿/, '');
  return /\.srt$/i.test(full) ? srtToText(text) : text;
}

/** The piece's folder, checked to be inside the video projects. */
function pieceFolder(piece: string): string {
  if (!piece) throw new Error('No video given.');
  const dir = safeResolve('projects', piece);
  if (!fs.existsSync(path.join(dir, 'Packaging'))) throw new Error(`"${piece}" has no Packaging folder.`);
  return dir;
}

/** For the page, before starting: which file the brief would be made from, or null. */
export function briefSource(piece: string): BriefSource | null {
  const found = findSource(pieceFolder(piece));
  return found ? { kind: found.kind, path: rel(found.full) } : null;
}

/** Provide timestamps only when there is one unambiguous timed subtitle file for this piece. */
function copySourceTimings(pieceDir: string, work: string): void {
  const subs = path.join(pieceDir, 'Subtitles'); const files = filesIn(subs).filter(f => /\.(srt|vtt)$/i.test(f));
  if (files.length === 1) fs.copyFileSync(readable(path.join(subs, files[0])), path.join(work, `source-timings${path.extname(files[0]).toLowerCase()}`));
}

// ---- What each AI is asked -----------------------------------------------------------------------------

function skillFile(name: string): string {
  return path.join(config.skillsDir, 'HMF_Skills', name, 'SKILL.md');
}

const NOTES_NOTE = "John's notes for this brief (what he wants, what he doesn't like about the current thumbnail or title, which version is on YouTube) and any research he pasted from Ask Studio or vidIQ are in notes.txt in the current folder. Read them and follow them.";

const READ_SKILLS = () =>
  `First read the skills "${skillFile('channel-basics')}" and "${skillFile('thumbnails-and-titles')}" (they say Claude where they mean any AI).`;

/** For a Short: its cover is vertical, and it's compared with other Shorts, not longform thumbnails. */
export function shortNote(piece: string): string[] {
  if (!isShort(piece)) return [];
  return [
    `This video is a YouTube Short (vertical, 9:16). Plan its cover, not a wide thumbnail: follow the skill's rules for a Shorts cover (2160 x 3840, nothing important in the top tenth, which the Shorts feed crops off, the bottom fifth or by the right edge, where the app's buttons are). Its title is the Short's title. For "Recent thumbnails", look at the newest few Shorts' covers (each Shorts folder's Packaging, newest version) rather than longform thumbnails.`,
  ];
}

export function writerPrompt(pieceName: string, source: BriefSource, hasNotes: boolean, today: string): string {
  return [
    `Write a YouTube packaging brief for the Heart Mind Fusion video "${pieceName}", following the thumbnails-and-titles skill, section "Writing the brief". ${READ_SKILLS()}`,
    ...shortNote(pieceName),
    `The source is the video's ${source.kind}, copied into source.txt in the current folder (from ${source.path}). Read all of it.`,
    ...(hasNotes ? [NOTES_NOTE] : []),
    `Research with vidIQ, using at most ${VIDIQ_CALLS} vidIQ tool calls in total, because each costs John credits: for example keyword research for the main search words and one YouTube search for competing videos. If vidIQ isn't available, write the brief anyway and say so.`,
    CATEGORIES_NOTE(),
    `For "Recent thumbnails", look in "${config.videoProjectsDir}": the newest few numbered video folders, each Longform\\Packaging's newest version (its YouTube.md and thumbnail). Which version is on YouTube is written in each version's Notes.md ("On YouTube: ..."); don't assume the newest one is.`,
    `Include proposed YouTube descriptions, tags, hashtags and pinned comments. For longform, when source-timings.srt or source-timings.vtt exists, use its timestamps to include accurate chapters in the proposed description. If neither file exists, omit chapters. Keep claims grounded in the source and do not invent timestamps. Put hashtags inside the proposed description.`,
    'For each thumbnail idea, put the complete suggested expression on its own line beginning "Expression:", including category paths and the detailed look to photograph.',
    `Today is ${today}. Don't create or change any file. Reply with only the brief in Markdown, starting with the line "# Brief:", in the skill's format, ending with the empty "## John's notes" section.`,
  ].join('\n\n');
}

export function reviewerPrompt(name: string, source: BriefSource, hasNotes = false, piece = ''): string {
  return [
    `Review a thumbnail and title brief for the Heart Mind Fusion channel, following the thumbnails-and-titles skill, section "Writing the brief". ${READ_SKILLS()}`,
    ...shortNote(piece),
    `Read all of the video's ${source.kind}, in source.txt in the current folder, then the brief, in brief.md in the current folder (with any earlier reviews at its end).`,
    ...(hasNotes ? [NOTES_NOTE] : []),
    CATEGORIES_NOTE(),
    `Don't create or change any file, and don't make images. Reply with only your review in Markdown, starting with the line "## Review: ${name}":`,
    '- your ranking of the title options, best first, one line each on why;',
    '- your ranking of the thumbnail ideas, one line each;',
    '- what is weak or wrong in the brief, and why;',
    '- at least one title and one thumbnail idea of your own (text, expression categories from the expressions library, background and supporting image, why a stranger would click, 30-second check), different from the ones in the brief.',
    'For each thumbnail idea of your own, put the complete suggested expression on its own line beginning "Expression:", including category paths and the detailed look to photograph.',
  ].join('\n');
}

/** The part of an AI's answer from `heading` on: anything it said before that is dropped. */
export function fromHeading(answer: string, heading: RegExp, name: string): string {
  const m = heading.exec(answer);
  if (!m) throw new Error(`${name}'s answer wasn't in the expected form.`);
  return answer.slice(m.index).trim();
}

// ---- Running the AIs --------------------------------------------------------------------------------------

/**
 * The reason an AI gives in its answer when it stops with an error and says nothing else, such as Claude's
 * "Failed to authenticate: OAuth session expired" (it puts that in its JSON answer). A sign-in problem says how to fix it.
 */
export function errorInAnswer(out: string): string {
  let reason = '';
  try {
    const answer = JSON.parse(out) as { is_error?: boolean; result?: unknown };
    // Only Claude answers in this JSON form, so the sign-in advice is Claude's.
    if (answer.is_error && typeof answer.result === 'string') reason = answer.result;
    if (/authenticat|oauth/i.test(reason)) reason += ' Sign in again: run claude in a terminal and type /login.';
  } catch {
    reason = out.trim().split('\n').slice(-3).join(' ').slice(0, 500);
  }
  return reason;
}

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err = (err + c).slice(-2000)));
    const timer = setTimeout(() => child.kill(), ONE_RUN_MS);
    child.on('error', (e) => reject(new Error(`Couldn't start it: ${e.message}`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-3).join(' ') || errorInAnswer(out) || `It stopped (exit code ${code}).`));
    });
  });
}

/** The real AIs, read-only: none of them may change a file. */
export const askAi: AskAi = async (ai, prompt, cwd, images = []) => {
  const [cmd, ...pre] = aiCommand(ai);
  if (ai === 'claude') {
    // Claude.ai's connectors (vidIQ) are only loaded in a background run when asked for.
    const out = await run(
      cmd,
      [...pre, '-p', prompt, '--output-format', 'json', '--permission-mode', 'default', '--allowedTools', 'Read', 'Glob', 'Grep', 'Skill', ...VIDIQ_TOOLS, '--add-dir', config.skillsDir, config.videoProjectsDir],
      cwd,
      { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'true' },
    );
    const result = JSON.parse(out) as { is_error?: boolean; result?: string };
    if (result.is_error) throw new Error(errorInAnswer(out) || 'Claude stopped with an error.');
    return result.result ?? '';
  }
  if (ai === 'codex') {
    const answer = path.join(cwd, 'chatgpt-answer.md');
    await run(cmd, [...pre, 'exec', '--skip-git-repo-check', '-s', 'read-only', '-o', answer, prompt, ...images.flatMap((i) => ['-i', i])], cwd);
    return fs.readFileSync(answer, 'utf8');
  }
  const settings = { toolPermission: 'proceed-in-sandbox', enableTerminalSandbox: true, permissions: { allow: ['read_file(*)'] } };
  return run(cmd, [...pre, '-p', prompt, '--output-format', 'text', '--sandbox', '--add-dir', cwd, '--settings', JSON.stringify(settings), '--print-timeout', '1200s'], cwd);
};

// ---- The job ----------------------------------------------------------------------------------------------

const jobs = new Map<string, BriefJob>();

export function getBrief(piece: string): BriefJob | null {
  return jobs.get(piece) ?? null;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** Renames an existing Brief.md (or Picks.json) to "Brief - <date time>.md", never over another file. Returns the new name. */
function keepOld(drafts: string, fileName: string, when: Date): string | undefined {
  const file = path.join(drafts, fileName);
  if (!fs.existsSync(file)) return undefined;
  const { name: base, ext } = path.parse(fileName);
  let name = `${base} - ${stamp(when)}${ext}`;
  for (let n = 2; fs.existsSync(path.join(drafts, name)); n++) name = `${base} - ${stamp(when)} (${n})${ext}`;
  moveFile(file, path.join(drafts, name));
  return name;
}

/** The expressions library's categories, as "Category > Sub" (two levels of folders), so the AIs name real ones. */
export function expressionCategories(root = config.expressionsDir): string[] {
  const entries = (d: string) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const dirs = (d: string) => entries(d).filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).map((e) => e.name).sort();
  // A category counts only if it has photos (in it or below it). "_Name.png" is the category's reference picture, not a photo.
  const hasPhotos = (d: string): boolean =>
    entries(d).some((e) => (e.isFile() && IMAGE_RE.test(e.name) && !e.name.startsWith('_')) || (e.isDirectory() && !/^[._]/.test(e.name) && hasPhotos(path.join(d, e.name))));
  return dirs(root).flatMap((c) => dirs(path.join(root, c)).filter((s) => hasPhotos(path.join(root, c, s))).map((s) => `${c} > ${s}`));
}

const CATEGORIES_NOTE = () => {
  const list = expressionCategories();
  return list.length ? `For expressions, name only categories that exist in John's expressions library and have photos: ${list.join('; ')}.` : '';
};

export function picksPrompt(hasNotes: boolean): string {
  return [
    `In brief.md in the current folder is a thumbnail and title brief for a Heart Mind Fusion video, with reviews by other AIs at its end. Read it, and the skill "${skillFile('thumbnails-and-titles')}".`,
    ...(hasNotes ? [NOTES_NOTE] : []),
    CATEGORIES_NOTE(),
    'Choose the top 3 title and thumbnail pairs, best first. Favour ideas the reviewers agreed on, follow John\'s notes, and keep to the skill\'s hard rules (paid off in the first 30 seconds, the most positive true expression, gaze toward the centre, nothing in the bottom-right corner). A pair may combine a title from one place with a thumbnail from another.',
    'For each pick include a complete description, comma-separated tags and a pinned comment grounded in the source and the brief. Read source.txt if it exists. For longform, if source-timings.srt or source-timings.vtt exists, read it and include accurate chapters based on those timestamps in the description; otherwise omit chapters. Put hashtags inside the description. Do not invent facts or timestamps.',
    "The description's first sentence must contain one of that pick's own tags word for word (ignoring capitals), within the first 200 characters, because vidIQ scores the description by this; a related word isn't enough. For example, with the tag \"Memory Condition\", open with \"With my memory condition, …\" rather than \"Sometimes I meet somebody…\". Check every pick for this before replying.",
    "Don't create or change any file, and don't use vidIQ. Reply with only this JSON, nothing before or after it:",
    '{"picks":[{"title":"the exact title","thumbnailText":"THE EXACT WORDS ON THE THUMBNAIL","accent":"the word in the accent colour","expression":"one to three of the library categories above, then a few words on the look, e.g. Composure > Calm (open eyes, slight smile)","background":"the background and any supporting image","why":"one or two sentences: why a stranger would click, and how the first 30 seconds pay it off","backedBy":["Claude","ChatGPT","Gemini"],"description":"complete YouTube description including hashtags and accurate chapters only when available","tags":"comma-separated tags","pinnedComment":"proposed pinned comment"}]}',
  ].join('\n\n');
}

/** The picks in an AI's answer: the JSON between its first { and last }. */
export function picksFromAnswer(answer: string): BriefPick[] {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  let picks: BriefPick[] | null = null;
  try {
    picks = start >= 0 && end > start ? parsePicks(JSON.parse(answer.slice(start, end + 1))) : null;
  } catch {
    picks = null;
  }
  if (!picks) throw new Error("Claude's top 3 weren't in the expected form.");
  return picks;
}

/** The last step: Claude picks the top 3 pairs, saved as Picks.json (an earlier one is kept, renamed). */
async function runPicks(step: BriefStep, ask: AskAi, work: string, hasNotes: boolean, drafts: string, when: Date, shots: string[] = []): Promise<void> {
  step.state = 'working';
  try {
    const picks = picksFromAnswer(await ask('claude', picksPrompt(hasNotes), work, shots));
    if (picks.some(p => !p.description || !p.tags || !p.pinnedComment)) throw new Error('The generated package is missing a description, tags or pinned comment. Try Pick Top 3 Again.');
    keepOld(drafts, PICKS_FILE, when);
    writeFile(path.join(drafts, PICKS_FILE), JSON.stringify({ picks }, null, 2) + '\n');
    step.state = 'done';
  } catch (e) {
    step.state = 'failed';
    step.error = e instanceof Error ? e.message : String(e);
  }
}

// ---- Screenshots John pasted into the brief's boxes ------------------------------------------------------------

/** Which box an image was pasted into, as it's named for the AIs and in its file name. */
export const RESEARCH_BOXES = { notes: "John's notes", vidiq: 'vidIQ', studio: 'Ask Studio' } as const;
export type ResearchBox = keyof typeof RESEARCH_BOXES;
/** Pasted images, base64, by the box they were pasted into. */
export type ResearchImages = Partial<Record<ResearchBox, unknown>>;
const MAX_RESEARCH_IMAGES = 12;
export interface SavedShot { box: ResearchBox; file: string }

/**
 * Saves the pasted screenshots in Packaging\Drafts\Research\<date time>\ ("vidIQ 1.png", "Ask Studio 1.png"...), as
 * a record of what the brief was based on, and copies them into the AIs' work folder. Returns the work copies.
 */
export function saveResearchImages(drafts: string, work: string, images: ResearchImages | undefined, when: Date): SavedShot[] {
  const lists = (Object.keys(RESEARCH_BOXES) as ResearchBox[]).map((box) => ({ box, list: Array.isArray(images?.[box]) ? (images![box] as unknown[]) : [] }));
  const count = lists.reduce((n, l) => n + l.list.length, 0);
  if (!count) return [];
  if (count > MAX_RESEARCH_IMAGES) throw new Error(`Paste at most ${MAX_RESEARCH_IMAGES} images in all.`);
  const decoded = lists.map((l) => ({ box: l.box, images: l.list.map(decodeReference) })); // all checked before anything is written
  let record = path.join(drafts, 'Research', stamp(when));
  for (let n = 2; fs.existsSync(record); n++) record = path.join(drafts, 'Research', `${stamp(when)} (${n})`);
  makeFolder(record);
  fs.mkdirSync(path.join(work, 'research'), { recursive: true });
  return decoded.flatMap(({ box, images: list }) =>
    list.map((img, i) => {
      const name = `${RESEARCH_BOXES[box]} ${i + 1}${img.ext}`;
      writeFile(path.join(record, name), img.data, { flag: 'wx' });
      const file = path.join(work, 'research', name);
      fs.writeFileSync(file, img.data);
      return { box, file };
    }),
  );
}

/** notes.txt for the AIs: John's text, then the screenshots, listed under the box they were pasted into. */
export function notesWithImages(notes: string, shots: SavedShot[]): string {
  if (!shots.length) return notes.trim();
  const groups = (Object.keys(RESEARCH_BOXES) as ResearchBox[])
    .map((box) => ({ box, files: shots.filter((s) => s.box === box).map((s) => s.file) }))
    .filter((g) => g.files.length);
  return [
    notes.trim(),
    [
      'Screenshots John pasted. Open and read each one: they may show suggested titles and tags with their scores, or other research.',
      ...groups.map((g) => `${g.box === 'notes' ? 'With his notes' : `From ${RESEARCH_BOXES[g.box]}`}:\n${g.files.map((f) => `- ${f}`).join('\n')}`),
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** A fresh folder in the app's data where the AIs work, with copies of what they read. */
function workFolder(piece: string): string {
  const workRoot = process.env.VITEST ? path.join(os.tmpdir(), 'hq-brief-tests') : path.join(appDir, 'data', 'briefs');
  const work = path.join(workRoot, createHash('sha1').update(piece).digest('hex').slice(0, 12));
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  return work;
}

/** Puts who took part on the brief's "Made from" line. */
export function noteWhoTookPart(brief: string, steps: BriefStep[]): string {
  const reviewed = steps.filter((s) => s.role === 'reviews' && s.state === 'done').map((s) => s.name);
  const by = `By: Claude (brief)${reviewed.length ? `, ${reviewed.join(' and ')} (reviews)` : ''}.`;
  return brief.replace(/^(Made from:.*?)(?:\s*By:.*)?$/m, (_, start: string) => `${start} ${by}`);
}

/**
 * Starts the brief for one piece (e.g. "022 - Worth Telling Them/Longform"). Returns the job at once; `finished`
 * settles when all three AIs are done. `notes` is what John typed or pasted for the AIs, if anything.
 */
export async function startBrief(piece: string, rawNotes: string, ask: AskAi = askAi, images?: ResearchImages): Promise<{ job: BriefJob; finished: Promise<void> }> {
  if (jobs.get(piece)?.status === 'running') throw new Error('A brief is already being written for this video.');
  const dir = pieceFolder(piece);
  const found = findSource(dir);
  if (!found) throw new Error('There is no transcript in Subtitles and no script (a file with "script" in its name) to make the brief from.');
  const source: BriefSource = { kind: found.kind, path: rel(found.full) };

  // The job is registered before anything waits, so a second click can't start another brief for this video meanwhile.
  const step = (ai: AiId, role: BriefStep['role']): BriefStep => ({ ai, name: AI_NAMES[ai], role, state: 'waiting' });
  const job: BriefJob = {
    piece,
    status: 'running',
    source,
    steps: [step('claude', 'writes'), step('codex', 'reviews'), step('gemini', 'reviews'), step('claude', 'picks')],
    startedAt: new Date().toISOString(),
  };
  const before = jobs.get(piece);
  jobs.set(piece, job);

  let work: string;
  let shots: string[];
  let notes: string;
  try {
    writable(path.join(dir, 'Packaging', DRAFTS_FOLDER, BRIEF_FILE));
    work = workFolder(piece);
    fs.writeFileSync(path.join(work, 'source.txt'), await readSource(found.full));
    if (found.kind === 'transcript') copySourceTimings(dir, work);
    const saved = saveResearchImages(path.join(dir, 'Packaging', DRAFTS_FOLDER), work, images, new Date());
    shots = saved.map((s) => s.file);
    notes = notesWithImages(rawNotes, saved);
    if (notes.trim()) fs.writeFileSync(path.join(work, 'notes.txt'), notes.trim() + '\n');
  } catch (e) {
    // Getting ready failed: the video is free again, showing whatever brief job it had before.
    if (before) jobs.set(piece, before);
    else jobs.delete(piece);
    throw e;
  }

  const finished = (async () => {
    const drafts = path.join(dir, 'Packaging', DRAFTS_FOLDER);
    const brief = path.join(drafts, BRIEF_FILE);
    const [writer, ...rest] = job.steps;
    const reviewers = rest.filter((s) => s.role === 'reviews');
    const picker = rest.find((s) => s.role === 'picks')!;
    const when = new Date();
    try {
      writer.state = 'working';
      const text = fromHeading(await ask('claude', writerPrompt(piece, source, !!notes.trim(), stamp(new Date()).slice(0, 10)), work, shots), /^# Brief:/m, 'Claude');
      makeFolder(drafts);
      job.kept = keepOld(drafts, BRIEF_FILE, when);
      writeFile(brief, text + '\n');
      fs.writeFileSync(path.join(work, 'brief.md'), text + '\n');
      writer.state = 'done';
    } catch (e) {
      writer.state = 'failed';
      writer.error = e instanceof Error ? e.message : String(e);
      for (const r of rest) r.state = 'skipped';
      job.status = 'failed';
      job.error = "Claude couldn't write the brief, so there was nothing to review. Any earlier Brief.md is untouched.";
      return;
    }
    for (const r of reviewers) {
      r.state = 'working';
      try {
        const review = fromHeading(await ask(r.ai, reviewerPrompt(r.name, source, !!notes.trim(), piece), work, shots), new RegExp(`^## Review: ${r.name}`, 'm'), r.name);
        appendText(brief, `\n${review}\n`);
        fs.appendFileSync(path.join(work, 'brief.md'), `\n${review}\n`);
        r.state = 'done';
      } catch (e) {
        r.state = 'failed';
        r.error = e instanceof Error ? e.message : String(e);
      }
    }
    writeFile(brief, noteWhoTookPart(readText(brief), job.steps));
    await runPicks(picker, ask, work, !!notes.trim(), drafts, when, shots);
    job.status = 'done';
  })().catch((e) => {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
  });
  return { job, finished };
}

/** Pick Top 3 for a brief written before there were picks (or again): only the last step, on the Brief.md there. */
export async function startPicks(piece: string, rawNotes: string, ask: AskAi = askAi, images?: ResearchImages): Promise<{ job: BriefJob; finished: Promise<void> }> {
  if (jobs.get(piece)?.status === 'running') throw new Error('A brief is already being written for this video.');
  const dir = pieceFolder(piece);
  const drafts = path.join(dir, 'Packaging', DRAFTS_FOLDER);
  const brief = path.join(drafts, BRIEF_FILE);
  if (!fs.existsSync(brief)) throw new Error('There is no Brief.md to pick from yet. Write the brief first.');
  const found = findSource(dir);
  const work = workFolder(piece);
  fs.copyFileSync(readable(brief), path.join(work, 'brief.md'));
  if (found) fs.writeFileSync(path.join(work, 'source.txt'), await readSource(found.full));
  if (found?.kind === 'transcript') copySourceTimings(dir, work);
  const saved = saveResearchImages(drafts, work, images, new Date());
  const shots = saved.map((s) => s.file);
  const notes = notesWithImages(rawNotes, saved);
  if (notes.trim()) fs.writeFileSync(path.join(work, 'notes.txt'), notes.trim() + '\n');
  const job: BriefJob = {
    piece,
    status: 'running',
    source: found ? { kind: found.kind, path: rel(found.full) } : { kind: 'transcript', path: '' },
    steps: [{ ai: 'claude', name: AI_NAMES.claude, role: 'picks', state: 'waiting' }],
    startedAt: new Date().toISOString(),
  };
  jobs.set(piece, job);
  const finished = runPicks(job.steps[0], ask, work, !!notes.trim(), drafts, new Date(), shots).then(() => {
    job.status = job.steps[0].state === 'done' ? 'done' : 'failed';
  });
  return { job, finished };
}

// ---- John's choice: one of the top 3, then a photo for it -------------------------------------------------

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

/** Choose: saves which of the top 3 John chose as Choice.json, with no photo yet. Choosing again replaces it. */
export function chooseBriefPick(piece: string, index: unknown): BriefChoice {
  const drafts = path.join(pieceFolder(piece), 'Packaging', DRAFTS_FOLDER);
  const picks = readPicks(path.join(drafts, PICKS_FILE));
  if (!picks) throw new Error('There are no top 3 picks to choose from yet.');
  if (typeof index !== 'number' || !Number.isInteger(index) || !picks[index]) throw new Error('That pick is not one of the top 3.');
  const choice: BriefChoice = { pick: picks[index], index, photo: null };
  writeFile(path.join(drafts, CHOICE_FILE), JSON.stringify(choice, null, 2) + '\n');
  return choice;
}

/** Picks the expressions-library photo for the chosen pair. The photo must be an image inside the library. */
export function chooseBriefPhoto(piece: string, photo: unknown): BriefChoice {
  const drafts = path.join(pieceFolder(piece), 'Packaging', DRAFTS_FOLDER);
  const choice = readChoice(path.join(drafts, CHOICE_FILE));
  if (!choice) throw new Error('Choose one of the top 3 first.');
  const rel = String(photo ?? '');
  const full = safeResolve('expressions', rel);
  if (!IMAGE_RE.test(rel) || !fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("That photo isn't in the expressions library.");
  choice.photo = rel.replace(/\\/g, '/');
  writeFile(path.join(drafts, CHOICE_FILE), JSON.stringify(choice, null, 2) + '\n');
  return choice;
}
