import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appDir, safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex } from './expressions.js';
import { readExpressionReferences } from './expression-references.js';
import { geminiImageArgs, makeImage, type ImageAi, type MakeImage } from './thumbnails.js';
import { writeFileSafely } from './files.js';

type Options = { framing: string; angle: string; gaze: string };
type Job = { id: string; category: string; ai: ImageAi | 'unknown'; state: 'working' | 'ready' | 'failed'; error?: string; options: Options; format?: 'png' | 'jpg' | 'webp'; prompt: string; references: string[]; createdAt: string; recovered?: boolean };
const jobs = new Map<string, Job>();
const root = () => process.env.HQ_EXPRESSION_DRAFTS ?? path.join(appDir, 'data', 'expression-drafts');
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const valid = (id: string) => { if (!UUID.test(id)) throw new Error('Invalid candidate.'); return path.join(root(), id); };
const values = { framing: ['', 'HeadShoulders', 'UpperBody', 'CloseUp'], angle: ['', 'Frontal', 'ThreeQuarter', 'LeftFacing', 'RightFacing'], gaze: ['', 'LookAtCamera', 'LookOffCamera', 'LookLeft', 'LookRight', 'LookUp', 'LookDown'] };
let loadedRoot = '';
const metadataFile = (id: string) => path.join(valid(id), 'job.json');
function saveJob(job: Job): void { writeFileSafely(metadataFile(job.id), JSON.stringify(job, null, 2)); }

/** Reload candidates after an engine restart. Old image-only drafts stay available for recovery. */
export function reloadExpressionJobs(): void {
  jobs.clear(); loadedRoot = root();
  if (!fs.existsSync(root())) return;
  for (const entry of fs.readdirSync(root(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const dir = valid(entry.name); const file = metadataFile(entry.name);
    if (fs.existsSync(file)) {
      try {
        if (!fs.lstatSync(file).isFile()) continue;
        const job = JSON.parse(fs.readFileSync(file, 'utf8')) as Job;
        if (job.id !== entry.name || !['working', 'ready', 'failed'].includes(job.state) || !['codex', 'gemini', 'unknown'].includes(job.ai) || typeof job.category !== 'string' || typeof job.prompt !== 'string' || typeof job.createdAt !== 'string' || !Array.isArray(job.references) || !job.options || Object.entries(values).some(([key, allowed]) => !allowed.includes(job.options[key as keyof Options])) || (job.format !== undefined && !['png', 'jpg', 'webp'].includes(job.format)) || (job.state === 'ready' && !job.format)) continue;
        if (job.state === 'working') { job.state = 'failed'; job.error = 'Generation was interrupted when HeartQuarters stopped. Discard this candidate and try again.'; }
        jobs.set(job.id, job);
      } catch { /* Keep unrecognized files untouched. */ }
      continue;
    }
    const format = (['png', 'jpg', 'webp'] as const).find(ext => fs.existsSync(path.join(dir, `candidate.${ext}`)));
    if (format) jobs.set(entry.name, { id: entry.name, category: '', ai: 'unknown', state: 'ready', options: { framing: '', angle: '', gaze: '' }, format, prompt: '', references: [], createdAt: fs.statSync(path.join(dir, `candidate.${format}`)).mtime.toISOString(), recovered: true });
  }
}
function ensureLoaded(): void { if (loadedRoot !== root()) reloadExpressionJobs(); }

export function expressionPrompt(name: string, definition: string | null, options: Options): string {
  return [`Create a high-resolution, photorealistic portrait of John based on the attached reference photos. Preserve his identity, age, hair, facial hair and natural features; do not make him younger or change his face. Keep his complexion even without plastic skin or exaggerated redness.`, `Expression: ${name}. ${definition ?? ''} Make it clear, authentic and restrained, not an exaggerated YouTube face.`, `Framing: ${options.framing || 'head and shoulders with room around the head'}. Face orientation: ${options.angle || 'natural'}. Gaze: ${options.gaze || 'natural'}.`, 'Use soft, flattering, even studio lighting and a plain neutral contrasting background that is easy to remove. No text, graphics, watermark, or extra people.', 'Use your image generation tool, not code. Save the image in the current folder as candidate.png and reply with its full path.'].join('\n\n');
}

export function previewExpressionPrompt(category: string, options: Options): string {
  const index = buildExpressionIndex(); const selected = index.categories.find((c) => c.path === category);
  if (!selected || !category || index.categories.some((c) => c.parent === category)) throw new Error('Choose a specific expression category.');
  if (!options || Object.entries(values).some(([key, allowed]) => !allowed.includes(options[key as keyof Options]))) throw new Error('Choose valid framing, face direction and gaze options.');
  return expressionPrompt(selected.name, selected.definition, options);
}

export function startExpressionGeneration(category: string, refs: unknown, options: Options, ai: unknown = 'codex', make: MakeImage = makeImage): { job: Job; finished: Promise<void> } {
  if (ai !== 'codex' && ai !== 'gemini') throw new Error('Choose ChatGPT or Gemini to generate the expression.');
  ensureLoaded();
  const prompt = previewExpressionPrompt(category, options);
  const index = buildExpressionIndex();
  const saved = readExpressionReferences().paths;
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 5 || refs.some((p) => typeof p !== 'string' || !saved.includes(p) || !index.photos.some((photo) => photo.path === p))) throw new Error('Choose one to five saved reference photos.');
  const files = (refs as string[]).map((p) => safeResolve('expressions', p));
  const id = randomUUID(); const dir = valid(id); fs.mkdirSync(dir, { recursive: true });
  const sentPrompt = ai === 'gemini' ? geminiImageArgs(prompt, dir, { photo: files[0], refs: files.slice(1) })[1] : prompt;
  const job: Job = { id, category, ai, state: 'working', options, prompt: sentPrompt, references: refs as string[], createdAt: new Date().toISOString() }; saveJob(job); jobs.set(id, job);
  const finished = (async () => {
    const answer = await make(ai, prompt, dir, 'candidate.png', { photo: files[0], refs: files.slice(1) });
    const data = fs.readFileSync(answer.image);
    const format = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
      : data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'jpg'
      : data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!format) throw new Error('The generated image was not a PNG, JPEG or WebP.');
    const dest = path.join(dir, `candidate.${format}`); if (path.resolve(answer.image) !== path.resolve(dest)) fs.writeFileSync(dest, data, { flag: 'wx' });
    job.format = format;
    job.state = 'ready'; saveJob(job);
  })().catch((e: unknown) => { job.state = 'failed'; job.error = e instanceof Error ? e.message : String(e); try { saveJob(job); } catch { job.error += ' The candidate status could not be saved.'; } });
  return { job, finished };
}

