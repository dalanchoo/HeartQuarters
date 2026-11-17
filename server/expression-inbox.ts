import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, isInside, safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex, EXPRESSION_INBOX, findExpressionPhoto } from './expressions.js';
import { isAiExpression } from './expression-origin.js';
import { decodeReference, makeImage, type ImageAi, type MakeImage } from './thumbnails.js';
import { writeFileSafely } from './files.js';

const IMAGE = /\.(png|jpe?g|webp)$/i;
type NormalizeJob = { id: string; photo: string; ai: ImageAi; state: 'working' | 'done' | 'failed'; result?: string; error?: string };
const jobs = new Map<string, NormalizeJob>();

export function ensureExpressionInbox(): string {
  const dir = safeResolve('expressions', EXPRESSION_INBOX);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw new Error('The inbox must be a real folder.');
  return dir;
}

function cleanStem(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new Error('The photo needs a file name.');
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = path.basename(base, path.extname(base)).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 100);
  return !stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? 'Photo' : stem;
}

function addBytes(name: unknown, data: Buffer, ext: string, ai: boolean): { path: string } {
  const dir = ensureExpressionInbox(); const stem = cleanStem(name); const existing = fs.readdirSync(dir).map(item => item.toLowerCase());
  let base = stem; let n = 2;
  while (existing.some(item => item.startsWith(`${base.toLowerCase()}.`) || item.startsWith(`${base.toLowerCase()}_`))) base = `${stem} (${n++})`;
  const image = safeResolve('expressions', `${EXPRESSION_INBOX}/${base}${ext}`);
  const sidecar = safeResolve('expressions', `${EXPRESSION_INBOX}/${base}.txt`);
  fs.writeFileSync(image, data, { flag: 'wx' });
  try { if (ai) fs.writeFileSync(sidecar, 'AIGenerated, N/A, CONFIRMED\n', { flag: 'wx' }); }
  catch (error) { fs.unlinkSync(image); throw error; }
  return { path: `${EXPRESSION_INBOX}/${base}${ext}` };
}

export function importInboxPhoto(name: unknown, encoded: unknown, ai: unknown): { path: string } {
  if (typeof ai !== 'boolean') throw new Error('Choose whether this is an AI image.');
  const { data, ext } = decodeReference(encoded);
  return addBytes(name, data, ext, ai);
}

/** Copy a draft or packaging thumbnail from this video, leaving the source untouched. */
export function copyThumbnailToInbox(piece: string, image: string): { path: string } {
  if (!piece || !image) throw new Error('Choose a video and thumbnail.');
  const folder = safeResolve('projects', piece); const packaging = safeResolve('projects', path.join(piece, 'Packaging')); const full = safeResolve('projects', image);
  const relative = path.relative(packaging, full).split(path.sep).join('/');
  if (!isInside(packaging, full) || !IMAGE.test(full) || !/^(?:Drafts\/[^/]+\/[^/]+|(?:V\d+[^/]*|Legacy)\/Thumbnail\/Thumbnail\.(?:png|jpe?g|webp))$/i.test(relative)) throw new Error("Choose a thumbnail from this video's packaging.");
  if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('Thumbnail shortcuts are not supported.');
  for (let check = full; isInside(folder, check) && check !== folder; check = path.dirname(check)) if (fs.lstatSync(check).isSymbolicLink()) throw new Error('Thumbnail shortcuts are not supported.');
  const data = fs.readFileSync(full); const decoded = decodeReference(data.toString('base64'));
  return addBytes(`${path.basename(piece)} - ${path.basename(full)}`, decoded.data, decoded.ext, true);
}

