// Best Photos for This Pair: Claude looks at the photos of John that could go with the chosen title and thumbnail pair
// (from expression tags, category folders, and stars) and ranks up to five, with a reason for each. The
// ranking is saved in Packaging\Drafts\Photo Ranking.json so it's there next time; picking a photo stays John's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, config, safeResolve } from './config.js';
import { askAi, type AskAi } from './brief.js';
import { isAiExpression } from './expression-origin.js';
import { readExpressionReferences } from './expression-references.js';
import { resolveExpressionPhoto } from './expression-photo-path.js';
import { expressionIndex, type ExpressionPhoto } from './expressions.js';
import { CHOICE_FILE, DRAFTS_FOLDER, readChoice, type BriefPick } from './projects.js';
import { readable, readText, writeFile } from './safe-files.js';
import { thumbnail } from './thumbs.js';

export const RANKING_FILE = 'Photo Ranking.json';
/** At most this many photos are shown to Claude, so a ranking takes a minute or two, not ten. */
export const MAX_CANDIDATES = 40;
const TOP = 5;

export interface RankedPhoto { photo: string; why: string }
export interface PhotoRanking {
  /** The pair it was made for: a ranking for another pair is out of date. */
  title: string;
  thumbnailText: string;
  ranked: RankedPhoto[];
  cameraFirst?: true;
  /** How many photos Claude looked at. */
  looked: number;
  at: string;
}
export interface RankingJob { piece: string; state: 'working' | 'done' | 'failed'; looked: number; error?: string }

