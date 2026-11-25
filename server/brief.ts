// "Write Brief": the thumbnail and title brief for one video or Short, by AIs in turn (see the
// thumbnails-and-titles skill, "Writing the brief"). John chooses each AI (a BriefPlan):
//   1. The first AI reads the source and writes the brief, with vidIQ research if John ticked it.
//   2. Up to two more AIs read the source and the brief, and each adds its review (also with vidIQ if ticked).
//   3. The summary AI picks the top 3 title and thumbnail pairs, saved as Picks.json for the page to show.
// The default plan is the old fixed order: Claude (vidIQ), ChatGPT, Gemini, then Claude picks. The AIs only answer: HeartQuarters writes
// Packaging\Drafts\Brief.md from their answers, so no AI edits John's files. An existing Brief.md is kept, renamed
// with its date and time. Jobs live only in the engine's memory, like conversations.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import { AI_NAMES, CLAUDE_VIDIQ_ENV, CLAUDE_VIDIQ_TOOLS, CODEX_STANDARD_TIER, aiCommand, aiModelArgs, codexVidiq, geminiVidiqAllow, isAiId, runAiProcess, type AiId } from './ai.js';
import { stageLongformThumbnails, thumbnailComparisonNote } from './brief-thumbnail-comparison.js';
import { appDir, config, safeResolve } from './config.js';
import { THUMBNAIL_PHOTO_ATTRIBUTES } from './expression-attribute-vocabulary.js';
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
  /** Whether this AI may research with vidIQ. */
  vidiq?: boolean;
  state: 'waiting' | 'working' | 'done' | 'failed' | 'skipped';
  error?: string;
}

/** Who does the brief: `steps[0]` writes it, any others review it in turn, then `picker` picks the top 3. */
export interface BriefPlan {
  steps: { ai: AiId; vidiq: boolean }[];
  picker: AiId;
}

export const DEFAULT_BRIEF_PLAN: BriefPlan = {
  steps: [{ ai: 'claude', vidiq: true }, { ai: 'codex', vidiq: false }, { ai: 'gemini', vidiq: false }],
  picker: 'claude',
};

const MAX_BRIEF_STEPS = 3;

