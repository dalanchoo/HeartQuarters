// Best Photos for This Pair: fake folders, fake photos and a fake Claude, so no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { MAX_CANDIDATES, pickCategories, rankingCandidates, rankingFromAnswer, readRanking, startRanking } from './photo-ranking';
import type { ExpressionPhoto } from './expressions';
import type { AskAi } from './brief';

const PIECE = '022 - V/Shorts/022_S07 - Somebody Knows Me';
const PICK = { title: "They Know Me. I Don't Know Who They Are.", thumbnailText: 'Remember me?', accent: 'ME?', expression: 'Positive > Warmth, Empathy > Compassion (warm, sheepish smile)', background: 'dark room', why: 'because', backedBy: ['Claude'] };
const photo = (p: string): ExpressionPhoto => ({ path: p, name: p.split('/').pop()!, category: p.split('/').slice(0, -1).join('/'), tags: [] });
const PHOTOS = [photo('Positive/Warmth/Warm_001.jpg'), photo('Positive/Warmth/Warm_002.jpg'), photo('Empathy/Compassion/Compassion_002.jpg'), photo('Doubt/Unsure/Unsure_001.jpg'), photo('Composure/Calm/Calm_004.jpg')];

let tmp: string;
let old: { projects: string; expressions: string };
beforeEach(() => {
  tmp = makeTree({ [`Videos/${PIECE}/Packaging/Drafts/Brief.md`]: '# Brief', 'Expressions/x.jpg': 'x' });
  old = { projects: config.videoProjectsDir, expressions: config.expressionsDir };
  config.videoProjectsDir = path.join(tmp, 'Videos');
  config.expressionsDir = path.join(tmp, 'Expressions');
});
afterEach(() => {
  config.videoProjectsDir = old.projects;
  config.expressionsDir = old.expressions;
  removeTree(tmp);
});
const choose = () => fs.writeFileSync(path.join(tmp, 'Videos', PIECE, 'Packaging', 'Drafts', 'Choice.json'), JSON.stringify({ pick: PICK, index: 0, photo: null }));
/** Makes a small copy: here just a text file standing in for the image. */
const small = async (full: string) => {
  const out = path.join(tmp, `small-${path.basename(full)}`);
  fs.writeFileSync(out, full);
  return out;
};

describe('which photos Claude looks at', () => {
  it("reads the pair's categories", () => {
    expect(pickCategories(PICK.expression)).toEqual(['Positive/Warmth', 'Empathy/Compassion']);
  });
  it('puts starred photos in the categories first, then the categories, then other starred photos', () => {
    const list = rankingCandidates(PHOTOS, ['Positive/Warmth', 'Empathy/Compassion'], ['Positive/Warmth/Warm_002.jpg', 'Composure/Calm/Calm_004.jpg']);
    expect(list.map((c) => [c.photo.path, c.starred])).toEqual([
      ['Positive/Warmth/Warm_002.jpg', true],
      ['Positive/Warmth/Warm_001.jpg', false],
      ['Empathy/Compassion/Compassion_002.jpg', false],
      ['Composure/Calm/Calm_004.jpg', true],
    ]);
  });
  it(`looks at no more than ${MAX_CANDIDATES}`, () => {
    const many = Array.from({ length: 60 }, (_, i) => photo(`Positive/Warmth/W_${i}.jpg`));
    expect(rankingCandidates(many, ['Positive/Warmth'], [])).toHaveLength(MAX_CANDIDATES);
  });
});

describe("reading Claude's ranking", () => {
  it('keeps only photos it was shown, in its order, at most five, without repeats', () => {
    const offered = ['a/1.jpg', 'a/2.jpg', 'a/3.jpg', 'a/4.jpg', 'a/5.jpg', 'a/6.jpg'];
    const answer = 'Here: {"ranked":[{"photo":"a/2.jpg","why":"warm"},{"photo":"made/up.jpg","why":"x"},{"photo":"a/2.jpg","why":"again"},{"photo":"a/1.jpg","why":"b"},{"photo":"a/3.jpg"},{"photo":"a/4.jpg"},{"photo":"a/5.jpg"},{"photo":"a/6.jpg"}]}';
    expect(rankingFromAnswer(answer, offered).map((r) => r.photo)).toEqual(['a/2.jpg', 'a/1.jpg', 'a/3.jpg', 'a/4.jpg', 'a/5.jpg']);
    expect(rankingFromAnswer(answer, offered)[0].why).toBe('warm');
    expect(() => rankingFromAnswer('no json', offered)).toThrow(/expected form/);
    expect(() => rankingFromAnswer('{"ranked":[{"photo":"x.jpg"}]}', offered)).toThrow(/none of the photos/);
  });
});

describe('ranking the photos for the chosen pair', () => {
  it('shows Claude small copies with their names, and saves the top five for that pair', async () => {
    choose();
    let seen = '';
    let files: string[] = [];
    const ask: AskAi = async (_ai, prompt, cwd) => {
      seen = prompt;
      files = fs.readdirSync(cwd).sort();
      return '{"ranked":[{"photo":"Empathy/Compassion/Compassion_002.jpg","why":"kind and a bit sheepish"},{"photo":"Positive/Warmth/Warm_001.jpg","why":"warm"}]}';
    };
    const { job, finished } = startRanking(PIECE, { ask, photos: () => PHOTOS, starred: () => ['Positive/Warmth/Warm_001.jpg'], small });
    expect(job).toMatchObject({ state: 'working', looked: 3 });
    await finished;
    expect(job.state).toBe('done');
    expect(files).toEqual(['01.jpg', '02.jpg', '03.jpg']);
    expect(seen).toContain('- 01.jpg: Positive/Warmth/Warm_001.jpg (Positive > Warmth, starred)');
    expect(seen).toContain("Title: \"They Know Me. I Don't Know Who They Are.\"");
    const saved = readRanking(PIECE)!;
    expect(saved).toMatchObject({ title: PICK.title, looked: 3 });
    expect(saved.ranked).toEqual([
      { photo: 'Empathy/Compassion/Compassion_002.jpg', why: 'kind and a bit sheepish' },
      { photo: 'Positive/Warmth/Warm_001.jpg', why: 'warm' },
    ]);
  });
  it('needs a chosen pair, and records a failure', async () => {
    expect(() => startRanking(PIECE, { photos: () => PHOTOS, starred: () => [], small })).toThrow(/Choose one of the top 3/);
    choose();
    const { job, finished } = startRanking(PIECE, { ask: async () => 'nothing useful', photos: () => PHOTOS, starred: () => [], small });
    await finished;
    expect(job).toMatchObject({ state: 'failed', error: expect.stringMatching(/expected form/) });
    expect(readRanking(PIECE)).toBeNull();
    expect(() => startRanking('../outside', { photos: () => PHOTOS, starred: () => [], small })).toThrow();
  });
});