export function expressionJob(id: string): Job { ensureLoaded(); const job = jobs.get(id); if (!job) throw new Error('Candidate not found; generate a new one.'); return job; }
export function expressionJobs(category?: string): Job[] { ensureLoaded(); return [...jobs.values()].filter((job) => !category || job.category === category).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function assignExpressionCategory(id: string, category: string): Job {
  const job = expressionJob(id);
  if (!job.recovered || job.state !== 'ready') throw new Error('Only an older recovered candidate needs a category.');
  previewExpressionPrompt(category, job.options);
  job.category = category; saveJob(job); return job;
}
export function candidateFile(id: string): string { const job = expressionJob(id); if (job.state !== 'ready' || !job.format) throw new Error('Candidate is not ready.'); return path.join(valid(id), `candidate.${job.format}`); }
export function rejectExpression(id: string): void { const job = expressionJob(id); if (job.state === 'working') throw new Error('Wait for generation to finish.'); fs.rmSync(valid(id), { recursive: true, force: true }); jobs.delete(id); }
export function approveExpression(id: string): { path: string } {
  const job = expressionJob(id); const image = candidateFile(id);
  if (!job.category) throw new Error('Choose a category for this recovered photo first.');
  const category = buildExpressionIndex().categories.find((c) => c.path === job.category);
  if (!category) throw new Error('The category no longer exists.');
  const folder = safeResolve('expressions', category.path); const name = `${category.name}_AI_${id.slice(0, 8)}`;
  const dest = safeResolve('expressions', `${category.path}/${name}.${job.format}`); const sidecar = safeResolve('expressions', `${category.path}/${name}.txt`);
  const data = fs.readFileSync(image); const groups = [[job.options.gaze], [job.options.framing, job.options.angle], [category.name]].map((group) => group.filter(Boolean)).filter((group) => group.length);
  fs.writeFileSync(sidecar, groups.map((group) => group.map((tag) => `${tag}, N/A, UNCONFIRMED`).join('\n')).join('\n==========\n') + '\n', { flag: 'wx' });
  try { fs.writeFileSync(dest, data, { flag: 'wx' }); } catch (e) { fs.unlinkSync(sidecar); throw e; }
  rejectExpression(id); clearExpressionIndex(); return { path: `${category.path}/${name}.${job.format}` };
}