/** The plan the page sent, checked. Nothing sent means the default plan. */
export function parseBriefPlan(raw: unknown): BriefPlan {
  if (raw === undefined || raw === null) return DEFAULT_BRIEF_PLAN;
  const r = raw as { steps?: unknown; picker?: unknown };
  if (!Array.isArray(r.steps) || !r.steps.length || r.steps.length > MAX_BRIEF_STEPS) throw new Error(`Choose 1 to ${MAX_BRIEF_STEPS} AIs for the brief.`);
  const steps = r.steps.map((s: unknown) => {
    const step = s as { ai?: unknown; vidiq?: unknown };
    if (!isAiId(step?.ai)) throw new Error('Choose Claude, ChatGPT, or Gemini for each step of the brief.');
    return { ai: step.ai, vidiq: step.vidiq === true };
  });
  if (!isAiId(r.picker)) throw new Error('Choose which AI picks the top 3.');
  return { steps, picker: r.picker };
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

/**
 * Asks one AI one question in `cwd` and gives back its answer. Real AIs in askAi; tests pass a fake. `images` are
 * screenshots John pasted; ChatGPT gets them attached (the others open them as files). `vidiq` lets it use vidIQ's
 * research tools.
 */
export type AskAi = (ai: AiId, prompt: string, cwd: string, images?: string[], vidiq?: boolean) => Promise<string>;

const BRIEF_FILE = 'Brief.md';
/** Each vidIQ call costs John credits, so each AI is told to keep to a few. */
const VIDIQ_CALLS = 4;
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

/**
 * The same source as text, for the question John pastes into vidIQ and Ask Studio while the video isn't on YouTube
 * yet: neither tool can watch it then (John, 2026-11-18). Changes nothing.
 */
export async function briefSourceText(piece: string): Promise<(BriefSource & { text: string }) | null> {
  const found = findSource(pieceFolder(piece));
  return found ? { kind: found.kind, path: rel(found.full), text: (await readSource(found.full)).trim() } : null;
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

const TAG_RULES = 'Write at least 10 comma-separated YouTube tags in Title Case (ideally 10 to 15, always including "Heart Mind Fusion"), preserving acronyms such as SDAM and KKK. Choose specific topics, names, and natural phrases a viewer would type into YouTube search. Leave out quotes, dialogue, title hooks, and near-duplicates. Prefer relevant exact phrases with positive search volume or scores from vidIQ, and omit exact phrases reported at zero volume or score. Where metrics are unavailable, use plausible search terms and never invent scores.';

const PACKAGING_RULES = 'Put 3 to 5 lowercase hashtags on one line inside the description. If the video is about SDAM, the description must mention the downloadable guide (https://www.heartmindfusion.com/sdam-guide) and include the Eventbrite group link (https://www.eventbrite.com/e/sdam-support-group-registration-1992895106912), while the pinned comment must point only to the downloadable guide (https://www.heartmindfusion.com/sdam-guide). Leave AI disclosure lines out of the description; John handles those with checkboxes in HeartQuarters.';

export const THUMBNAIL_EXPRESSION_GUIDANCE = 'Choose a natural expression that fits the story. Avoid a strongly negative look when a more inviting expression also fits. Anger can fit a story about being consumed by rage. For a story about swinging between anger and joy, favor joy when it fits the concept and let the words or supporting image convey the contrast.';

const THUMBNAIL_CONCEPT_GUIDANCE = 'Give each thumbnail concept one supporting visual that helps tell this specific story, such as a prop, a recognizable setting, or a simple symbol. It should be recognizable at phone size and add meaning alongside John and the words. Describe where the portrait, supporting visual, and words sit, which element draws the eye first, and how the elements relate.';

const READ_SKILLS = () =>
  `First read the skills "${skillFile('channel-basics')}" and "${skillFile('thumbnails-and-titles')}" (they say Claude where they mean any AI).`;

/** For a Short: its cover is vertical, and it's compared with other Shorts, not longform thumbnails. */
export function shortNote(piece: string): string[] {
  if (!isShort(piece)) return [];
  return [
    `This video is a YouTube Short (vertical, 9:16). Plan its cover, not a wide thumbnail: follow the skill's rules for a Shorts cover (2160 x 3840, nothing important in the top tenth, which the Shorts feed crops off, the bottom fifth or by the right edge, where the app's buttons are). Its title is the Short's title. For "Thumbnail comparison", look at the newest few other Shorts' covers (each Shorts folder's Packaging, newest version). Treat any earlier cover for this Short as revision context.`,
  ];
}

/** What an AI is told about vidIQ: research within a budget, or don't use it at all. */
export function vidiqNote(vidiq: boolean, writing: boolean): string {
  if (!vidiq) return "Don't use vidIQ for this. Where keyword metrics aren't in the brief, notes or screenshots, say they are unavailable rather than guessing.";
  return writing
    ? `Research with vidIQ, using at most ${VIDIQ_CALLS} vidIQ tool calls in total, because each costs John credits. Prioritize keyword research for candidate tags. Record the exact phrases checked and the search volume or overall score vidIQ returns, including zero values, so the final picker can use them. If keyword metrics aren't available, write the brief anyway and say so.`
    : `You may check the brief's titles and tags with vidIQ, using at most ${VIDIQ_CALLS} vidIQ tool calls in total, because each costs John credits. Prefer phrases the brief hasn't checked yet. Record the exact phrases checked and the search volume or overall score vidIQ returns, including zero values, so the final picker can use them.`;
}

export function writerPrompt(pieceName: string, source: BriefSource, hasNotes: boolean, today: string, comparison = '', vidiq = true): string {
  return [
    `Write a YouTube packaging brief for the Heart Mind Fusion video "${pieceName}", following the thumbnails-and-titles skill, section "Writing the brief". ${READ_SKILLS()}`,
    ...shortNote(pieceName),
    `The source is the video's ${source.kind}, copied into source.txt in the current folder (from ${source.path}). Read all of it.`,
    ...(hasNotes ? [NOTES_NOTE] : []),
    vidiqNote(vidiq, true),
    CATEGORIES_NOTE(),
    ...(!isShort(pieceName) ? [thumbnailComparisonNote(comparison)] : []),
    `Include proposed YouTube descriptions, tags, hashtags and pinned comments. For longform, when source-timings.srt or source-timings.vtt exists, use its timestamps to include accurate chapters in the proposed description. If neither file exists, omit chapters. Keep claims grounded in the source and do not invent timestamps. Put hashtags inside the proposed description.`,
    TAG_RULES,
    PACKAGING_RULES,
    THUMBNAIL_EXPRESSION_GUIDANCE,
    THUMBNAIL_CONCEPT_GUIDANCE,
    'Give the thumbnail ideas different compositions. Vary the portrait crop and position, the location of the words, or which element leads the image.',
    'For each thumbnail idea, put the complete suggested expression on its own line beginning "Expression:", including category paths and the detailed look to photograph.',
    `Today is ${today}. Don't create or change any file. Reply with only the brief in Markdown, starting with the line "# Brief:", in the skill's format, ending with the empty "## John's notes" section.`,
  ].join('\n\n');
}

export function reviewerPrompt(name: string, source: BriefSource, hasNotes = false, piece = '', comparison = '', vidiq = false): string {
  return [
    `Review a thumbnail and title brief for the Heart Mind Fusion channel, following the thumbnails-and-titles skill, section "Writing the brief". ${READ_SKILLS()}`,
    ...shortNote(piece),
    `Read all of the video's ${source.kind}, in source.txt in the current folder, then the brief, in brief.md in the current folder (with any earlier reviews at its end).`,
    ...(hasNotes ? [NOTES_NOTE] : []),
    vidiqNote(vidiq, false),
    CATEGORIES_NOTE(),
    ...(piece && !isShort(piece) ? [thumbnailComparisonNote(comparison)] : []),
    THUMBNAIL_EXPRESSION_GUIDANCE,
    THUMBNAIL_CONCEPT_GUIDANCE,
    `Don't create or change any file, and don't make images. Reply with only your review in Markdown, starting with the line "## Review: ${name}":`,
    '- your ranking of the title options, best first, one line each on why;',
    '- your ranking of the thumbnail ideas, one line each;',
    '- what is weak or wrong in the brief, and why;',
    '- at least one fresh title and one thumbnail idea of your own (text, expression categories from the expressions library, composition and supporting visual, why a stranger would click, 30-second check). Give the thumbnail a different composition from the ideas in the brief.',
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

async function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, input?: string): Promise<string> {
  const res = await runAiProcess(cmd, args, { cwd, env, timeoutMs: ONE_RUN_MS, input });
  if (res.startError) throw new Error(`Couldn't start it: ${res.startError}`);
  if (res.code === 0) return res.stdout;
  if (res.timedOut) throw new Error('It timed out before finishing.');
  throw new Error(res.stderr.trim().split('\n').slice(-3).join(' ') || errorInAnswer(res.stdout) || `It stopped (exit code ${res.code}).`);
}

/** The real AIs, read-only: none of them may change a file. With `vidiq`, each may use vidIQ's research tools. */
export const askAi: AskAi = async (ai, prompt, cwd, images = [], vidiq = false) => {
  const [cmd, ...pre] = aiCommand(ai);
  const modelArgs = aiModelArgs(ai);
  if (ai === 'claude') {
    const out = await run(
      cmd,
      [...pre, '-p', prompt, ...modelArgs, '--output-format', 'json', '--permission-mode', 'default', '--allowedTools', 'Read', 'Glob', 'Grep', 'Skill', ...(vidiq ? CLAUDE_VIDIQ_TOOLS : []), '--add-dir', config.skillsDir, config.videoProjectsDir],
      cwd,
      vidiq ? { ...process.env, ...CLAUDE_VIDIQ_ENV } : undefined,
    );
    const result = JSON.parse(out) as { is_error?: boolean; result?: string };
    if (result.is_error) throw new Error(errorInAnswer(out) || 'Claude stopped with an error.');
    return result.result ?? '';
  }
  if (ai === 'codex') {
    const answer = path.join(cwd, 'chatgpt-answer.md');
    fs.rmSync(answer, { force: true }); // two ChatGPT steps share the folder: never return the earlier one's answer
    await run(cmd, [...pre, 'exec', '--skip-git-repo-check', ...CODEX_STANDARD_TIER, ...(vidiq ? codexVidiq(true) : []), '-c', 'model_reasoning_effort="low"', ...modelArgs, '-s', 'read-only', '-o', answer, '-', ...images.flatMap((i) => ['-i', i])], cwd, undefined, prompt); // the prompt via stdin: no command-line length limit
    return fs.readFileSync(answer, 'utf8');
  }
  const settings = { toolPermission: 'proceed-in-sandbox', enableTerminalSandbox: true, permissions: { allow: ['read_file(*)', ...geminiVidiqAllow(vidiq)] } };
  return run(cmd, [...pre, '-p', prompt, ...modelArgs, '--output-format', 'text', '--sandbox', '--add-dir', cwd, '--settings', JSON.stringify(settings), '--print-timeout', '1200s'], cwd);
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

/** The expressions library's categories, as "Category > Sub". Even empty folders can have tagged photos elsewhere. */
export function expressionCategories(root = config.expressionsDir): string[] {
  const entries = (d: string) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const dirs = (d: string) => entries(d).filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).map((e) => e.name).sort();
  return dirs(root).flatMap((c) => dirs(path.join(root, c)).map((s) => `${c} > ${s}`));
}

const CATEGORIES_NOTE = () => {
  const list = expressionCategories();
  return list.length ? `For expressions, use these categories from John's library. Choose the best fit for the idea. Photos tagged with an expression may be filed in other categories: ${list.join('; ')}.` : '';
};

export function picksPrompt(hasNotes: boolean, comparison = ''): string {
  return [
    `In brief.md in the current folder is a thumbnail and title brief for a Heart Mind Fusion video, with reviews by other AIs at its end. Read it, and the skill "${skillFile('thumbnails-and-titles')}".`,
    ...(hasNotes ? [NOTES_NOTE] : []),
    CATEGORIES_NOTE(),
    ...(comparison ? [thumbnailComparisonNote(comparison)] : []),
    'Choose the top 3 title and thumbnail pairs, best first. Favour ideas the reviewers agreed on and follow John\'s notes. Follow the thumbnail skill, including the 30-second payoff, gaze toward the centre or camera, and a clear bottom-right corner for longform. A pair may combine a title from one place with a thumbnail from another.',
    THUMBNAIL_EXPRESSION_GUIDANCE,
    THUMBNAIL_CONCEPT_GUIDANCE,
    'Make the top three easy to tell apart at phone size. Give each a distinct composition by varying the placement, scale, and visual relationship of the portrait, words, and supporting visual.',
    `Use photoAttributes only when a particular gaze or mouth position helps the concept. For example, use LookRight if John is on the left looking toward a prop on the right, or LookAtCamera if he is addressing the viewer. Left and right are the viewer's sides of the image. Use MouthOpen when an open mouth matters, and leave the array empty when any natural look that fits the expression will work. Allowed tags: ${THUMBNAIL_PHOTO_ATTRIBUTES.join(', ')}.`,
    'For each pick include a complete description, comma-separated tags and a pinned comment grounded in the source and the brief. Read source.txt if it exists. For longform, if source-timings.srt or source-timings.vtt exists, read it and include accurate chapters based on those timestamps in the description; otherwise omit chapters. Put hashtags inside the description. Do not invent facts or timestamps.',
    TAG_RULES,
    PACKAGING_RULES,
    'Use the keyword results recorded in the brief and any pasted research in notes.txt when available. A phrase appearing in a transcript, title, or review is not evidence of search demand.',
    "The description's first sentence must contain one of that pick's own tags word for word (ignoring capitals), within the first 200 characters, because vidIQ scores the description by this; a related word isn't enough. For example, with the tag \"Memory Condition\", open with \"With my memory condition, …\" rather than \"Sometimes I meet somebody…\". Check every pick for this before replying.",
    "Don't create or change any file, and don't use vidIQ. Reply with only this JSON, nothing before or after it:",
    '{"picks":[{"title":"the exact title","thumbnailText":"THE EXACT WORDS ON THE THUMBNAIL","accent":"the word in the accent colour","expression":"one to three of the library categories above, then a few words on the look, e.g. Composure > Calm (open eyes, slight smile)","photoAttributes":[],"background":"the composition, background, and story-specific supporting visual with its placement","why":"one or two sentences: why a stranger would click, and how the first 30 seconds pay it off","backedBy":["Claude","ChatGPT","Gemini"],"description":"complete YouTube description including hashtags and accurate chapters only when available","tags":"comma-separated tags","pinnedComment":"proposed pinned comment"}]}',
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
  if (!picks) throw new Error("The top 3 weren't in the expected form.");
  for (const pick of picks) {
    if (!pick.tags) continue;
    pick.tags = pick.tags.replace(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu, (word) =>
      word === word.toLowerCase() ? word.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()) : word);
  }
  return picks;
}

/** The last step: the summary AI picks the top 3 pairs, saved as Picks.json (an earlier one is kept, renamed). */
async function runPicks(step: BriefStep, ask: AskAi, work: string, hasNotes: boolean, drafts: string, when: Date, shots: string[], comparison: string): Promise<void> {
  step.state = 'working';
  try {
    const picks = picksFromAnswer(await ask(step.ai, picksPrompt(hasNotes, comparison), work, shots));
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
  const writer = steps.find((s) => s.role === 'writes')?.name ?? 'Claude';
  const reviewed = steps.filter((s) => s.role === 'reviews' && s.state === 'done').map((s) => s.name);
  const by = `By: ${writer} (brief)${reviewed.length ? `, ${reviewed.join(' and ')} (reviews)` : ''}.`;
  return brief.replace(/^(Made from:.*?)(?:\s*By:.*)?$/m, (_, start: string) => `${start} ${by}`);
}

/**
 * Starts the brief for one piece (e.g. "022 - Worth Telling Them/Longform"). Returns the job at once; `finished`
 * settles when all the AIs are done. `notes` is what John typed or pasted for the AIs, if anything.
 */
export async function startBrief(piece: string, rawNotes: string, ask: AskAi = askAi, images?: ResearchImages, plan: BriefPlan = DEFAULT_BRIEF_PLAN): Promise<{ job: BriefJob; finished: Promise<void> }> {
  if (jobs.get(piece)?.status === 'running') throw new Error('A brief is already being written for this video.');
  const dir = pieceFolder(piece);
  const found = findSource(dir);
  if (!found) throw new Error('There is no transcript in Subtitles and no script (a file with "script" in its name) to make the brief from.');
  const source: BriefSource = { kind: found.kind, path: rel(found.full) };

  // The job is registered before anything waits, so a second click can't start another brief for this video meanwhile.
  const step = (ai: AiId, role: BriefStep['role'], vidiq = false): BriefStep => ({ ai, name: AI_NAMES[ai], role, vidiq, state: 'waiting' });
  const job: BriefJob = {
    piece,
    status: 'running',
    source,
    steps: [...plan.steps.map((s, i) => step(s.ai, i === 0 ? 'writes' : 'reviews', s.vidiq)), step(plan.picker, 'picks')],
    startedAt: new Date().toISOString(),
  };
  const before = jobs.get(piece);
  jobs.set(piece, job);

  let work: string;
  let shots: string[];
  let notes: string;
  let comparison = '';
  try {
    writable(path.join(dir, 'Packaging', DRAFTS_FOLDER, BRIEF_FILE));
    work = workFolder(piece);
    fs.writeFileSync(path.join(work, 'source.txt'), await readSource(found.full));
    if (found.kind === 'transcript') copySourceTimings(dir, work);
    const saved = saveResearchImages(path.join(dir, 'Packaging', DRAFTS_FOLDER), work, images, new Date());
    shots = saved.map((s) => s.file);
    if (!isShort(piece)) {
      const thumbnails = stageLongformThumbnails(piece, work);
      comparison = thumbnails.context;
      shots.push(...thumbnails.images);
    }
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
      const text = fromHeading(await ask(writer.ai, writerPrompt(piece, source, !!notes.trim(), stamp(new Date()).slice(0, 10), comparison, !!writer.vidiq), work, shots, !!writer.vidiq), /^# Brief:/m, writer.name);
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
      job.error = `${writer.name} couldn't write the brief, so there was nothing to review. Any earlier Brief.md is untouched.`;
      return;
    }
    for (const r of reviewers) {
      r.state = 'working';
      try {
        const review = fromHeading(await ask(r.ai, reviewerPrompt(r.name, source, !!notes.trim(), piece, comparison, !!r.vidiq), work, shots, !!r.vidiq), new RegExp(`^## Review: ${r.name}`, 'm'), r.name);
        appendText(brief, `\n${review}\n`);
        fs.appendFileSync(path.join(work, 'brief.md'), `\n${review}\n`);
        r.state = 'done';
      } catch (e) {
        r.state = 'failed';
        r.error = e instanceof Error ? e.message : String(e);
      }
    }
    writeFile(brief, noteWhoTookPart(readText(brief), job.steps));
    await runPicks(picker, ask, work, !!notes.trim(), drafts, when, shots, comparison);
    job.status = 'done';
  })().catch((e) => {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
  });
  return { job, finished };
}

/** Pick Top 3 for a brief written before there were picks (or again): only the last step, on the Brief.md there. */
export async function startPicks(piece: string, rawNotes: string, ask: AskAi = askAi, images?: ResearchImages, picker: AiId = 'claude'): Promise<{ job: BriefJob; finished: Promise<void> }> {
  if (jobs.get(piece)?.status === 'running') throw new Error('A brief is already being written for this video.');
  const dir = pieceFolder(piece);
  const drafts = path.join(dir, 'Packaging', DRAFTS_FOLDER);
  const brief = path.join(drafts, BRIEF_FILE);
  if (!fs.existsSync(brief)) throw new Error('There is no Brief.md to pick from yet. Write the brief first.');
  const found = findSource(dir);
  const job: BriefJob = {
    piece,
    status: 'running',
    source: found ? { kind: found.kind, path: rel(found.full) } : { kind: 'transcript', path: '' },
    steps: [{ ai: picker, name: AI_NAMES[picker], role: 'picks', state: 'waiting' }],
    startedAt: new Date().toISOString(),
  };
  jobs.set(piece, job);
  let work: string;
  let notes: string;
  let shots: string[];
  let comparison = '';
  try {
    work = workFolder(piece);
    fs.copyFileSync(readable(brief), path.join(work, 'brief.md'));
    if (found) fs.writeFileSync(path.join(work, 'source.txt'), await readSource(found.full));
    if (found?.kind === 'transcript') copySourceTimings(dir, work);
    const saved = saveResearchImages(drafts, work, images, new Date());
    shots = saved.map((s) => s.file);
    if (!isShort(piece)) {
      const thumbnails = stageLongformThumbnails(piece, work);
      comparison = thumbnails.context;
      shots.push(...thumbnails.images);
    }
    notes = notesWithImages(rawNotes, saved);
    if (notes.trim()) fs.writeFileSync(path.join(work, 'notes.txt'), notes.trim() + '\n');
  } catch (e) {
    jobs.delete(piece);
    throw e;
  }
  const finished = runPicks(job.steps[0], ask, work, !!notes.trim(), drafts, new Date(), shots, comparison).then(() => {
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