/** The library categories a pair's expression names, as folder paths ("Positive > Relief" is "Positive/Relief"). */
export function pickCategories(expression: string): string[] {
  const found: string[] = [];
  for (const m of expression.matchAll(/([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)\s*>\s*([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)/g)) {
    const p = `${m[1]}/${m[2]}`;
    if (!found.includes(p)) found.push(p);
  }
  return found;
}

/**
 * Find eligible photos by expression tag, folder, or star. Give confirmed tags and likes priority before the cap.
 */
export function rankingCandidates(photos: ExpressionPhoto[], categories: string[], starred: string[]) {
  const inCategory = (p: ExpressionPhoto, c: string) => p.category.toLowerCase() === c.toLowerCase() || p.category.toLowerCase().startsWith(c.toLowerCase() + '/');
  const names = new Set(categories.map(category => category.slice(category.lastIndexOf('/') + 1).toLowerCase()));
  const confirmed = new Set<ExpressionPhoto>();
  const suggested = new Set<ExpressionPhoto>();
  for (const photo of photos) {
    for (const tag of photo.tags) {
      if (!tag.disconfirmed && names.has(tag.tag.toLowerCase())) {
        (tag.confirmed ? confirmed : suggested).add(photo);
      }
    }
  }
  const stars = new Set(starred);
  const order: ExpressionPhoto[] = [];
  const add = (p: ExpressionPhoto) => {
    if (p.rating !== 'disliked' && !order.includes(p)) order.push(p);
  };
  confirmed.forEach(add);
  for (const c of categories) photos.filter((p) => inCategory(p, c) && stars.has(p.path)).forEach(add);
  for (const c of categories) photos.filter((p) => inCategory(p, c)).forEach(add);
  suggested.forEach(add);
  photos.filter((p) => stars.has(p.path)).forEach(add);
  order.sort((a, b) => Number(confirmed.has(b)) - Number(confirmed.has(a)) || Number(b.rating === 'liked') - Number(a.rating === 'liked'));
  const candidates = order.map(photo => ({ photo, starred: stars.has(photo.path), aiGenerated: isAiExpression(photo) }));
  const generated = candidates.filter(c => c.aiGenerated);
  // Leave room to assess AI fallbacks in the same request, even when the camera shortlist is full.
  const camera = candidates.filter(c => !c.aiGenerated).slice(0, MAX_CANDIDATES - Math.min(TOP, generated.length));
  return [...camera, ...generated.slice(0, MAX_CANDIDATES - camera.length)];
}

type RankingPhoto = { file: string; photo: string; category: string; starred: boolean; aiGenerated: boolean; rating?: ExpressionPhoto['rating'] };

export function rankingPrompt(pick: BriefPick, short: boolean, list: RankingPhoto[], skill: string): string {
  return [
    `Choose the best photos of John for a Heart Mind Fusion ${short ? 'Short cover' : 'thumbnail'}. First read the skill "${skill}", especially "John's face" and the gaze and expression rules.`,
    [
      'THE PAIR:',
      `- Title: "${pick.title}"`,
      `- Thumbnail text: ${pick.thumbnailText.toUpperCase()}`,
      `- Expression wanted: ${pick.expression}`,
      `- Background and layout: ${pick.background}`,
    ].join('\n'),
    `Open and look at every one of these ${list.length} photos (small copies in the current folder). Starred means John marked it as one of his best.`,
    'Some matching photos are filed in other expression folders. Judge the expression you see in the photo.',
    'Liked and Meh are John’s own ratings. Give a liked photo a boost when it fits the pair. Meh and unrated photos are also usable.',
    list.map((c) => `- ${c.file}: ${c.photo} (${[c.category, c.aiGenerated ? 'AI-generated' : 'camera photo', c.starred && 'starred', c.rating].filter(Boolean).join(', ')})`).join('\n'),
    `Judge the actual photos for emotional fit, natural lighting and skin color, a clear expression at phone size, and gaze toward the centre or camera. Prefer variety when photos are close. Rank up to ${TOP} suitable camera photos, best first. If even one camera photo suits the pair, return only suitable camera photos. If none suits it, rank up to ${TOP} suitable AI-generated photos as fallbacks. Return an empty ranked array if none of the photos is suitable.`,
    "Don't create or change any file. Reply with only this JSON, nothing before or after it, using the library paths exactly as listed:",
    '{"ranked":[{"photo":"Category/Sub/Name.jpg","why":"one sentence"}]}',
  ].join('\n\n');
}

/** The ranking in Claude's answer: only photos that were offered, in its order, at most five. */
export function rankingFromAnswer(answer: string, offered: string[], aiPhotos: ReadonlySet<string> = new Set()): RankedPhoto[] {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  let ranked: unknown;
  try {
    ranked = start >= 0 && end > start ? (JSON.parse(answer.slice(start, end + 1)) as { ranked?: unknown }).ranked : null;
  } catch {
    ranked = null;
  }
  if (!Array.isArray(ranked)) throw new Error("Claude's ranking wasn't in the expected form.");
  const out: RankedPhoto[] = [];
  for (const r of ranked as { photo?: unknown; why?: unknown }[]) {
    const photo = typeof r?.photo === 'string' ? r.photo.replace(/\\/g, '/') : '';
    if (offered.includes(photo) && !out.some((o) => o.photo === photo)) out.push({ photo, why: typeof r.why === 'string' ? r.why.trim() : '' });
  }
  if (ranked.length && !out.length) throw new Error('Claude named none of the photos it was shown.');
  const camera = out.filter(r => !aiPhotos.has(r.photo));
  return (camera.length ? camera : out).slice(0, TOP);
}

const jobs = new Map<string, RankingJob>();

export function rankingJob(piece: string): RankingJob | null {
  return jobs.get(piece) ?? null;
}

function draftsOf(piece: string): string {
  if (!piece) throw new Error('No video given.');
  const dir = safeResolve('projects', piece);
  if (!fs.existsSync(path.join(dir, 'Packaging'))) throw new Error(`"${piece}" has no Packaging folder.`);
  return path.join(dir, 'Packaging', DRAFTS_FOLDER);
}

/** The saved ranking for a piece, or null. */
export function readRanking(piece: string): PhotoRanking | null {
  try {
    const ranking = JSON.parse(readText(path.join(draftsOf(piece), RANKING_FILE))) as PhotoRanking;
    const disliked = new Set(expressionIndex().photos.filter(photo => photo.rating === 'disliked').map(photo => photo.path));
    return { ...ranking, ranked: ranking.ranked.filter(({ photo }) => !disliked.has(photo)) };
  } catch {
    return null;
  }
}

export interface RankingDeps {
  ask?: AskAi;
  photos?: () => ExpressionPhoto[];
  starred?: () => string[];
  small?: (full: string) => Promise<string>;
}

/** Starts a ranking for the chosen pair. Returns the job at once; `finished` settles when Claude is done. */
export function startRanking(piece: string, deps: RankingDeps = {}): { job: RankingJob; finished: Promise<void> } {
  const ask = deps.ask ?? askAi;
  const drafts = draftsOf(piece);
  if (jobs.get(piece)?.state === 'working') throw new Error('Claude is already looking at the photos for this video.');
  const choice = readChoice(readable(path.join(drafts, CHOICE_FILE)));
  if (!choice) throw new Error('Choose one of the top 3 pairs first.');
  const photos = (deps.photos ?? (() => expressionIndex().photos))();
  const starred = (deps.starred ?? (() => readExpressionReferences().paths))();
  const candidates = rankingCandidates(photos, pickCategories(choice.pick.expression), starred);
  if (!candidates.length) throw new Error("No eligible photos matched this pair's expression tags, folders, or your starred photos. Thumbs-down photos are excluded.");
  const job: RankingJob = { piece, state: 'working', looked: candidates.length };
  jobs.set(piece, job);
  const small = deps.small ?? ((full: string) => thumbnail(full, 512));
  const finished = (async () => {
    const root = process.env.VITEST ? path.join(os.tmpdir(), 'hq-ranking-tests') : path.join(appDir, 'data', 'photo-ranking');
    const work = path.join(root, `${Date.now()}`);
    fs.mkdirSync(work, { recursive: true });
    const list: RankingPhoto[] = [];
    for (const [i, c] of candidates.entries()) {
      const file = `${String(i + 1).padStart(2, '0')}.jpg`;
      fs.copyFileSync(await small(resolveExpressionPhoto(c.photo.path)), path.join(work, file));
      list.push({ file, photo: c.photo.path, category: c.photo.category.split('/').join(' > '), starred: c.starred, aiGenerated: c.aiGenerated, rating: c.photo.rating });
    }
    const skill = path.join(config.skillsDir, 'HMF_Skills', 'thumbnails-and-titles', 'SKILL.md');
    const short = /(^|\/)Shorts\//i.test(piece) || /^999 - Shorts\//i.test(piece);
    const aiPhotos = new Set(list.filter(c => c.aiGenerated).map(c => c.photo));
    const ranked = rankingFromAnswer(await ask('claude', rankingPrompt(choice.pick, short, list, skill), work), list.map(c => c.photo), aiPhotos);
    const ranking: PhotoRanking = { title: choice.pick.title, thumbnailText: choice.pick.thumbnailText, ranked, cameraFirst: true, looked: list.length, at: new Date().toISOString() };
    writeFile(path.join(drafts, RANKING_FILE), JSON.stringify(ranking, null, 2) + '\n');
    fs.rmSync(work, { recursive: true, force: true });
  })().then(
    () => {
      job.state = 'done';
    },
    (e: unknown) => {
      job.state = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
    },
  );
  return { job, finished };
}
