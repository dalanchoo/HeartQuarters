import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appDir, safeResolve } from './config.js';
import { buildExpressionIndex } from './expressions.js';
import { expressionPrompt, imageFormat, type Options } from './expression-generation.js';
import { readExpressionReferences } from './expression-references.js';
import { readShotList, type ExpressionShot } from './expression-shot-list.js';
import { makeImage, type MakeImage } from './thumbnails.js';
import { writeFileSafely } from './files.js';

/**
 * An AI picture of what a Shot List look should be, so John can see the target before photographing it.
 * Kept on this computer in data/shot-references/<shot id>/, never in the Expressions library.
 */
export type ShotReference = { shotId: string; state: 'working' | 'ready' | 'failed'; error?: string; format?: 'png' | 'jpg' | 'webp'; prompt: string; createdAt: string };

const root = () => process.env.HQ_SHOT_REFERENCES ?? path.join(appDir, 'data', 'shot-references');
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const folder = (shotId: string) => { if (!UUID.test(shotId)) throw new Error('Choose a valid shot.'); return path.join(root(), shotId); };
const running = new Set<string>();

const FRAMINGS = ['HeadShoulders', 'UpperBody', 'CloseUp'];
const ANGLES = ['Frontal', 'ThreeQuarter', 'LeftFacing', 'RightFacing'];
const GAZES = ['LookAtCamera', 'LookOffCamera', 'LookLeft', 'LookRight', 'LookUp', 'LookDown'];

/** The generator's framing, face direction and gaze for a look, using only choices it understands. */
export function shotOptions(shot: ExpressionShot): Options {
  return {
    framing: shot.framing.find(tag => FRAMINGS.includes(tag)) ?? 'HeadShoulders',
    angle: shot.framing.find(tag => ANGLES.includes(tag)) ?? '',
    gaze: shot.pose.find(tag => GAZES.includes(tag)) ?? '',
  };
}

/** The look's words for the prompt: title, description and facial details. */
export function shotLook(shot: ExpressionShot): string {
  const details = shot.morphology.length ? ` Facial details: ${shot.morphology.join(', ')}.` : '';
  return `${shot.title ? `${shot.title}. ` : ''}${shot.description}${details}`.trim();
}

function readJob(shotId: string): ShotReference | null {
  const file = path.join(folder(shotId), 'job.json');
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null;
  try {
    const job = JSON.parse(fs.readFileSync(file, 'utf8')) as ShotReference;
    if (job.shotId !== shotId || !['working', 'ready', 'failed'].includes(job.state) || (job.state === 'ready' && !job.format) || (job.format !== undefined && !['png', 'jpg', 'webp'].includes(job.format))) return null;
    // A job still marked working that no longer runs was cut off when HeartQuarters stopped.
    if (job.state === 'working' && !running.has(shotId)) return { ...job, state: 'failed', error: 'Generation was interrupted when HeartQuarters stopped. Try again.' };
    return job;
  } catch { return null; }
}
const saveJob = (job: ShotReference) => writeFileSafely(path.join(folder(job.shotId), 'job.json'), JSON.stringify(job, null, 2));

/** Every shot's reference picture status, keyed by shot id. */
export function shotReferences(): Record<string, ShotReference> {
  const result: Record<string, ShotReference> = {};
  if (!fs.existsSync(root())) return result;
  for (const entry of fs.readdirSync(root(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const job = readJob(entry.name); if (job) result[entry.name] = job;
  }
  return result;
}

/** Likeness photos: the starred ones (up to five), or a few Neutral photos if nothing is starred. */
function likenessPhotos(): string[] {
  const photos = buildExpressionIndex().photos; const exists = new Set(photos.map(p => p.path));
  const starred = readExpressionReferences().paths.filter(p => exists.has(p)).slice(0, 5);
  const chosen = starred.length ? starred : photos.filter(p => p.category === 'Neutral').slice(0, 3).map(p => p.path);
  if (!chosen.length) throw new Error('Star a few photos of yourself in Generate & Review so the AI knows what you look like.');
  return chosen;
}

/** Start making a reference picture for one look. Nothing to choose: the look itself says what is needed. */
export function startShotReference(shotId: unknown, make: MakeImage = makeImage): { job: ShotReference; finished: Promise<void> } {
  if (typeof shotId !== 'string') throw new Error('Choose a valid shot.');
  const dir = folder(shotId);
  if (running.has(shotId)) throw new Error('A reference picture for this shot is already being made.');
  const shot = readShotList().find(s => s.id === shotId);
  if (!shot) throw new Error('That shot is no longer on the list.');
  const category = buildExpressionIndex().categories.find(c => c.path === shot.category && c.path);
  if (!category) throw new Error('Sort this shot into an expression folder first.');
  const files = likenessPhotos().map(p => safeResolve('expressions', p));
  const prompt = expressionPrompt(category.name, category.definition, shotOptions(shot), shotLook(shot));
  fs.mkdirSync(dir, { recursive: true });
  // Keep showing the previous picture (if any) while the new one is made, and if making it fails.
  const previous = readJob(shotId);
  const job: ShotReference = { shotId, state: 'working', prompt, createdAt: new Date().toISOString(), ...(previous?.format ? { format: previous.format } : {}) };
  saveJob(job); running.add(shotId);
  const work = path.join(dir, `work-${randomUUID()}`);
  const finished = (async () => {
    fs.mkdirSync(work);
    const answer = await make('codex', prompt, work, 'candidate.png', { photo: files[0], refs: files.slice(1) });
    const data = fs.readFileSync(answer.image); const format = imageFormat(data);
    if (!format) throw new Error('The generated image was not a PNG, JPEG or WebP.');
    // Replace the previous picture only once the new one is safely made.
    for (const ext of ['png', 'jpg', 'webp']) fs.rmSync(path.join(dir, `reference.${ext}`), { force: true });
    fs.writeFileSync(path.join(dir, `reference.${format}`), data);
    job.state = 'ready'; job.format = format; saveJob(job);
  })().catch((e: unknown) => { job.state = 'failed'; job.error = e instanceof Error ? e.message : String(e); try { saveJob(job); } catch { /* the error still shows until restart */ } })
    .finally(() => { running.delete(shotId); fs.rmSync(work, { recursive: true, force: true }); });
  return { job, finished };
}

export function shotReferenceFile(shotId: string): string {
  const job = readJob(shotId);
  if (!job?.format) throw new Error('This shot has no reference picture yet.');
  const file = path.join(folder(shotId), `reference.${job.format}`);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error('This shot has no reference picture yet.');
  return file;
}

/** Remove a deleted shot's picture. Leaves it alone while one is still being made. */
export function removeShotReference(shotId: string): void {
  if (!UUID.test(shotId) || running.has(shotId)) return;
  fs.rmSync(folder(shotId), { recursive: true, force: true });
}
