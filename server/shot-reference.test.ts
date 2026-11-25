import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { saveExpressionReferences } from './expression-references';
import { readShotList, seedShotList } from './expression-shot-list';
import { clearExpressionIndex } from './expressions';
import { deleteShotPicture, moveShotReferenceToInbox, removeShotReference, shotReferenceFile, shotReferences, startShotReference } from './shot-reference';
import { parseImageAi, type MakeImage } from './thumbnails';

let tmp: string; let oldRoot: string; let oldTrash: string; const env = ['HQ_EXPRESSION_REFS_FILE', 'HQ_SHOT_REFERENCES'] as const; let oldEnv: (string | undefined)[];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 1]);
const making = (data: Buffer, seen: { prompt?: string; refs?: string[] } = {}): MakeImage => async (_ai, prompt, cwd, out, opts) => {
  seen.prompt = prompt; seen.refs = [opts.photo!, ...(opts.refs ?? [])];
  const image = path.join(cwd, out); fs.writeFileSync(image, data); return { image, session: 'test' };
};
beforeEach(() => {
  tmp = makeTree({ 'Expressions/Positive/Relief/Relief.txt': 'Release after strain', 'Expressions/Neutral/Neutral_001.jpg': 'photo', 'Expressions/Neutral/Neutral_002.jpg': 'photo' });
  oldRoot = config.expressionsDir; config.expressionsDir = path.join(tmp, 'Expressions'); clearExpressionIndex();
  oldTrash = config.trashDir; config.trashDir = path.join(tmp, 'Trash'); // never the real Trash
  oldEnv = env.map(name => process.env[name]);
  process.env.HQ_EXPRESSION_REFS_FILE = path.join(tmp, 'refs.json'); process.env.HQ_SHOT_REFERENCES = path.join(tmp, 'shot-references');
});
afterEach(() => { config.expressionsDir = oldRoot; config.trashDir = oldTrash; clearExpressionIndex(); env.forEach((name, i) => { if (oldEnv[i] === undefined) delete process.env[name]; else process.env[name] = oldEnv[i]; }); removeTree(tmp); });

