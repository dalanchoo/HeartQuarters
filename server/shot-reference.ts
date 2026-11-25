import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appDir, config, isInside, rootDir, safeResolve } from './config.js';
import { buildExpressionIndex, parseTags, type Tag } from './expressions.js';
import { expressionPrompt, imageFormat, type Options } from './expression-generation.js';
import { readLikenessReferences } from './expression-references.js';
import { readShotList, type ExpressionShot } from './expression-shot-list.js';
import { makeImage, type ImageAi, type MakeImage } from './thumbnails.js';
import { writeFileSafely } from './files.js';
import { writable } from './safe-files.js';
import { addGeneratedImageToInbox, copyAiImageToInbox } from './expression-inbox.js';
import { trashSlot } from './manage.js';
import { generationLines } from './expression-generation-record.js';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from './expression-attribute-vocabulary.js';

/**
 * AI pictures of what a Shot List look should be, so John can see the target before photographing it.
 * Every picture is kept (reference-001.png, reference-002.jpg, …) in Drive, in the Expressions folder
 * _ShotReferences\<shot id>\ (the leading "_" keeps the library from treating it as a category). `pictures` lists them
 * newest first. They used to be in data/shot-references; the first read copies those across.
 */
/** `ai` is the AI that made (or is making) the latest picture; older job files have none and were ChatGPT's. */
/** `tags`: each picture's tags from its tag file (or the look's, for pictures older than tag files). */
export type ShotReference = { shotId: string; state: 'working' | 'ready' | 'failed'; error?: string; prompt: string; createdAt: string; pictures: string[]; tags?: Record<string, Tag[]>; ai?: ImageAi };
const PICTURE = /^reference(?:-(\d{3}))?\.(png|jpg|webp)$/;

export const SHOT_REFERENCES_FOLDER = '_ShotReferences';
const root = () => process.env.HQ_SHOT_REFERENCES ?? path.join(rootDir('expressions'), SHOT_REFERENCES_FOLDER);
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** Inside the library every path is checked again (no shortcuts or junctions) before it is read or changed. */
const checked = (p: string) => isInside(path.resolve(rootDir('expressions')), path.resolve(p)) ? writable(p, 'expressions') : p;
const folder = (shotId: string) => { if (!UUID.test(shotId)) throw new Error('Choose a valid shot.'); return checked(path.join(root(), shotId)); };

/** Copy pictures and job files from the old data folder into Drive, once. Never replaces a file already in Drive. */
export function migrateShotReferences(): number {
  if (process.env.HQ_SHOT_REFERENCES) return 0; // a test or custom location: nothing to move
  const from = path.join(process.env.HQ_LEGACY_DATA_DIR ?? path.join(appDir, 'data'), 'shot-references');
  if (!fs.existsSync(from)) return 0;
  let copied = 0;
  for (const shot of fs.readdirSync(from, { withFileTypes: true })) {
    if (!shot.isDirectory() || !UUID.test(shot.name)) continue;
    for (const file of fs.readdirSync(path.join(from, shot.name), { withFileTypes: true })) {
      if (!file.isFile() || !(PICTURE.test(file.name) || file.name === 'job.json')) continue;
      const to = path.join(folder(shot.name), file.name);
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(from, shot.name, file.name), to, fs.constants.COPYFILE_EXCL);
        copied++;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
  }
  return copied;
}
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

/** The look's words for the prompt: title, description, facial details and what to avoid. */
export function shotLook(shot: ExpressionShot): string {
  const details = shot.morphology.length ? ` Facial details: ${shot.morphology.join(', ')}.` : '';
  const avoid = shot.ruledOut?.length ? ` Avoid: ${shot.ruledOut.join(', ')}.` : '';
  return `${shot.title ? `${shot.title}. ` : ''}${shot.description}${details}${avoid}`.trim();
}

/**
 * A picture's tag file, written when the picture is made (John, 2026-11-25): the look's Pose & Gaze, Framing and
 * Morphology, and its expression folder, all as unconfirmed suggestions (the AI may not have made that face), then
 * the AI mark. Tags the look rules out ("no squint") are written as disconfirmed. The same layout as Generate &
 * Review's pictures and the library's own tag files. With `ai` (a new picture), it ends with the record of what the
 * picture was asked for (expression-generation-record.ts), which the AI assessment leaves alone.
 */
