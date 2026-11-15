import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { saveExpressionReferences } from './expression-references';
import { approveExpression, candidateFile, expressionJob, rejectExpression, startExpressionGeneration } from './expression-generation';
import type { MakeImage } from './thumbnails';
let tmp: string; let oldRoot: string; let oldRefs: string | undefined; let oldDrafts: string | undefined;
const png = Buffer.from([137,80,78,71,13,10,26,10,1]);
const options = { framing: 'HeadShoulders', angle: 'Frontal', gaze: 'LookAtCamera' };
beforeEach(() => { tmp = makeTree({ 'Expressions/Positive/Warmth/Warmth.txt': 'A gentle smile', 'Expressions/Neutral/ref.jpg': 'photo' }); oldRoot = config.expressionsDir; config.expressionsDir = path.join(tmp, 'Expressions'); oldRefs = process.env.HQ_EXPRESSION_REFS_FILE; oldDrafts = process.env.HQ_EXPRESSION_DRAFTS; process.env.HQ_EXPRESSION_REFS_FILE = path.join(tmp, 'refs.json'); process.env.HQ_EXPRESSION_DRAFTS = path.join(tmp, 'drafts'); saveExpressionReferences(['Neutral/ref.jpg'], true); });
afterEach(() => { config.expressionsDir = oldRoot; if (oldRefs === undefined) delete process.env.HQ_EXPRESSION_REFS_FILE; else process.env.HQ_EXPRESSION_REFS_FILE = oldRefs; if (oldDrafts === undefined) delete process.env.HQ_EXPRESSION_DRAFTS; else process.env.HQ_EXPRESSION_DRAFTS = oldDrafts; removeTree(tmp); });
const fake: MakeImage = async (_ai, _prompt, cwd, out) => { const image = path.join(cwd, out); fs.writeFileSync(image, png); return { image, session: 'test' }; };
describe('expression generation', () => {
  it('keeps the candidate separate until approval and records unconfirmed tags', async () => {
    const { job, finished } = startExpressionGeneration('Positive/Warmth', ['Neutral/ref.jpg'], options, 'codex', fake); await finished;
    expect(expressionJob(job.id).state).toBe('ready'); expect(fs.existsSync(candidateFile(job.id))).toBe(true);
    expect(() => startExpressionGeneration('Positive/Warmth', ['Neutral/ref.jpg'], options, 'codex', fake)).toThrow(/existing candidate/);
    expect(fs.readdirSync(path.join(tmp, 'Expressions/Positive/Warmth'))).toEqual(['Warmth.txt']);
    const result = approveExpression(job.id); expect(fs.readFileSync(path.join(tmp, 'Expressions', result.path))).toEqual(png);
    expect(fs.readFileSync(path.join(tmp, 'Expressions', result.path.replace(/\.png$/, '.txt')), 'utf8')).toContain('Warmth, N/A, UNCONFIRMED');
  });
  it('rejects unsafe references and discards a rejected candidate', async () => {
    expect(() => startExpressionGeneration('Positive/Warmth', ['../bad.jpg'], options, 'codex', fake)).toThrow();
    const { job, finished } = startExpressionGeneration('Positive/Warmth', ['Neutral/ref.jpg'], options, 'codex', fake); await finished;
    rejectExpression(job.id); expect(() => expressionJob(job.id)).toThrow();
    expect(fs.readdirSync(path.join(tmp, 'Expressions/Positive/Warmth'))).toEqual(['Warmth.txt']);
  });
  it('uses Gemini with all selected photos and keeps the provider on the job', async () => {
    const other = path.join(tmp, 'Expressions/Positive/Joy/other.jpg'); fs.mkdirSync(path.dirname(other), { recursive: true }); fs.writeFileSync(other, 'photo');
    saveExpressionReferences(['Neutral/ref.jpg', 'Positive/Joy/other.jpg'], false);
    let received: Parameters<MakeImage> | undefined;
    const gemini: MakeImage = async (...args) => { received = args; return fake(...args); };
    const { job, finished } = startExpressionGeneration('Positive/Warmth', ['Neutral/ref.jpg', 'Positive/Joy/other.jpg'], options, 'gemini', gemini);
    await finished;
    expect(job).toMatchObject({ ai: 'gemini', state: 'ready' });
    expect(received?.[0]).toBe('gemini');
    expect(received?.[4].photo).toBe(path.join(tmp, 'Expressions/Neutral/ref.jpg'));
    expect(received?.[4].refs).toEqual([other]);
    rejectExpression(job.id);
    expect(() => startExpressionGeneration('Positive/Warmth', ['Neutral/ref.jpg'], options, 'claude', fake)).toThrow(/ChatGPT or Gemini/);
  });
  it('keeps the correct file type if Gemini returns a JPEG', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const generate: MakeImage = async (_ai, _prompt, cwd, out) => { const image = path.join(cwd, out); fs.writeFileSync(image, jpeg); return { image, session: 'test' }; };
    const { job, finished } = startExpressionGeneration('Positive/Warmth', ['Neutral/ref.jpg'], options, 'gemini', generate);
    await finished;
    expect(job.state).toBe('ready');
    expect(candidateFile(job.id)).toMatch(/\.jpg$/);
    const result = approveExpression(job.id);
    expect(result.path).toMatch(/\.jpg$/);
    expect(fs.readFileSync(path.join(tmp, 'Expressions', result.path))).toEqual(jpeg);
  });
});