describe('shot reference pictures', () => {
  it('makes a picture from the look alone, using starred photos for likeness, and keeps it out of the library', async () => {
    saveExpressionReferences(['Neutral/Neutral_002.jpg'], true);
    const [shot] = seedShotList(); const seen: { prompt?: string; refs?: string[] } = {};
    const { finished } = startShotReference(shot.id, making(png, seen)); await finished;
    expect(seen.prompt).toContain('Expression: Relief.'); expect(seen.prompt).toContain('a quiet, relieved half-smile');
    expect(seen.refs).toEqual([path.join(tmp, 'Expressions/Neutral/Neutral_002.jpg')]);
    expect(shotReferences()[shot.id]).toMatchObject({ state: 'ready', pictures: ['reference-001.png'] });
    expect(fs.readFileSync(shotReferenceFile(shot.id, 'reference-001.png'))).toEqual(png);
    expect(fs.readdirSync(path.join(tmp, 'Expressions/Positive/Relief'))).toEqual(['Relief.txt']);
  });
  it('makes the picture with the image AI John chose, and refuses Claude, which cannot make images', async () => {
    const [shot] = seedShotList(); let used = '';
    const make: MakeImage = async (ai, ...rest) => { used = ai; return making(png)(ai, ...rest); };
    const { job, finished } = startShotReference(shot.id, make, 'gemini');
    expect(job.ai).toBe('gemini');
    await finished;
    expect(used).toBe('gemini');
    expect(shotReferences()[shot.id]).toMatchObject({ state: 'ready', ai: 'gemini' });
    expect(parseImageAi('codex')).toBe('codex');
    expect(() => parseImageAi('claude')).toThrow(/ChatGPT or Gemini/);
  });
  it('uses Neutral photos when nothing is starred, and keeps every picture, newest first', async () => {
    const [shot] = seedShotList(); const seen: { refs?: string[] } = {};
    await startShotReference(shot.id, making(png, seen)).finished;
    expect(seen.refs).toHaveLength(2);
    await startShotReference(shot.id, making(jpg)).finished;
    expect(shotReferences()[shot.id].pictures).toEqual(['reference-002.jpg', 'reference-001.png']);
    expect(fs.readFileSync(shotReferenceFile(shot.id, 'reference-002.jpg'))).toEqual(jpg);
  });
  it('keeps the earlier pictures when a new attempt fails', async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    await startShotReference(shot.id, async () => { throw new Error('ChatGPT is busy'); }).finished;
    expect(shotReferences()[shot.id]).toMatchObject({ state: 'failed', error: 'ChatGPT is busy', pictures: ['reference-001.png'] });
  });
  it('shows an older single picture as the first, and refuses any other file name', async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    fs.renameSync(path.join(tmp, 'shot-references', shot.id, 'reference-001.png'), path.join(tmp, 'shot-references', shot.id, 'reference.png'));
    await startShotReference(shot.id, making(jpg)).finished;
    expect(shotReferences()[shot.id].pictures).toEqual(['reference-001.jpg', 'reference.png']);
    expect(() => shotReferenceFile(shot.id, 'job.json')).toThrow(/no longer there/);
    expect(() => shotReferenceFile(shot.id, '../../refs.json')).toThrow(/no longer there/);
  });
  it('moves a chosen picture into the Expression Inbox as an AI image; the look keeps its other pictures', async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    await startShotReference(shot.id, making(jpg)).finished;
    const result = moveShotReferenceToInbox(shot.id, 'reference-001.png');
    expect(result.path).toBe('_Inbox/Shot List - AI Reference 01.png');
    expect(fs.readFileSync(path.join(tmp, 'Expressions', result.path))).toEqual(png);
    expect(fs.readFileSync(path.join(tmp, 'Expressions/_Inbox/Shot List - AI Reference 01.txt'), 'utf8')).toContain('AIGenerated');
    expect(result.pictures?.pictures).toEqual(['reference-002.jpg']);
    expect(shotReferences()[shot.id].pictures).toEqual(['reference-002.jpg']);
    expect(readShotList()[0].done).toBe(false);
    expect(() => moveShotReferenceToInbox(shot.id, 'reference-001.png')).toThrow(/no longer there/);
  });
  it("writes each picture's tag file when it is made, and it goes with the picture to the Inbox", async () => {
    const [shot] = seedShotList();
    const file = path.join(tmp, 'Expressions', 'Expression Shot List.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(data.shots[0], { framing: ['CloseUp', 'Frontal'], pose: ['LookAtCamera'], morphology: ['Smile', 'SoftEyes'], ruledOut: ['Squint', 'LookDown'] });
    fs.writeFileSync(file, JSON.stringify(data));
    const seen: { prompt?: string } = {};
    await startShotReference(shot.id, making(png, seen), 'gemini').finished;
    expect(seen.prompt).toContain('Facial details: Smile, SoftEyes. Avoid: Squint, LookDown.');
    // Ruled-out tags are disconfirmed in their group; the record of what was asked for comes last, as "#" lines.
    const tags = 'LookAtCamera, N/A, UNCONFIRMED\nLookDown, N/A, DISCONFIRMED\n==========\nCloseUp, N/A, UNCONFIRMED\nFrontal, N/A, UNCONFIRMED\n==========\nSmile, N/A, UNCONFIRMED\nSoftEyes, N/A, UNCONFIRMED\nSquint, N/A, DISCONFIRMED\n==========\nRelief, N/A, UNCONFIRMED\n==========\nAIGenerated, N/A, CONFIRMED\n'
      + '# Generated by: Gemini\n# Generated look: Relief\n# Generated description: Open eyes, a quiet, relieved half-smile, the look of someone who has just come back.\n# Generated with: LookAtCamera, CloseUp, Frontal, Smile, SoftEyes\n# Generated without: Squint, LookDown\n';
    expect(fs.readFileSync(path.join(tmp, 'shot-references', shot.id, 'reference-001.txt'), 'utf8')).toBe(tags);
    // The viewer gets them as unconfirmed suggestions, with the AI mark confirmed.
    expect(shotReferences()[shot.id].tags?.['reference-001.png']).toContainEqual({ tag: 'Relief', confidence: null, confirmed: false });
    expect(shotReferences()[shot.id].tags?.['reference-001.png']).toContainEqual({ tag: 'AIGenerated', confidence: null, confirmed: true });
    const result = moveShotReferenceToInbox(shot.id, 'reference-001.png');
    expect(fs.readFileSync(path.join(tmp, 'Expressions', result.path.replace(/\.png$/, '.txt')), 'utf8')).toBe(tags);
    expect(fs.existsSync(path.join(tmp, 'shot-references', shot.id, 'reference-001.txt'))).toBe(false);
  });
  it("gives a picture made before tag files the look's tags, and keeps a picture's own tag file with it in Trash", async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    await startShotReference(shot.id, making(jpg)).finished;
    fs.rmSync(path.join(tmp, 'shot-references', shot.id, 'reference-002.txt'));
    expect(shotReferences()[shot.id].tags?.['reference-002.jpg'].map(t => t.tag)).toEqual(['HeadShoulders', 'Relief', 'AIGenerated']);
    deleteShotPicture(shot.id, 'reference-001.png');
    const [slot] = fs.readdirSync(config.trashDir);
    expect(fs.readdirSync(path.join(config.trashDir, slot)).sort()).toEqual(['reference-001.png', 'reference-001.txt']);
  });
  it('refuses a second start while one runs, an unsorted shot and a bad id', async () => {
    const [shot] = seedShotList();
    const { finished } = startShotReference(shot.id, making(png));
    expect(() => startShotReference(shot.id, making(png))).toThrow(/already being made/);
    await finished;
    expect(() => startShotReference('../../elsewhere', making(png))).toThrow(/valid shot/);
    const file = path.join(tmp, 'Expressions', 'Expression Shot List.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.shots[1].category = ''; fs.writeFileSync(file, JSON.stringify(data));
    expect(() => startShotReference(readShotList()[1].id, making(png))).toThrow(/expression folder/);
  });
  it("moves a deleted shot's pictures to Trash", async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    removeShotReference(shot.id, 'Relief: "after" strain?');
    expect(shotReferences()[shot.id]).toBeUndefined();
    const [slot] = fs.readdirSync(config.trashDir);
    expect(slot).toMatch(/ - Shot List - Relief after strain \(deleted look\)$/);
    expect(fs.readdirSync(path.join(config.trashDir, slot, shot.id))).toContain('reference-001.png');
  });
  it('Delete Picture moves one picture to Trash and keeps the others', async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    await startShotReference(shot.id, making(jpg)).finished;
    expect(deleteShotPicture(shot.id, 'reference-001.png')?.pictures).toEqual(['reference-002.jpg']);
    const [slot] = fs.readdirSync(config.trashDir);
    expect(slot).toMatch(/\(picture\)$/);
    expect(fs.readdirSync(path.join(config.trashDir, slot)).sort()).toEqual(['reference-001.png', 'reference-001.txt']);
    expect(() => deleteShotPicture(shot.id, 'reference-001.png')).toThrow(/no longer there/);
    expect(() => deleteShotPicture(shot.id, '../Expression Shot List.json')).toThrow(/no longer there/);
    expect(() => deleteShotPicture('../../elsewhere', 'reference-002.jpg')).toThrow(/valid shot/);
  });
});
