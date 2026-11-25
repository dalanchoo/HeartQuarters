// Best Photos for This Pair: the AI John chose (Claude unless he picks another) looks at the photos of John that could go with the chosen title and thumbnail pair
// (from expression tags and category folders, plus pictures generated for this video from the Shot List) and ranks up to five, with a reason for each. The
// ranking is saved in Packaging\Drafts\Photo Ranking.json so it's there next time; picking a photo stays John's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, config, safeResolve } from './config.js';
import { AI_NAMES, type AiId } from './ai.js';
import { askAi, THUMBNAIL_EXPRESSION_GUIDANCE, type AskAi } from './brief.js';
import { OPEN_MOUTH_TAGS, THUMBNAIL_PHOTO_ATTRIBUTES } from './expression-attribute-vocabulary.js';
import { isAiExpression } from './expression-origin.js';
import { readExpressionReferences } from './expression-references.js';
import { resolveExpressionPhoto } from './expression-photo-path.js';
import { expressionIndex, type ExpressionPhoto } from './expressions.js';
import { changeShotList, readShotList, shotFromSuggestion, shotHasSuggestion, type ExpressionShot } from './expression-shot-list.js';
import { CHOICE_FILE, DRAFTS_FOLDER, readChoice, type BriefPick } from './projects.js';
import { readable, readText, writeFile } from './safe-files.js';
import { thumbnail } from './thumbs.js';

export const RANKING_FILE = 'Photo Ranking.json';
/** At most this many photos are shown to the AI, so a ranking takes a minute or two, not ten. */
export const MAX_CANDIDATES = 40;
const TOP = 5;

export interface RankedPhoto { photo: string; why: string }
export interface PhotoRanking {
  /** The pair it was made for: a ranking for another pair is out of date. */
  title: string;
  thumbnailText: string;
  ranked: RankedPhoto[];
  cameraFirst?: true;
  /** How many photos the AI looked at. */
  looked: number;
  at: string;
  /** Which AI ranked them. Rankings saved before there was a choice are Claude's. */
  by?: string;
}
export interface RankingJob { piece: string; state: 'working' | 'done' | 'failed'; looked: number; error?: string; ai?: AiId }

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
 * The gaze tags a requested gaze rules out when John has confirmed them on a photo: looking at the camera rules out
 * every other look, and an off-camera look rules out the camera and the opposite side.
 */
function conflictingGazes(attribute: string): string[] {
  const looks = THUMBNAIL_PHOTO_ATTRIBUTES.filter(tag => tag.startsWith('Look'));
  if (attribute === 'LookAtCamera') return looks.filter(tag => tag !== attribute);
  const opposite: Record<string, string> = { LookLeft: 'LookRight', LookRight: 'LookLeft', LookUp: 'LookDown', LookDown: 'LookUp' };
  return attribute.startsWith('Look') ? ['LookAtCamera', ...(opposite[attribute] ? [opposite[attribute]] : [])] : [];
}

/**
 * A photo John has ruled out for the requested cues: a cue he marked as not there (DISCONFIRMED), or a gaze he
 * confirmed that contradicts the one asked for. Untagged and unconfirmed photos are never ruled out (John, 2026-11-25).
 */
export function contradictsCues(photo: ExpressionPhoto, attributes: string[]): boolean {
  const has = (name: string, check: (t: ExpressionPhoto['tags'][number]) => boolean) => photo.tags.some(t => t.tag.toLowerCase() === name.toLowerCase() && check(t));
  return attributes.some(attribute => has(attribute, t => !!t.disconfirmed)
    || conflictingGazes(attribute).some(other => has(other, t => t.confirmed && !t.disconfirmed)));
}

/**
 * Find eligible photos by expression (confirmed tag, folder, suggested tag), plus photos generated for this video.
 * Thumbs-down photos and photos that contradict a requested cue are left out. Photos made for this video come first,
 * then confirmed expression matches, then requested gaze and mouth tags, likes and stars, before the cap.
 * Stars only break ties: starred photos from unrelated expressions are no longer added (John, 2026-11-25).
 */
