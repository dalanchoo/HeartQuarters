import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { saveExpressionReferences } from './expression-references';
import { readShotList, seedShotList } from './expression-shot-list';
import { clearExpressionIndex } from './expressions';
import { removeShotReference, shotReferenceFile, shotReferences, startShotReference } from './shot-reference';
import type { MakeImage } from './thumbnails';

let tmp: string; let oldRoot: string; const env = ['HQ_EXPRESSION_REFS_FILE', 'HQ_SHOT_REFERENCES'] as const; let oldEnv: (string | undefined)[];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 1]);
const making = (data: Buffer, seen: { prompt?: string; refs?: string[] } = {}): MakeImage => async (_ai, prompt, cwd, out, opts) => {
  seen.prompt = prompt; seen.refs = [opts.photo!, ...(opts.refs ?? [])];
  const image = path.join(cwd, out); fs.writeFileSync(image, data); return { image, session: 'test' };
};
beforeEach(() => {
  tmp = makeTree({ 'Expressions/Positive/Relief/Relief.txt': 'Release after strain', 'Expressions/Neutral/Neutral_001.jpg': 'photo', 'Expressions/Neutral/Neutral_002.jpg': 'photo' });
  oldRoot = config.expressionsDir; config.expressionsDir = path.join(tmp, 'Expressions'); clearExpressionIndex();
  oldEnv = env.map(name => process.env[name]);
  process.env.HQ_EXPRESSION_REFS_FILE = path.join(tmp, 'refs.json'); process.env.HQ_SHOT_REFERENCES = path.join(tmp, 'shot-references');
});
afterEach(() => { config.expressionsDir = oldRoot; clearExpressionIndex(); env.forEach((name, i) => { if (oldEnv[i] === undefined) delete process.env[name]; else process.env[name] = oldEnv[i]; }); removeTree(tmp); });

describe('shot reference pictures', () => {
  it('makes a picture from the look alone, using starred photos for likeness, and keeps it out of the library', async () => {
    saveExpressionReferences(['Neutral/Neutral_002.jpg'], true);
    const [shot] = seedShotList(); const seen: { prompt?: string; refs?: string[] } = {};
    const { finished } = startShotReference(shot.id, making(png, seen)); await finished;
    expect(seen.prompt).toContain('Expression: Relief.'); expect(seen.prompt).toContain('a quiet, relieved half-smile');
    expect(seen.refs).toEqual([path.join(tmp, 'Expressions/Neutral/Neutral_002.jpg')]);
    expect(shotReferences()[shot.id].state).toBe('ready');
    expect(fs.readFileSync(shotReferenceFile(shot.id))).toEqual(png);
    expect(fs.readdirSync(path.join(tmp, 'Expressions/Positive/Relief'))).toEqual(['Relief.txt']);
  });
  it('uses Neutral photos when nothing is starred, and replaces the old picture with the new type', async () => {
    const [shot] = seedShotList(); const seen: { refs?: string[] } = {};
    await startShotReference(shot.id, making(png, seen)).finished;
    expect(seen.refs).toHaveLength(2);
    await startShotReference(shot.id, making(jpg)).finished;
    expect(shotReferenceFile(shot.id).endsWith('reference.jpg')).toBe(true);
    expect(fs.readdirSync(path.join(tmp, 'shot-references', shot.id)).sort()).toEqual(['job.json', 'reference.jpg']);
  });
  it('keeps the previous picture when a new attempt fails', async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    await startShotReference(shot.id, async () => { throw new Error('ChatGPT is busy'); }).finished;
    expect(shotReferences()[shot.id]).toMatchObject({ state: 'failed', error: 'ChatGPT is busy' });
    expect(fs.readFileSync(shotReferenceFile(shot.id))).toEqual(png);
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
  it('removes a deleted shot\'s picture', async () => {
    const [shot] = seedShotList();
    await startShotReference(shot.id, making(png)).finished;
    removeShotReference(shot.id);
    expect(shotReferences()[shot.id]).toBeUndefined();
  });
});
