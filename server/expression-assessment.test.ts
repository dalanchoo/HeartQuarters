import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { assessmentJob, assessmentPrompt, mergeAssessment, parseAssessment, startAssessment } from './expression-assessment';
import { buildExpressionIndex } from './expressions';
import { makeTree, removeTree } from './testing';

let root: string; let old: string;
beforeEach(() => { root = makeTree({ 'Positive/Warmth/Warmth.txt': 'A kind expression', 'Positive/Warmth/Warmth_001.jpg': 'image', 'Positive/Warmth/Warmth_001.txt': 'Warmth, 80%, CONFIRMED\r\nSmile, 60%, UNCONFIRMED\r\nAIGenerated, N/A, CONFIRMED\r\n', 'Negative/Anger/Anger.txt': 'An angry expression' }); old = config.expressionsDir; config.expressionsDir = root; });
afterEach(() => { config.expressionsDir = old; removeTree(root); });
describe('blind expression assessment', () => {
  it('includes vocabularies and definitions without the photo name, path or existing tags', () => {
    const cats = buildExpressionIndex().categories; const prompt = assessmentPrompt(cats);
    expect(prompt).toContain('A kind expression'); expect(prompt).toContain('EyesClosed'); expect(prompt).toContain('LookAtCamera'); expect(prompt).toContain('CloseUp');
    expect(prompt).not.toContain('Warmth_001'); expect(prompt).not.toContain(root); expect(prompt).not.toContain('80%, CONFIRMED');
  });
  it('validates answers and keeps confirmed and unrelated tags', () => {
    const cats = buildExpressionIndex().categories;
    const values = parseAssessment('[{"tag":"Smile","confidence":91},{"tag":"Warmth","confidence":20}]', cats);
    expect(mergeAssessment('Warmth, 80%, CONFIRMED\r\nSmile, 60%, UNCONFIRMED\r\nAIGenerated, N/A, CONFIRMED\r\n', values, cats)).toBe('Warmth, 80%, CONFIRMED\r\nAIGenerated, N/A, CONFIRMED\r\nSmile, 91%, UNCONFIRMED\r\n');
    expect(() => parseAssessment('[{"tag":"Unknown","confidence":50}]', cats)).toThrow();
    expect(() => parseAssessment('[{"tag":"Smile","confidence":500}]', cats)).toThrow();
    expect(() => parseAssessment('[]', cats)).toThrow();
  });
  it('uses a neutral temporary image and updates only after a valid answer', async () => {
    const job = startAssessment('Positive/Warmth/Warmth_001.jpg', async (_ai, prompt, cwd, images) => {
      expect(path.basename(images![0])).toBe('image.png'); expect(cwd).not.toContain('Warmth'); expect(fs.readdirSync(cwd)).toEqual(['image.png']); expect(prompt).not.toContain('Warmth_001');
      return '[{"tag":"Smile","confidence":91}]';
    }, async (_source, dest) => { fs.writeFileSync(dest, 'image'); });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(assessmentJob(job.id).state).toBe('done');
    expect(fs.readFileSync(path.join(root, 'Positive/Warmth/Warmth_001.txt'), 'utf8')).toContain('Smile, 91%, UNCONFIRMED');
  });
  it('does not overwrite edits made while the AI is working', async () => {
    const file = path.join(root, 'Positive/Warmth/Warmth_001.txt');
    const job = startAssessment('Positive/Warmth/Warmth_001.jpg', async () => { fs.appendFileSync(file, 'Frontal, N/A, CONFIRMED\n'); return '[{"tag":"Smile","confidence":91}]'; }, async (_source, dest) => { fs.writeFileSync(dest, 'image'); });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(assessmentJob(job.id).state).toBe('failed'); expect(fs.readFileSync(file, 'utf8')).toContain('Frontal, N/A, CONFIRMED'); expect(fs.readFileSync(file, 'utf8')).not.toContain('91%');
  });
});