export function shotPictureTags(shot: ExpressionShot, ai?: ImageAi): string {
  const options = shotOptions(shot);
  const unique = (tags: string[]) => [...new Set(tags.filter(Boolean))];
  const expression = shot.category.split('/').pop() ?? '';
  const out = shot.ruledOut ?? [];
  const lines = (tags: string[], vocabulary: string[]) => {
    const given = unique(tags);
    return [...given.map(tag => `${tag}, N/A, UNCONFIRMED`), ...out.filter(tag => vocabulary.includes(tag) && !given.includes(tag)).map(tag => `${tag}, N/A, DISCONFIRMED`)];
  };
  const groups = [lines([...shot.pose, options.gaze], POSE_TAGS), lines([...shot.framing, options.framing, options.angle], FRAMING_TAGS), lines(shot.morphology, MORPHOLOGY_TAGS), lines([expression], [])].filter(group => group.length);
  const tags = [...groups.map(group => group.join('\n')), 'AIGenerated, N/A, CONFIRMED'].join('\n==========\n') + '\n';
  if (!ai) return tags;
  return tags + generationLines({ by: ai, look: shot.title || expression, description: shot.description, with: [...shot.pose, options.gaze, ...shot.framing, options.framing, options.angle, ...shot.morphology], without: out, shot: shot.id });
}

/** "reference-002.png" → "reference-002.txt", the picture's tag file. */
const tagFileOf = (name: string) => name.replace(/\.[^.]+$/, '.txt');

/** A picture's tag file text; pictures made before tag files existed get the look's tags as they are now. */
function pictureTagText(shotId: string, name: string, shot?: ExpressionShot): string | null {
  const file = path.join(folder(shotId), tagFileOf(name));
  if (fs.existsSync(file) && fs.lstatSync(file).isFile()) return fs.readFileSync(file, 'utf8');
  return shot ? shotPictureTags(shot) : null;
}

/** The pictures in a shot's folder, newest first. An older single "reference.png" counts as the first. */
function listPictures(shotId: string): string[] {
  const dir = folder(shotId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && PICTURE.test(e.name))
    .map(e => ({ name: e.name, n: Number(PICTURE.exec(e.name)![1] ?? 0) })).sort((a, b) => b.n - a.n).map(e => e.name);
}

function readJob(shotId: string, shot: ExpressionShot | undefined = readShotList().find(s => s.id === shotId)): ShotReference | null {
  const file = path.join(folder(shotId), 'job.json');
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) return null;
  try {
    const job = JSON.parse(fs.readFileSync(file, 'utf8')) as ShotReference;
    if (job.shotId !== shotId || !['working', 'ready', 'failed'].includes(job.state)) return null;
    const pictures = listPictures(shotId);
    const tags = Object.fromEntries(pictures.map(name => [name, parseTags(pictureTagText(shotId, name, shot) ?? '')]));
    const result = { shotId, state: job.state, prompt: job.prompt, createdAt: job.createdAt, pictures, tags, ...(job.error ? { error: job.error } : {}), ...(job.ai === 'codex' || job.ai === 'gemini' ? { ai: job.ai } : {}) };
    // A job still marked working that no longer runs was cut off when HeartQuarters stopped.
    if (job.state === 'working' && !running.has(shotId)) return { ...result, state: 'failed', error: 'Generation was interrupted when HeartQuarters stopped. Try again.' };
    return result;
  } catch { return null; }
}
const saveJob = ({ pictures: _computed, tags: _read, ...job }: ShotReference) => writeFileSafely(path.join(folder(job.shotId), 'job.json'), JSON.stringify(job, null, 2));

