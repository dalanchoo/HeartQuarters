import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AI_NAMES, aiCommand, type AiId } from './ai.js';
import type { AskAi } from './brief.js';
import { safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex, parseTags, type ExpressionCategory } from './expressions.js';
import { writeFileSafely } from './files.js';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from './expression-attribute-vocabulary.js';

const exec = promisify(execFile);
type Assessment = { tag: string; confidence: number };
type Job = { id: string; photo: string; state: 'working' | 'done' | 'failed'; models: Record<AiId, 'waiting' | 'working' | 'done' | 'failed'>; error?: string };
const MODELS: AiId[] = ['claude', 'codex', 'gemini'];
const jobs = new Map<string, Job>();
const active = new Map<string, string>();

export function assessmentVocabulary(categories: ExpressionCategory[]) {
  const expressions = categories.filter(c => c.path).map(c => ({ name: c.name, definition: c.definition ?? 'No definition provided.' }));
  return { framing: FRAMING_TAGS, pose: POSE_TAGS, morphology: MORPHOLOGY_TAGS, expressions };
}
export function assessmentPrompt(categories: ExpressionCategory[]): string {
  const vocabulary = assessmentVocabulary(categories);
  return [
    'Assess only the visible photo in image.png in this temporary folder. Open that image. This is a blind assessment: do not seek or use the original filename, folder, sidecars, prior assessments, or any other files or context.',
    'Independently assess framing, pose and gaze, facial morphology, and expressions using only the choices below. Expressions may overlap. Do not infer the category from anything outside the image.',
    `Framing: ${JSON.stringify(vocabulary.framing)}\nPose and gaze: ${JSON.stringify(vocabulary.pose)}\nMorphology: ${JSON.stringify(vocabulary.morphology)}\nExpressions with definitions: ${JSON.stringify(vocabulary.expressions)}`,
    'Return ONLY a JSON array of objects, e.g. [{"tag":"CloseUp","confidence":80}]. Include each applicable option and an integer confidence from 1 to 100. Omit options you cannot support. Use exact option names, no duplicates or other labels. Do not create or modify files.'
  ].join('\n\n');
}
export function parseAssessment(answer: string, categories: ExpressionCategory[]): Assessment[] {
  const json = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown; try { parsed = JSON.parse(json); } catch { throw new Error('The AI did not return a valid assessment. No tags were changed.'); }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('The AI returned an empty or invalid assessment. No tags were changed.');
  const vocab = assessmentVocabulary(categories);
  const allowed = new Map([...vocab.framing, ...vocab.pose, ...vocab.morphology, ...vocab.expressions.map(e => e.name)].map(name => [name.toLowerCase(), name]));
  const seen = new Set<string>();
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('The AI returned invalid tags. No tags were changed.');
    const entry = item as Record<string, unknown>; const key = typeof entry.tag === 'string' ? entry.tag.toLowerCase() : ''; const tag = allowed.get(key);
    if (!tag || seen.has(key) || !Number.isInteger(entry.confidence) || (entry.confidence as number) < 1 || (entry.confidence as number) > 100) throw new Error('The AI returned invalid or duplicate tags. No tags were changed.');
    seen.add(key); return { tag, confidence: entry.confidence as number };
  });
}
export function mergeAssessment(text: string, values: Assessment[], categories: ExpressionCategory[]): string {
  const v = assessmentVocabulary(categories);
  const known = new Set([...v.framing, ...v.pose, ...v.morphology, ...v.expressions.map(e => e.name)].map(s => s.toLowerCase()));
  const lines = text.split(/\r?\n/); const retained = lines.filter(line => { const tag = parseTags(line)[0]; return !tag || tag.confirmed || (!known.has(tag.tag.toLowerCase()) && (tag.confidence === null || tag.confidence >= 75)); });
  while (retained.at(-1) === '') retained.pop();
  const confirmed = new Set(parseTags(retained.join('\n')).filter(t => t.confirmed).map(t => t.tag.toLowerCase()));
  for (const value of values) if (value.confidence >= 75 && !confirmed.has(value.tag.toLowerCase())) retained.push(`${value.tag}, ${value.confidence}%, UNCONFIRMED`);
  return retained.join(text.includes('\r\n') ? '\r\n' : '\n') + (text.includes('\r\n') ? '\r\n' : '\n');
}
/** Combine the highest eligible score for filtering while recording every model's own score. */
export function mergeModelAssessments(text: string, results: Record<AiId, Assessment[]>, categories: ExpressionCategory[]): string {
  const scores = new Map<string, { tag: string; byAi: Partial<Record<AiId, number>> }>();
  for (const ai of MODELS) for (const value of results[ai]) {
    const key = value.tag.toLowerCase(); const entry = scores.get(key) ?? { tag: value.tag, byAi: {} };
    entry.byAi[ai] = value.confidence; scores.set(key, entry);
  }
  const aggregated = [...scores.values()].map(entry => ({ tag: entry.tag, confidence: Math.max(...Object.values(entry.byAi)) }));
  const base = mergeAssessment(text, aggregated, categories);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return base.split(/\r?\n/).map(line => {
    const parsed = parseTags(line)[0]; if (!parsed) return line;
    const clean = line.replace(/,\s*(?:claude|codex|gemini)=\d{1,3}%/gi, '');
    const entry = scores.get(parsed.tag.toLowerCase()); if (!entry) return clean;
    const details = MODELS.flatMap(ai => { const score = entry.byAi[ai]; return score !== undefined && (score >= 75 || parsed.confirmed) ? [`${ai}=${score}%`] : []; });
    return clean + (details.length ? `, ${details.join(', ')}` : '');
  }).join(newline);
}
export function assessmentJob(id: string): Job { const job = jobs.get(id); if (!job) throw new Error('Assessment not found.'); return job; }
export function startAssessment(photoPath: string, ask: AskAi = askBlind, prepare: (source: string, dest: string) => Promise<void> = prepareImage): Job {
  const index = buildExpressionIndex();
  if (!index.photos.some(p => p.path === photoPath)) throw new Error('Choose a photo in the expression library.');
  if (active.has(photoPath)) throw new Error('This photo is already being assessed.');
  const source = safeResolve('expressions', photoPath); const original = fs.statSync(source); if (!original.isFile()) throw new Error('Photo not found.');
  const sidecar = safeResolve('expressions', photoPath.slice(0, -path.extname(photoPath).length) + '.txt');
  const readSidecar = () => { try { if (!fs.lstatSync(sidecar).isFile()) throw new Error('The sidecar must be a real file.'); return fs.readFileSync(sidecar, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
  const before = readSidecar(); const job: Job = { id: randomUUID(), photo: photoPath, state: 'working', models: { claude: 'waiting', codex: 'waiting', gemini: 'waiting' } }; jobs.set(job.id, job); active.set(photoPath, job.id);
  void (async () => {
    const settled = await Promise.allSettled(MODELS.map(async ai => {
      job.models[ai] = 'working';
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-blind-'));
      try {
        const image = path.join(dir, 'image.png'); await prepare(source, image);
        const answer = await ask(ai, assessmentPrompt(index.categories), dir, [image]);
        const values = parseAssessment(answer, index.categories); job.models[ai] = 'done'; return values;
      } catch (error) { job.models[ai] = 'failed'; throw error; }
      finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Don't misreport a saved assessment. */ } }
    }));
    const errors = settled.flatMap((result, i) => result.status === 'rejected' ? [`${AI_NAMES[MODELS[i]]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
    if (errors.length) throw new Error(`Assessment failed; no tags were changed. ${errors.join(' ')}`);
    const results = Object.fromEntries(settled.map((result, i) => [MODELS[i], result.status === 'fulfilled' ? result.value : []])) as Record<AiId, Assessment[]>;
    const currentPhoto = fs.statSync(safeResolve('expressions', photoPath));
    if (currentPhoto.size !== original.size || currentPhoto.mtimeMs !== original.mtimeMs || readSidecar() !== before) throw new Error('The photo or sidecar changed during assessment. No tags were changed; try again.');
    const updated = mergeModelAssessments(before ?? '', results, index.categories);
    if (before === null) fs.writeFileSync(sidecar, updated, { flag: 'wx' }); else writeFileSafely(sidecar, updated);
    clearExpressionIndex(); job.state = 'done';
  })().catch((e: unknown) => { job.state = 'failed'; job.error = e instanceof Error ? e.message : String(e); }).finally(() => active.delete(photoPath));
  return job;
}
async function prepareImage(source: string, dest: string): Promise<void> {
  await exec('ffmpeg', ['-v', 'error', '-i', source, '-map_metadata', '-1', '-frames:v', '1', dest], { windowsHide: true });
}

/** Run with only the temporary image explicitly provided; no project or skill directories are added. */
const askBlind: AskAi = async (ai, prompt, cwd, images = []) => {
  const [cmd, ...prefix] = aiCommand(ai);
  const output = path.join(cwd, 'answer.json');
  const args = ai === 'codex' ? ['exec', '--skip-git-repo-check', '-s', 'read-only', '-o', output, prompt, ...images.flatMap(image => ['-i', image])]
    : ai === 'claude' ? ['-p', prompt, '--output-format', 'json', '--permission-mode', 'default', '--allowedTools', 'Read']
    : ['-p', prompt, '--output-format', 'text', '--sandbox', '--add-dir', cwd, '--settings', JSON.stringify({ toolPermission: 'proceed-in-sandbox', enableTerminalSandbox: true, permissions: { allow: ['read_file(*)'] } }), '--print-timeout', '1200s'];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, [...prefix, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (value: string) => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', (value: string) => { stderr = (stderr + value).slice(-2000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20 * 60 * 1000);
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Could not start the AI: ${error.message}`)); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(timedOut ? 'The assessment timed out.' : stderr.trim().slice(-600) || `The AI stopped (exit code ${code}).`)); });
  });
  if (ai === 'codex') return fs.readFileSync(output, 'utf8');
  if (ai === 'claude') { const result = JSON.parse(out) as { is_error?: boolean; result?: string }; if (result.is_error || !result.result) throw new Error(result.result || 'Claude could not assess the image.'); return result.result; }
  return out;
};
