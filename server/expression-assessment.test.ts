import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { assessmentJob, assessmentPrompt, mergeAssessment, mergeModelAssessments, parseAssessment, parseAssessmentAis, readAssessmentReferences, startAssessment } from './expression-assessment';
import { buildExpressionIndex } from './expressions';
import { makeTree, removeTree } from './testing';

let root: string; let old: string;
beforeEach(() => { root = makeTree({ 'Framing.txt': 'Framing guidance: a tight crop.', 'PoseGaze.txt': 'Pose guidance: gaze and head are independent.', 'Morphology.txt': 'Morphology guidance: specific beats general.', 'ExpressionCategories.txt': 'Expression guidance: do not invent labels.', 'Positive/Warmth/Warmth.txt': 'A kind expression', 'Positive/Warmth/Warmth_001.jpg': 'image', 'Positive/Warmth/Warmth_001.txt': 'Warmth, 80%, CONFIRMED\r\nSmile, 60%, UNCONFIRMED\r\nAIGenerated, N/A, CONFIRMED\r\n# Motion: No\r\n', 'Negative/Anger/Anger.txt': 'An angry expression' }); old = config.expressionsDir; config.expressionsDir = root; });
afterEach(() => { config.expressionsDir = old; removeTree(root); });
describe('blind expression assessment', () => {
  it('includes vocabularies and definitions without the photo name, path or existing tags', () => {
    const cats = buildExpressionIndex().categories; const prompt = assessmentPrompt(cats, readAssessmentReferences());
    expect(prompt).toContain('A kind expression'); expect(prompt).toContain('Framing guidance: a tight crop.'); expect(prompt).toContain('Pose guidance: gaze and head are independent.'); expect(prompt).toContain('Morphology guidance: specific beats general.'); expect(prompt).toContain('Expression guidance: do not invent labels.'); expect(prompt).toContain('EyesClosed'); expect(prompt).toContain('LookAtCamera'); expect(prompt).toContain('CloseUp');
    expect(prompt).not.toContain('Warmth_001'); expect(prompt).not.toContain(root); expect(prompt).not.toContain('80%, CONFIRMED');
  });
  it('refuses to start if a shared reference file is missing', () => {
    fs.unlinkSync(path.join(root, 'PoseGaze.txt'));
    expect(() => startAssessment('Positive/Warmth/Warmth_001.jpg', async () => '[]', async () => {})).toThrow(/PoseGaze\.txt/);
    expect(fs.readFileSync(path.join(root, 'Positive/Warmth/Warmth_001.txt'), 'utf8')).toContain('Warmth, 80%, CONFIRMED');
  });
  it('validates answers and keeps confirmed and unrelated tags', () => {
    const cats = buildExpressionIndex().categories;
    const values = parseAssessment('[{"tag":"Smile","confidence":91},{"tag":"Warmth","confidence":20}]', cats);
    expect(mergeAssessment('Warmth, 80%, CONFIRMED\r\nSmile, 60%, UNCONFIRMED\r\nAIGenerated, N/A, CONFIRMED\r\n', values, cats)).toBe('Warmth, 80%, CONFIRMED\r\nAIGenerated, N/A, CONFIRMED\r\nSmile, 91%, UNCONFIRMED\r\n');
    expect(() => parseAssessment('[{"tag":"Unknown","confidence":50}]', cats)).toThrow();
    expect(() => parseAssessment('[{"tag":"Smile","confidence":500}]', cats)).toThrow();
    expect(() => parseAssessment('[]', cats)).toThrow();
  });
  it('keeps scores of at least 75% and preserves confirmed tags below the cutoff', () => {
    const cats = buildExpressionIndex().categories;
    const values = parseAssessment('[{"tag":"Smile","confidence":74},{"tag":"CloseUp","confidence":75},{"tag":"Warmth","confidence":20}]', cats);
    const merged = mergeAssessment('Warmth, 42%, CONFIRMED\nSmile, 99%, UNCONFIRMED\nOldGuess, 20%, UNCONFIRMED\n', values, cats);
    expect(merged).toContain('Warmth, 42%, CONFIRMED');
    expect(merged).toContain('CloseUp, 75%, UNCONFIRMED');
    expect(merged).not.toContain('Smile'); expect(merged).not.toContain('OldGuess');
  });
  it('keeps disconfirmed attributes even if the AI suggests them again', () => {
    const cats = buildExpressionIndex().categories;
    const result = mergeModelAssessments('Smile, 60%, DISCONFIRMED\n', { claude: [{ tag: 'Smile', confidence: 95 }], codex: [], gemini: [] }, cats, '2026-11-28');
    expect(result).toBe('Smile, 60%, DISCONFIRMED, claude=95%\n# AssessedWithAllThreeAIs\n# Assessed: claude=2026-11-28, codex=2026-11-28, gemini=2026-11-28\n');
  });
  it('updates the assessed date only for the AIs that ran and keeps earlier dates for the others', () => {
    const cats = buildExpressionIndex().categories;
    const merged = mergeModelAssessments('Smile, 80%, UNCONFIRMED\n# Assessed: claude=2026-11-10, codex=2026-11-12\n', { gemini: [{ tag: 'Smile', confidence: 90 }] }, cats, '2026-11-28');
    expect(merged).toContain('# Assessed: claude=2026-11-10, codex=2026-11-12, gemini=2026-11-28');
    expect(merged).toContain('# AssessedWithAllThreeAIs');
  });
  it('records separate model scores, uses the highest for filtering and keeps confirmations', () => {
    const cats = buildExpressionIndex().categories;
    const merged = mergeModelAssessments('Warmth, 42%, CONFIRMED\n', { claude: [{ tag: 'Smile', confidence: 90 }, { tag: 'Warmth', confidence: 50 }], codex: [{ tag: 'Smile', confidence: 80 }], gemini: [{ tag: 'Smile', confidence: 74 }, { tag: 'Warmth', confidence: 80 }] }, cats);
    expect(merged).toContain('Warmth, 42%, CONFIRMED, claude=50%, gemini=80%');
    expect(merged).toContain('Smile, 90%, UNCONFIRMED, claude=90%, codex=80%');
    expect(merged).not.toContain('gemini=74%');
  });
  it('leaves the sidecar unchanged if any AI fails', async () => {
    const file = path.join(root, 'Positive/Warmth/Warmth_001.txt'); const before = fs.readFileSync(file, 'utf8');
    const directories = new Set<string>();
    const job = startAssessment('Positive/Warmth/Warmth_001.jpg', async (ai, _prompt, cwd) => { directories.add(cwd); if (ai === 'gemini') throw new Error('not signed in'); return '[{"tag":"Smile","confidence":91}]'; }, async (_source, dest) => { fs.writeFileSync(dest, 'image'); });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(directories.size).toBe(3); expect(job.error).toContain('Gemini'); expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
  it('uses separate neutral images and gives all three AIs the same references', async () => {
    const prompts = new Set<string>(); const models = new Set<string>();
    const job = startAssessment('Positive/Warmth/Warmth_001.jpg', async (ai, prompt, cwd, images) => {
      prompts.add(prompt); models.add(ai);
      expect(path.basename(images![0])).toBe('image.png'); expect(cwd).not.toContain('Warmth'); expect(fs.readdirSync(cwd)).toEqual(['image.png']); expect(prompt).not.toContain('Warmth_001'); expect(prompt).toContain('Pose guidance: gaze and head are independent.');
      return '[{"tag":"Smile","confidence":91}]';
    }, async (_source, dest) => { fs.writeFileSync(dest, 'image'); });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(assessmentJob(job.id).state).toBe('done'); expect(models).toEqual(new Set(['claude', 'codex', 'gemini'])); expect(prompts.size).toBe(1);
    expect(fs.readFileSync(path.join(root, 'Positive/Warmth/Warmth_001.txt'), 'utf8')).toContain('Smile, 91%, UNCONFIRMED');
  });
  it('asks only the AIs John ticked, and only all three mark the photo as assessed by all three', async () => {
    const models: string[] = [];
    const job = startAssessment('Positive/Warmth/Warmth_001.jpg', async (ai) => { models.push(ai); return '[{"tag":"Smile","confidence":91}]'; }, async (_source, dest) => { fs.writeFileSync(dest, 'image'); }, parseAssessmentAis(['gemini']));
    expect(job.models).toMatchObject({ claude: 'skipped', codex: 'skipped' });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(job.state).toBe('done'); expect(models).toEqual(['gemini']);
    const text = fs.readFileSync(path.join(root, 'Positive/Warmth/Warmth_001.txt'), 'utf8');
    expect(text).toContain('Smile, 91%, UNCONFIRMED, gemini=91%'); expect(text).not.toContain('AssessedWithAllThreeAIs');
  });
  it('checks which AIs the page sends', () => {
    expect(parseAssessmentAis(undefined)).toEqual(['claude', 'codex', 'gemini']);
    expect(parseAssessmentAis(['gemini', 'claude'])).toEqual(['claude', 'gemini']);
    expect(() => parseAssessmentAis([])).toThrow(/at least one/);
    expect(() => parseAssessmentAis(['bard'])).toThrow(/Choose which AIs/);
  });
  it('does not overwrite edits made while the AI is working', async () => {
    const file = path.join(root, 'Positive/Warmth/Warmth_001.txt');
    const job = startAssessment('Positive/Warmth/Warmth_001.jpg', async () => { fs.appendFileSync(file, 'Frontal, N/A, CONFIRMED\n'); return '[{"tag":"Smile","confidence":91}]'; }, async (_source, dest) => { fs.writeFileSync(dest, 'image'); });
    await vi.waitFor(() => expect(assessmentJob(job.id).state).not.toBe('working'));
    expect(assessmentJob(job.id).state).toBe('failed'); expect(fs.readFileSync(file, 'utf8')).toContain('Frontal, N/A, CONFIRMED'); expect(fs.readFileSync(file, 'utf8')).not.toContain('91%');
  });
});