/** Move an inbox photo and every matching sidecar to one category, rolling back on failure. */
export function fileInboxPhoto(photoPath: string, destination: string, sidecarUpdate?: { before: string; after: string }): { path: string } {
  const index = buildExpressionIndex(); const photo = findExpressionPhoto(index, photoPath);
  if (!photo || photo.category !== EXPRESSION_INBOX) throw new Error('That inbox photo is unavailable or has an ambiguous name.');
  const category = index.categories.find(item => item.path === destination && !!item.path);
  if (!category) throw new Error('Choose an existing expression category.');
  const from = safeResolve('expressions', photoPath); const inbox = ensureExpressionInbox(); const folder = safeResolve('expressions', destination);
  if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) throw new Error('The category must be a real folder.');
  const base = path.basename(from, path.extname(from));
  const related = fs.readdirSync(inbox, { withFileTypes: true }).filter(e => e.name.toLowerCase() === path.basename(from).toLowerCase() || e.name.toLowerCase().startsWith(`${base.toLowerCase()}.`) || e.name.toLowerCase().startsWith(`${base.toLowerCase()}_`));
  if (related.some(e => !e.isFile() || e.isSymbolicLink() || (IMAGE.test(e.name) && e.name.toLowerCase() !== path.basename(from).toLowerCase()))) throw new Error('Related files are ambiguous or include a shortcut. Nothing was moved.');
  const occupied = fs.readdirSync(folder).map(item => item.toLowerCase()); const prefix = `${category.name}${isAiExpression(photo) ? '_AI' : ''}_`;
  let n = 1; while (n <= 999 && occupied.some(item => item.startsWith(`${prefix}${String(n).padStart(3, '0')}.`.toLowerCase()) || item.startsWith(`${prefix}${String(n).padStart(3, '0')}_`.toLowerCase()))) n++;
  if (n > 999) throw new Error('There are no free three-digit names in this category.');
  const newBase = `${prefix}${String(n).padStart(3, '0')}`; const moved: { from: string; to: string }[] = [];
  let changedSidecar = '';
  try {
    for (const entry of related) {
      const source = safeResolve('expressions', `${EXPRESSION_INBOX}/${entry.name}`);
      const target = safeResolve('expressions', `${destination}/${newBase}${entry.name.slice(base.length)}`);
      if (fs.existsSync(target)) throw new Error('A destination file already exists.');
      fs.renameSync(source, target); moved.push({ from: source, to: target });
    }
    if (sidecarUpdate) {
      const sidecar = safeResolve('expressions', `${destination}/${newBase}.txt`);
      if (!fs.lstatSync(sidecar).isFile() || fs.readFileSync(sidecar, 'utf8') !== sidecarUpdate.before) throw new Error('The tags changed. Review them again.');
      writeFileSafely(sidecar, sidecarUpdate.after); changedSidecar = sidecar;
    }
    clearExpressionIndex(); return { path: `${destination}/${newBase}${path.extname(photoPath)}` };
  } catch (error) {
    const failures: string[] = [];
    if (changedSidecar && sidecarUpdate) try { writeFileSafely(changedSidecar, sidecarUpdate.before); } catch { failures.push(changedSidecar); }
    for (const item of moved.reverse()) try { fs.renameSync(item.to, item.from); } catch { failures.push(item.to); }
    if (failures.length) throw new Error(`The move failed and some files could not be restored: ${failures.join(', ')}`);
    throw error;
  }
}

export function normalizationPrompt(): string {
  return 'Edit the attached photo into a high-resolution, photorealistic expression-library portrait of the same person. Preserve the exact facial expression, gaze, face shape, identity, age, hair and facial hair. Do not alter the expression, retouch the face, change his features, or make an exaggerated face. Center the portrait and frame it tightly with natural head-and-shoulders or upper-body proportions, without unnecessary empty space. Remove the existing background, text, graphics and other people, and replace it with a plain neutral contrasting studio background and soft, even lighting. Only extend missing shoulders or body where needed, naturally matching the existing photograph. Use the image generation tool, not code; save the result in the current folder as candidate.png. This is a candidate for human review.';
}

export function normalizeInboxPhoto(photoPath: string, ai: unknown, make: MakeImage = makeImage): NormalizeJob {
  if (ai !== 'codex' && ai !== 'gemini') throw new Error('Choose ChatGPT or Gemini.');
  const photo = findExpressionPhoto(buildExpressionIndex(), photoPath);
  if (!photo || photo.category !== EXPRESSION_INBOX) throw new Error('Choose an unambiguous inbox photo.');
  if ([...jobs.values()].some(job => job.photo === photoPath && job.state === 'working')) throw new Error('This photo is already being prepared.');
  const image = safeResolve('expressions', photoPath); const bytes = fs.readFileSync(image);
  const job: NormalizeJob = { id: randomUUID(), photo: photoPath, ai, state: 'working' }; jobs.set(job.id, job);
  void (async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-expression-prepare-'));
    try {
      const reference = path.join(work, `reference${path.extname(photoPath).toLowerCase()}`); fs.writeFileSync(reference, bytes, { flag: 'wx' });
      const result = await make(ai, normalizationPrompt(), work, 'candidate.png', { photo: reference });
      const generated = fs.readFileSync(result.image); const decoded = decodeReference(generated.toString('base64'));
      job.result = addBytes(`${photo.name} - Prepared`, decoded.data, decoded.ext, true).path;
      job.state = 'done';
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  })().catch((error: unknown) => { job.state = 'failed'; job.error = error instanceof Error ? error.message : String(error); });
  return job;
}

export function inboxNormalizationJob(id: string): NormalizeJob { const job = jobs.get(id); if (!job) throw new Error('Preparation job not found.'); return job; }