/** Every shot's reference picture status, keyed by shot id. */
export function shotReferences(): Record<string, ShotReference> {
  const result: Record<string, ShotReference> = {};
  migrateShotReferences();
  if (!fs.existsSync(root())) return result;
  const shots = new Map(readShotList().map(s => [s.id, s]));
  for (const entry of fs.readdirSync(root(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const job = readJob(entry.name, shots.get(entry.name)); if (job) result[entry.name] = job;
  }
  return result;
}

/** Likeness photos: the Reference Photos (up to five), or a few Neutral photos if none are marked. */
function likenessPhotos(): string[] {
  const photos = buildExpressionIndex().photos; const exists = new Set(photos.map(p => p.path));
  const marked = readLikenessReferences().filter(p => exists.has(p)).slice(0, 5);
  const chosen = marked.length ? marked : photos.filter(p => p.category === 'Neutral').slice(0, 3).map(p => p.path);
  if (!chosen.length) throw new Error('Mark a few Reference Photos of yourself in Generate & Review so the AI knows what you look like.');
  return chosen;
}

/** Start making a reference picture for one look, with the image AI John chose. The look itself says what is needed. */
export function startShotReference(shotId: unknown, make: MakeImage = makeImage, ai: ImageAi = 'codex'): { job: ShotReference; finished: Promise<void> } {
  if (typeof shotId !== 'string') throw new Error('Choose a valid shot.');
  const dir = folder(shotId);
  if (running.has(shotId)) throw new Error('A reference picture for this shot is already being made.');
  const shot = readShotList().find(s => s.id === shotId);
  if (!shot) throw new Error('That shot is no longer on the list.');
  const category = buildExpressionIndex().categories.find(c => c.path === shot.category && c.path);
  if (!category) throw new Error('Sort this shot into an expression folder first.');
  const files = likenessPhotos().map(p => safeResolve('expressions', p));
  const prompt = expressionPrompt(category.name, category.definition, shotOptions(shot), shotLook(shot));
  const tags = shotPictureTags(shot, ai); // the look as it was asked for
  fs.mkdirSync(dir, { recursive: true });
  const job: ShotReference = { shotId, state: 'working', prompt, createdAt: new Date().toISOString(), pictures: listPictures(shotId), ai };
  saveJob(job); running.add(shotId);
  const work = path.join(dir, `work-${randomUUID()}`);
  const finished = (async () => {
    fs.mkdirSync(work);
    const answer = await make(ai, prompt, work, 'candidate.png', { photo: files[0], refs: files.slice(1) });
    const data = fs.readFileSync(answer.image); const format = imageFormat(data);
    if (!format) throw new Error('The generated image was not a PNG, JPEG or WebP.');
    // Add it as the next number; earlier pictures are kept.
    const taken = listPictures(shotId).map(name => Number(PICTURE.exec(name)![1] ?? 0));
    const next = Math.max(0, ...taken) + 1;
    if (next > 999) throw new Error('This shot already has 999 pictures.');
    const name = `reference-${String(next).padStart(3, '0')}.${format}`;
    fs.writeFileSync(path.join(dir, name), data, { flag: 'wx' });
    fs.writeFileSync(path.join(dir, tagFileOf(name)), tags, { flag: 'wx' });
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

/**
 * Move to Expression Inbox: the picture goes to the Inbox as an AI image and leaves the look, which keeps its other
 * pictures and stays where it is (John, 2026-11-25). It's removed here only once the Inbox has its copy.
 * Returns the Inbox path and the look's pictures as they are now.
 */
export function moveShotReferenceToInbox(shotId: unknown, name: unknown): { path: string; pictures: ShotReference | null } {
  if (typeof shotId !== 'string' || typeof name !== 'string') throw new Error('Choose a picture.');
  const file = shotReferenceFile(shotId, name);
  if (running.has(shotId)) throw new Error('Wait until the picture being made is ready, then move this one.');
  const shot = readShotList().find(s => s.id === shotId);
  const number = listPictures(shotId).length - listPictures(shotId).indexOf(name);
  const label = `${shot?.title || 'Shot List'} - AI Reference ${String(number).padStart(2, '0')}`;
  const data = fs.readFileSync(file); const format = imageFormat(data);
  const tags = pictureTagText(shotId, name, shot);
  // The Inbox gets the picture with its tag file, so its expression, framing, pose and morphology are suggested there.
  const { path: inboxPath } = format && tags ? addGeneratedImageToInbox(label, data, `.${format}`, tags) : copyAiImageToInbox(label, file);
  fs.rmSync(checked(file));
  fs.rmSync(checked(path.join(folder(shotId), tagFileOf(name))), { force: true });
  return { path: inboxPath, pictures: readJob(shotId) };
}

/**
 * When one look is merged into another, copies its pictures to the look that stays, numbered after that look's own
 * (oldest first, so the newest stays newest). The merged look's folder is left as it was. Returns how many were copied.
 */
export function copyShotPictures(fromId: string, toId: string): number {
  if (!UUID.test(fromId) || fromId === toId || running.has(fromId) || running.has(toId)) return 0;
  const pictures = listPictures(fromId).reverse();
  if (!pictures.length) return 0;
  const to = folder(toId);
  fs.mkdirSync(to, { recursive: true });
  let next = Math.max(0, ...listPictures(toId).map(name => Number(PICTURE.exec(name)![1] ?? 0))) + 1;
  for (const name of pictures) {
    if (next > 999) break;
    const format = PICTURE.exec(name)![2];
    const copy = `reference-${String(next++).padStart(3, '0')}.${format}`;
    fs.copyFileSync(path.join(folder(fromId), name), path.join(to, copy), fs.constants.COPYFILE_EXCL);
    const tags = path.join(folder(fromId), tagFileOf(name));
    if (fs.existsSync(tags)) fs.copyFileSync(tags, path.join(to, tagFileOf(copy)), fs.constants.COPYFILE_EXCL);
  }
  // The pictures only show with a job file; a look that never had one gets the merged look's.
  if (!readJob(toId)) {
    const from = readJob(fromId);
    saveJob({ shotId: toId, state: 'ready', prompt: from?.prompt ?? '', createdAt: from?.createdAt ?? new Date().toISOString(), pictures: [], ...(from?.ai ? { ai: from.ai } : {}) });
  }
  return pictures.length;
}

/** The Trash folder's name for a look's pictures: "Shot List - Direct and Assured (picture)". */
function trashName(label: string, what: string): string {
  const clean = label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '');
  return `Shot List - ${clean || 'Look'} (${what})`;
}

/** Moves a file or folder into Trash; when Trash is on another drive, copies it there first, then removes it. */
function moveToTrash(from: string, to: string): void {
  try { fs.renameSync(from, to); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true });
  }
}

/**
 * Delete Picture: moves one of a look's pictures to HeartQuarters Trash, so it can be put back. The look keeps its
 * other pictures. Returns the look's pictures as they are now.
 */
export function deleteShotPicture(shotId: unknown, name: unknown): ShotReference | null {
  if (typeof shotId !== 'string' || typeof name !== 'string') throw new Error('Choose a valid picture.');
  const dir = folder(shotId);
  if (running.has(shotId)) throw new Error('Wait until the picture being made is ready, then delete.');
  if (!PICTURE.test(name) || !listPictures(shotId).includes(name)) throw new Error('That picture is no longer there.');
  if (!config.trashDir) throw new Error('No trash folder is set in config.json. Nothing was changed.');
  const shot = readShotList().find(s => s.id === shotId);
  const slot = trashSlot(trashName(shot?.title || shot?.description || '', 'picture'));
  moveToTrash(checked(path.join(dir, name)), path.join(slot, name));
  const tags = path.join(dir, tagFileOf(name));
  if (fs.existsSync(tags)) moveToTrash(checked(tags), path.join(slot, tagFileOf(name)));
  return readJob(shotId);
}

/**
 * A deleted look's pictures go to HeartQuarters Trash, folder and all. Leaves them where they are while one is still
 * being made, or when no trash folder is set (the library ignores _ShotReferences, so nothing shows them).
 */
export function removeShotReference(shotId: string, label = ''): void {
  if (!UUID.test(shotId) || running.has(shotId) || !config.trashDir) return;
  const dir = folder(shotId);
  if (!fs.existsSync(dir)) return;
  moveToTrash(dir, path.join(trashSlot(trashName(label, 'deleted look')), shotId));
}
