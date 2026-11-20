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
import { copyAiImageToInbox } from './expression-inbox.js';

/**
 * AI pictures of what a Shot List look should be, so John can see the target before photographing it.
 * Every picture is kept (reference-001.png, reference-002.jpg, …) on this computer in
 * data/shot-references/<shot id>/, never in the Expressions library. `pictures` lists them newest first.
 */
export type ShotReference = { shotId: string; state: 'working' | 'ready' | 'failed'; error?: string; prompt: string; createdAt: string; pictures: string[] };
const PICTURE = /^reference(?:-(\d{3}))?\.(png|jpg|webp)$/;

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

/** The pictures in a shot's folder, newest first. An older single "reference.png" counts as the first. */
function listPictures(shotId: string): string[] {
  const dir = folder(shotId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && PICTURE.test(e.name))
    .map(e => ({ name: e.name, n: Number(PICTURE.exec(e.name)![1] ?? 0) })).sort((a, b) => b.n - a.n).map(e => e.name);
}

function readJob(shotId: string): ShotReference | null {
  const file = path.join(folder(shotId), 'job.json');
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null;
  try {
    const job = JSON.parse(fs.readFileSync(file, 'utf8')) as ShotReference;
    if (job.shotId !== shotId || !['working', 'ready', 'failed'].includes(job.state)) return null;
    const result = { shotId, state: job.state, prompt: job.prompt, createdAt: job.createdAt, pictures: listPictures(shotId), ...(job.error ? { error: job.error } : {}) };
    // A job still marked working that no longer runs was cut off when HeartQuarters stopped.
    if (job.state === 'working' && !running.has(shotId)) return { ...result, state: 'failed', error: 'Generation was interrupted when HeartQuarters stopped. Try again.' };
    return result;
  } catch { return null; }
}
const saveJob = ({ pictures: _computed, ...job }: ShotReference) => writeFileSafely(path.join(folder(job.shotId), 'job.json'), JSON.stringify(job, null, 2));

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
  const job: ShotReference = { shotId, state: 'working', prompt, createdAt: new Date().toISOString(), pictures: listPictures(shotId) };
  saveJob(job); running.add(shotId);
  const work = path.join(dir, `work-${randomUUID()}`);
  const finished = (async () => {
    fs.mkdirSync(work);
    const answer = await make('codex', prompt, work, 'candidate.png', { photo: files[0], refs: files.slice(1) });
    const data = fs.readFileSync(answer.image); const format = imageFormat(data);
    if (!format) throw new Error('The generated image was not a PNG, JPEG or WebP.');
    // Add it as the next number; earlier pictures are kept.
    const taken = listPictures(shotId).map(name => Number(PICTURE.exec(name)![1] ?? 0));
    const next = Math.max(0, ...taken) + 1;
    if (next > 999) throw new Error('This shot already has 999 pictures.');
    fs.writeFileSync(path.join(dir, `reference-${String(next).padStart(3, '0')}.${format}`), data, { flag: 'wx' });
    job.state = 'ready'; saveJob(job);
  })().catch((e: unknown) => { job.state = 'failed'; job.error = e instanceof Error ? e.message : String(e); try { saveJob(job); } catch { /* the error still shows until restart */ } })
    .finally(() => { running.delete(shotId); fs.rmSync(work, { recursive: true, force: true }); });
  return { job, finished };
}

/** One of a shot's pictures, checked against the folder listing so no other file can be asked for. */
export function shotReferenceFile(shotId: string, name: string): string {
  if (!listPictures(shotId).includes(name)) throw new Error('That picture is no longer there.');
  const file = path.join(folder(shotId), name);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('That picture is no longer there.');
  return file;
}

/** Copy one picture into the Expression Inbox as an AI image; the picture itself stays here. */
export function copyShotReferenceToInbox(shotId: unknown, name: unknown): { path: string } {
  if (typeof shotId !== 'string' || typeof name !== 'string') throw new Error('Choose a picture.');
  const file = shotReferenceFile(shotId, name);
  const shot = readShotList().find(s => s.id === shotId);
  const number = listPictures(shotId).length - listPictures(shotId).indexOf(name);
  return copyAiImageToInbox(`${shot?.title || 'Shot List'} - AI Reference ${String(number).padStart(2, '0')}`, file);
}

/** Remove a deleted shot's pictures. Leaves it alone while one is still being made. */
export function removeShotReference(shotId: string): void {
  if (!UUID.test(shotId) || running.has(shotId)) return;
  fs.rmSync(folder(shotId), { recursive: true, force: true });
}