export function rankingCandidates(photos: ExpressionPhoto[], categories: string[], starred: string[], attributes: string[] = [], madeFor: ReadonlySet<string> = new Set()) {
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
    if (p.rating !== 'disliked' && !contradictsCues(p, attributes) && !order.includes(p)) order.push(p);
  };
  photos.filter(p => madeFor.has(p.path)).forEach(add);
  confirmed.forEach(add);
  for (const c of categories) photos.filter((p) => inCategory(p, c)).forEach(add);
  suggested.forEach(add);
  const candidates = order.map(photo => ({
    photo, starred: stars.has(photo.path), madeForThisVideo: madeFor.has(photo.path),
    // A picture generated for this video is what John asked for, so it competes with camera photos.
    aiGenerated: isAiExpression(photo) && !madeFor.has(photo.path), attributeScore: attributeScore(photo, attributes),
  }));
  candidates.sort((a, b) => Number(b.madeForThisVideo) - Number(a.madeForThisVideo)
    || Number(confirmed.has(b.photo)) - Number(confirmed.has(a.photo))
    || b.attributeScore - a.attributeScore
    || Number(b.photo.rating === 'liked') - Number(a.photo.rating === 'liked')
    || Number(b.starred) - Number(a.starred));
  const generated = candidates.filter(c => c.aiGenerated);
  // Leave room to assess AI fallbacks in the same request, even when the camera shortlist is full.
  const camera = candidates.filter(c => !c.aiGenerated).slice(0, MAX_CANDIDATES - Math.min(TOP, generated.length));
  return [...camera, ...generated.slice(0, MAX_CANDIDATES - camera.length)];
}

function attributeScore(photo: ExpressionPhoto, attributes: string[]): number {
  let score = 0;
  for (const attribute of attributes) {
    const names = (attribute === 'MouthOpen' ? OPEN_MOUTH_TAGS : [attribute]).map(tag => tag.toLowerCase());
    const matches = photo.tags.filter(tag => !tag.disconfirmed && names.includes(tag.tag.toLowerCase()));
    if (matches.some(tag => tag.confirmed)) score += attributes.length + 1;
    else if (matches.length) score++;
  }
  return score;
}

/** Library photos generated from a Shot List look that this video suggested (its tag file names the look). */
export function photosMadeFor(piece: string, photos: ExpressionPhoto[], shots: ExpressionShot[]): Set<string> {
  const looks = new Set(shots.filter(shot => shot.sources.some(source => source.piece === piece)).map(shot => shot.id));
  return new Set(photos.filter(photo => photo.generation?.shot && looks.has(photo.generation.shot)).map(photo => photo.path));
}

/** The library photos generated for this video, for the photo picker. An unreadable Shot List means none. */
export function readMadeFor(piece: string): string[] {
  draftsOf(piece);
  try { return [...photosMadeFor(piece, expressionIndex().photos, readShotList())]; } catch { return []; }
}

/**
 * The Shot List look for the chosen pair's expression, so John can generate a picture of it. The brief normally added
 * it already (matched by the pick's exact words, even after a merge); an older brief gets it added now.
 */
export function pairShot(piece: string): { id: string } {
  const choice = readChoice(readable(path.join(draftsOf(piece), CHOICE_FILE)));
  if (!choice) throw new Error('Choose one of the top 3 pairs first.');
  const text = choice.pick.expression.trim();
  if (!text) throw new Error('This pair names no expression to generate.');
  const cues = choice.pick.photoAttributes ?? [];
  const mine = (shot: ExpressionShot) => shotHasSuggestion(shot, text, cues) && shot.sources.some(source => source.piece === piece);
  const found = readShotList().find(mine);
  if (found) return { id: found.id };
  let id = '';
  changeShotList(shots => {
    const again = shots.find(mine);
    if (again) { id = again.id; return; }
    const shot = shotFromSuggestion(text, { piece, context: `Chosen: ${choice.pick.title}`, text, ...(cues.length ? { cues } : {}) });
    shots.push(shot); id = shot.id;
  });
  return { id };
}

type RankingPhoto = { file: string; photo: string; category: string; starred: boolean; aiGenerated: boolean; madeForThisVideo?: boolean; rating?: ExpressionPhoto['rating'] };

export function rankingPrompt(pick: BriefPick, short: boolean, list: RankingPhoto[], skill: string): string {
  return [
    `Choose the best photos of John for a Heart Mind Fusion ${short ? 'Short cover' : 'thumbnail'}. First read the skill "${skill}", especially "John's face" and the gaze and expression rules.`,
    [
      'THE PAIR:',
      `- Title: "${pick.title}"`,
      `- Thumbnail text: ${pick.thumbnailText.toUpperCase()}`,
      `- Expression wanted: ${pick.expression}`,
      ...(pick.photoAttributes?.length ? [`- Photo cues: ${pick.photoAttributes.join(', ')}. Left and right refer to the viewer's sides of the image.`] : []),
      `- Composition, background, and supporting visual: ${pick.background}`,
    ].join('\n'),
    `Open and look at every one of these ${list.length} photos (small copies in the current folder). Starred means John marked it as one of his best.`,
    'Some matching photos are filed in other expression folders. Judge the expression you see in the photo.',
    'A photo "made for this video" is an AI picture John generated and approved for this video. Judge it like a camera photo, and prefer it when it fits the pair as well as the others.',
    'Liked and Meh are John’s own ratings. Give a liked photo a boost when it fits the pair. Meh and unrated photos are also usable.',
    THUMBNAIL_EXPRESSION_GUIDANCE,
    list.map((c) => `- ${c.file}: ${c.photo} (${[c.category, c.madeForThisVideo ? 'made for this video' : c.aiGenerated ? 'AI-generated' : 'camera photo', c.starred && 'starred', c.rating].filter(Boolean).join(', ')})`).join('\n'),
    `Judge the actual photos for emotional fit, natural lighting and skin color, a clear expression at phone size, and how the gaze and mouth suit the layout and any photo cues above. Prefer variety when photos are close. Rank up to ${TOP} suitable camera photos, best first. If even one camera photo suits the pair, return only suitable camera photos. If none suits it, rank up to ${TOP} suitable AI-generated photos as fallbacks. Return an empty ranked array if none of the photos is suitable.`,
    "Don't create or change any file. Reply with only this JSON, nothing before or after it, using the library paths exactly as listed:",
    '{"ranked":[{"photo":"Category/Sub/Name.jpg","why":"one sentence"}]}',
  ].join('\n\n');
}

