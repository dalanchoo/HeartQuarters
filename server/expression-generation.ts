import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appDir, safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex } from './expressions.js';
import { readExpressionReferences } from './expression-references.js';
import { makeImage, type ImageAi, type MakeImage } from './thumbnails.js';

type Options = { framing: string; angle: string; gaze: string };
type Job = { id: string; category: string; ai: ImageAi; state: 'working' | 'ready' | 'failed'; error?: string; options: Options; format?: 'png' | 'jpg' | 'webp' };
const jobs = new Map<string, Job>();
const root = () => process.env.HQ_EXPRESSION_DRAFTS ?? path.join(appDir, 'data', 'expression-drafts');
const valid = (id: string) => { if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('Invalid candidate.'); return path.join(root(), id); };
const values = { framing: ['', 'HeadShoulders', 'UpperBody', 'CloseUp'], angle: ['', 'Frontal', 'ThreeQuarter', 'LeftFacing', 'RightFacing'], gaze: ['', 'LookAtCamera', 'LookOffCamera', 'LookLeft', 'LookRight', 'LookUp', 'LookDown'] };

export function expressionPrompt(name: string, definition: string | null, options: Options): string {
  return [`Create a high-resolution, photorealistic portrait of John based on the attached reference photos. Preserve his identity, age, hair, facial hair and natural features; do not make him younger or change his face. Keep his complexion even without plastic skin or exaggerated redness.`, `Expression: ${name}. ${definition ?? ''} Make it clear, authentic and restrained, not an exaggerated YouTube face.`, `Framing: ${options.framing || 'head and shoulders with room around the head'}. Face orientation: ${options.angle || 'natural'}. Gaze: ${options.gaze || 'natural'}.`, 'Use soft, flattering, even studio lighting and a plain neutral contrasting background that is easy to remove. No text, graphics, watermark, or extra people.', 'Use your image generation tool, not code. Save the image in the current folder as candidate.png and reply with its full path.'].join('\n\n');
}

export function startExpressionGeneration(category: string, refs: unknown, options: Options, ai: unknown = 'codex', make: MakeImage = makeImage): { job: Job; finished: Promise<void> } {
  if (ai !== 'codex' && ai !== 'gemini') throw new Error('Choose ChatGPT or Gemini to generate the expression.');
  if ([...jobs.values()].some((job) => job.category === category)) throw new Error('Review or discard the existing candidate for this category first.');
  const index = buildExpressionIndex(); const selected = index.categories.find((c) => c.path === category);
  if (!selected || !category || index.categories.some((c) => c.parent === category)) throw new Error('Choose a specific expression category.');
  if (!options || Object.entries(values).some(([key, allowed]) => !allowed.includes(options[key as keyof Options]))) throw new Error('Choose valid framing, face direction and gaze options.');
  const saved = readExpressionReferences().paths;
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 5 || refs.some((p) => typeof p !== 'string' || !saved.includes(p) || !index.photos.some((photo) => photo.path === p))) throw new Error('Choose one to five saved reference photos.');
  const files = (refs as string[]).map((p) => safeResolve('expressions', p));
  const id = randomUUID(); const dir = valid(id); fs.mkdirSync(dir, { recursive: true });
  const job: Job = { id, category, ai, state: 'working', options }; jobs.set(id, job);
  const finished = (async () => {
    const answer = await make(ai, expressionPrompt(selected.name, selected.definition, options), dir, 'candidate.png', { photo: files[0], refs: files.slice(1) });
    const data = fs.readFileSync(answer.image);
    const format = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
      : data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'jpg'
      : data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
    if (!format) throw new Error('The generated image was not a PNG, JPEG or WebP.');
    const dest = path.join(dir, `candidate.${format}`); if (path.resolve(answer.image) !== path.resolve(dest)) fs.writeFileSync(dest, data, { flag: 'wx' });
    job.format = format;
    job.state = 'ready';
  })().catch((e: unknown) => { job.state = 'failed'; job.error = e instanceof Error ? e.message : String(e); });
  return { job, finished };
}

export function expressionJob(id: string): Job { const job = jobs.get(id); if (!job) throw new Error('Candidate not found; generate a new one.'); return job; }
export function expressionJobs(category: string): Job[] { return [...jobs.values()].filter((job) => job.category === category); }
export function candidateFile(id: string): string { const job = expressionJob(id); if (job.state !== 'ready' || !job.format) throw new Error('Candidate is not ready.'); return path.join(valid(id), `candidate.${job.format}`); }
export function rejectExpression(id: string): void { const job = expressionJob(id); if (job.state === 'working') throw new Error('Wait for generation to finish.'); fs.rmSync(valid(id), { recursive: true, force: true }); jobs.delete(id); }
export function approveExpression(id: string): { path: string } {
  const job = expressionJob(id); const image = candidateFile(id);
  const category = buildExpressionIndex().categories.find((c) => c.path === job.category);
  if (!category) throw new Error('The category no longer exists.');
  const folder = safeResolve('expressions', category.path); const name = `${category.name}_AI_${id.slice(0, 8)}`;
  const dest = safeResolve('expressions', `${category.path}/${name}.${job.format}`); const sidecar = safeResolve('expressions', `${category.path}/${name}.txt`);
  const data = fs.readFileSync(image); const groups = [[job.options.gaze], [job.options.framing, job.options.angle], [category.name]].map((group) => group.filter(Boolean)).filter((group) => group.length);
  fs.writeFileSync(sidecar, groups.map((group) => group.map((tag) => `${tag}, N/A, UNCONFIRMED`).join('\n')).join('\n==========\n') + '\n', { flag: 'wx' });
  try { fs.writeFileSync(dest, data, { flag: 'wx' }); } catch (e) { fs.unlinkSync(sidecar); throw e; }
  rejectExpression(id); clearExpressionIndex(); return { path: `${category.path}/${name}.${job.format}` };
}
