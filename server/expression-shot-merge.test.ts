import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { addExpressionShots, readShotList, setShotDone } from './expression-shot-list';
import { addShotsMerging, applyDuplicates, duplicatesPrompt, mergeDuplicateShots, parseDuplicates } from './expression-shot-merge';
import { shotReferences } from './shot-reference';
import { makeTree, removeTree } from './testing';

let root: string;
let saved: { projects: string; expressions: string; refs: string | undefined };
beforeEach(() => {
  root = makeTree({ 'Projects/Video/Longform/Packaging/': '', 'Projects/Other/Longform/Packaging/': '', 'Expressions/': '' });
  saved = { projects: config.videoProjectsDir, expressions: config.expressionsDir, refs: process.env.HQ_SHOT_REFERENCES };
  config.videoProjectsDir = path.join(root, 'Projects'); config.expressionsDir = path.join(root, 'Expressions');
  process.env.HQ_SHOT_REFERENCES = path.join(root, 'Refs');
});
afterEach(() => {
  config.videoProjectsDir = saved.projects; config.expressionsDir = saved.expressions;
  if (saved.refs === undefined) delete process.env.HQ_SHOT_REFERENCES; else process.env.HQ_SHOT_REFERENCES = saved.refs;
  removeTree(root);
});

const CALM_A = 'Composure > Calm (steady eyes on the camera, a slight settled smile)';
const CALM_B = 'Composure > Calm (relaxed, reassuring half-smile, soft eyes, looking into the camera)';
const CALM_CLOSED = 'Composure > Calm (eyes closed, a small relaxed smile)';
const CURIOUS = 'Cognitive > Curiosity (head tilted, one eyebrow raised)';
/** A fake AI that groups the looks whose descriptions contain the given words. */
const grouping = (...groups: string[][]) => async (prompt: string) => {
  const looks = JSON.parse(prompt.split('\n\n').pop()!) as { looks: { id: string; look: string }[] }[];
  const all = looks.flatMap(f => f.looks);
  return `Sure:\n${JSON.stringify({ duplicates: groups.map(words => words.map(w => all.find(l => l.look.toLowerCase().includes(w))?.id ?? 'unknown')) })}`;
};
const picture = (id: string, name: string) => {
  const dir = path.join(root, 'Refs', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), name);
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ shotId: id, state: 'ready', prompt: 'p', createdAt: 'x' }));
};

describe('merging duplicate looks', () => {
  it('asks only about folders with more than one look, by id, and reads the answer safely', () => {
    const shots = addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }, { expression: CALM_B, context: 'Idea 2' }, { expression: CURIOUS, context: 'Idea 3' }]);
    const prompt = duplicatesPrompt(shots.filter(s => s.category === 'Composure/Calm'));
    expect(prompt).toContain('Composure > Calm'); expect(prompt).toContain(shots[0].id); expect(prompt).not.toContain('Curiosity');
    const [a, b, c] = shots.map(s => s.id);
    // Unknown ids, a repeated id and a group across folders are dropped.
    expect(parseDuplicates(`{"duplicates": [["${a}", "${b}", "nope"], ["${b}", "${c}"], ["${a}"]]}`, shots)).toEqual([[a, b]]);
    expect(() => parseDuplicates('I could not decide.', shots)).toThrow(/did not answer/);
  });

  it('keeps the first look of a group, with every source, any missing tags, and done if either was', () => {
    const shots = addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }, { expression: CALM_B, context: 'Idea 2' }]);
    shots[1].done = true; shots[1].framing = ['CloseUp'];
    const [a, b] = shots.map(s => s.id);
    expect(applyDuplicates(shots, [[a, b]])).toEqual([[b, a]]);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ done: true, framing: ['CloseUp'] });
    expect(shots[0].sources.map(s => s.text)).toEqual([CALM_A, CALM_B]);
  });

  it("adds a video's suggestions, merging a differently worded look into the one already there", async () => {
    const [kept] = addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }]);
    setShotDone(kept.id, true);
    const result = await addShotsMerging('Other/Longform', [{ expression: CALM_B, context: 'Top 2' }, { expression: CALM_CLOSED, context: 'Idea 1' }, { expression: CURIOUS, context: 'Idea 4' }], grouping(['steady eyes', 'reassuring']));
    expect(result).toMatchObject({ added: 2, merged: 1 });
    expect(result.shots.map(s => s.description)).toEqual(['Steady eyes on the camera, a slight settled smile.', 'Eyes closed, a small relaxed smile.', 'Head tilted, one eyebrow raised.']);
    // The look that was there stays, still done, with the new video's words kept.
    expect(result.shots[0]).toMatchObject({ id: kept.id, done: true });
    expect(result.shots[0].sources.map(s => `${s.piece}: ${s.text}`)).toEqual([`Video/Longform: ${CALM_A}`, `Other/Longform: ${CALM_B}`]);
    expect(readShotList()).toHaveLength(3);
  });

  it("doesn't ask the AI when no folder has a new look next to another, and adds exact repeats to their look", async () => {
    addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }]);
    const never = async () => { throw new Error('should not be asked'); };
    const result = await addShotsMerging('Other/Longform', [{ expression: ` ${CALM_A.toUpperCase()} `, context: 'Top 1' }, { expression: CURIOUS, context: 'Idea 1' }], never);
    expect(result).toMatchObject({ added: 1, merged: 1 });
    expect(result.shots[0].sources).toHaveLength(2);
  });

  it('still adds the looks when the AI fails, and says so', async () => {
    addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }]);
    const result = await addShotsMerging('Other/Longform', [{ expression: CALM_B, context: 'Top 1' }], async () => 'no idea');
    expect(result).toMatchObject({ added: 1, merged: 0 });
    expect(result.error).toMatch(/without checking for duplicates/);
    expect(readShotList()).toHaveLength(2);
  });

  it('Merge Duplicates keeps a copy of the list and moves the merged look\'s pictures to the one that stays', async () => {
    const shots = addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }, { expression: CALM_B, context: 'Idea 2' }, { expression: CALM_CLOSED, context: 'Idea 3' }]);
    picture(shots[0].id, 'reference-001.png');
    picture(shots[1].id, 'reference-001.png'); picture(shots[1].id, 'reference-002.jpg');
    const result = await mergeDuplicateShots(grouping(['steady eyes', 'reassuring']));
    expect(result.merged).toBe(1);
    expect(result.shots.map(s => s.id)).toEqual([shots[0].id, shots[2].id]);
    expect(result.copy).toMatch(/^Expression Shot List \(Before Merging \d{4}-\d\d-\d\d \d{4}\)\.json$/);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'Expressions', result.copy!), 'utf8')).shots).toHaveLength(3);
    expect(shotReferences()[shots[0].id].pictures).toEqual(['reference-003.jpg', 'reference-002.png', 'reference-001.png']);
    // The merged look's own folder is left as it was.
    expect(fs.readdirSync(path.join(root, 'Refs', shots[1].id))).toContain('reference-002.jpg');
  });

  it('Merge Duplicates changes nothing, and keeps no copy, when there are no duplicates', async () => {
    addExpressionShots('Video/Longform', [{ expression: CALM_A, context: 'Top 1' }, { expression: CALM_CLOSED, context: 'Idea 3' }]);
    const result = await mergeDuplicateShots(async () => '{"duplicates": []}');
    expect(result).toMatchObject({ merged: 0 });
    expect(fs.readdirSync(path.join(root, 'Expressions')).filter(n => n.includes('Before Merging'))).toEqual([]);
  });
});