/** The ranking in the AI's answer: only photos that were offered, in its order, at most five. */
export function rankingFromAnswer(answer: string, offered: string[], aiPhotos: ReadonlySet<string> = new Set(), name = 'Claude'): RankedPhoto[] {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  let ranked: unknown;
  try {
    ranked = start >= 0 && end > start ? (JSON.parse(answer.slice(start, end + 1)) as { ranked?: unknown }).ranked : null;
  } catch {
    ranked = null;
  }
  if (!Array.isArray(ranked)) throw new Error(`${name}'s ranking wasn't in the expected form.`);
  const out: RankedPhoto[] = [];
  for (const r of ranked as { photo?: unknown; why?: unknown }[]) {
    const photo = typeof r?.photo === 'string' ? r.photo.replace(/\\/g, '/') : '';
    if (offered.includes(photo) && !out.some((o) => o.photo === photo)) out.push({ photo, why: typeof r.why === 'string' ? r.why.trim() : '' });
  }
  if (ranked.length && !out.length) throw new Error(`${name} named none of the photos it was shown.`);
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
  shots?: () => ExpressionShot[];
  small?: (full: string) => Promise<string>;
}

/** Starts a ranking for the chosen pair. Returns the job at once; `finished` settles when the AI is done. */
export function startRanking(piece: string, deps: RankingDeps = {}, ai: AiId = 'claude'): { job: RankingJob; finished: Promise<void> } {
  const ask = deps.ask ?? askAi;
  const drafts = draftsOf(piece);
  if (jobs.get(piece)?.state === 'working') throw new Error('An AI is already looking at the photos for this video.');
  const choice = readChoice(readable(path.join(drafts, CHOICE_FILE)));
  if (!choice) throw new Error('Choose one of the top 3 pairs first.');
  const photos = (deps.photos ?? (() => expressionIndex().photos))();
  const starred = (deps.starred ?? (() => readExpressionReferences().paths))();
  // An unreadable Shot List only loses the "made for this video" boost; the ranking still runs.
  let shots: ExpressionShot[] = [];
  try { shots = (deps.shots ?? readShotList)(); } catch { /* ranked without it */ }
  const madeFor = photosMadeFor(piece, photos, shots);
  const candidates = rankingCandidates(photos, pickCategories(choice.pick.expression), starred, choice.pick.photoAttributes, madeFor);
  if (!candidates.length) throw new Error("No eligible photos matched this pair's expression tags or folders. Thumbs-down photos, and photos marked as not having the gaze or mouth the pair asks for, are left out. Generate one for this pair from the Shot List.");
  const job: RankingJob = { piece, state: 'working', looked: candidates.length, ai };
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
      list.push({ file, photo: c.photo.path, category: c.photo.category.split('/').join(' > '), starred: c.starred, aiGenerated: c.aiGenerated, ...(c.madeForThisVideo ? { madeForThisVideo: true } : {}), rating: c.photo.rating });
    }
    const skill = path.join(config.skillsDir, 'HMF_Skills', 'thumbnails-and-titles', 'SKILL.md');
    const short = /(^|\/)Shorts\//i.test(piece) || /^999 - Shorts\//i.test(piece);
    const aiPhotos = new Set(list.filter(c => c.aiGenerated).map(c => c.photo));
    // The photos go along as images too: ChatGPT only sees images attached to the request.
    const ranked = rankingFromAnswer(await ask(ai, rankingPrompt(choice.pick, short, list, skill), work, list.map(c => path.join(work, c.file))), list.map(c => c.photo), aiPhotos, AI_NAMES[ai]);
    const ranking: PhotoRanking = { title: choice.pick.title, thumbnailText: choice.pick.thumbnailText, ranked, cameraFirst: true, looked: list.length, at: new Date().toISOString(), by: AI_NAMES[ai] };
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
