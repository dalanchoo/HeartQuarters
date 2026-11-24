// Best Photos for This Pair: fake folders, fake photos and a fake Claude, so no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { MAX_CANDIDATES, RANKING_FILE, pickCategories, rankingCandidates, rankingFromAnswer, readRanking, startRanking } from './photo-ranking';
import { setExpressionRating } from './expression-rating';
import { clearExpressionIndex, type ExpressionPhoto } from './expressions';
import type { AskAi } from './brief';

const PIECE = '022 - V/Shorts/022_S07 - Somebody Knows Me';
const PICK = { title: "They Know Me. I Don't Know Who They Are.", thumbnailText: 'Remember me?', accent: 'ME?', expression: 'Positive > Warmth, Empathy > Compassion (warm, sheepish smile)', background: 'dark room', why: 'because', backedBy: ['Claude'] };
const photo = (p: string): ExpressionPhoto => ({ path: p, name: p.split('/').pop()!, category: p.split('/').slice(0, -1).join('/'), tags: [] });
const PHOTOS = [photo('Positive/Warmth/Warm_001.jpg'), photo('Positive/Warmth/Warm_002.jpg'), photo('Empathy/Compassion/Compassion_002.jpg'), photo('Doubt/Unsure/Unsure_001.jpg'), photo('Composure/Calm/Calm_004.jpg')];
const AI_PHOTO = photo('Positive/Warmth/Warm_AI_001.jpg');

let tmp: string;
let old: { projects: string; expressions: string };
beforeEach(() => {
  tmp = makeTree({
    [`Videos/${PIECE}/Packaging/Drafts/Brief.md`]: '# Brief',
    ...Object.fromEntries([...PHOTOS, AI_PHOTO].map(({ path }) => [`Expressions/${path}`, 'fake photo'])),
  });
  old = { projects: config.videoProjectsDir, expressions: config.expressionsDir };
  config.videoProjectsDir = path.join(tmp, 'Videos');
  config.expressionsDir = path.join(tmp, 'Expressions');
});
afterEach(() => {
  config.videoProjectsDir = old.projects;
  config.expressionsDir = old.expressions;
  clearExpressionIndex();
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
  it('excludes a disliked star and gives likes priority before applying the cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => photo(`Positive/Warmth/W_${i}.jpg`));
    many[0].rating = 'disliked';
    many[1].rating = 'meh';
    many[59].rating = 'liked';
    const list = rankingCandidates(many, ['Positive/Warmth'], [many[0].path]);
    expect(list).toHaveLength(MAX_CANDIDATES);
    expect(list.slice(0, 3).map(c => c.photo)).toEqual([many[59], many[1], many[2]]);
    expect(list.map(c => c.photo)).not.toContain(many[0]);
  });
  it('keeps camera photos ahead of AI fallbacks and leaves room for both in one request', () => {
    const cameras = Array.from({ length: MAX_CANDIDATES }, (_, i) => photo(`Positive/Warmth/W_${i}.jpg`));
    const tagged = { ...PHOTOS[0], tags: [{ tag: 'AIGenerated', confirmed: true, confidence: null }] };
    const list = rankingCandidates([AI_PHOTO, tagged, ...cameras], ['Positive/Warmth'], [AI_PHOTO.path]);
    expect(list).toHaveLength(MAX_CANDIDATES);
    expect(list.slice(0, -2).every(c => !c.aiGenerated)).toBe(true);
    expect(list.slice(-2).map(c => [c.photo.path, c.aiGenerated])).toEqual([[AI_PHOTO.path, true], [tagged.path, true]]);
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
  it('shows Claude one set of labeled previews and saves only suitable camera photos from a mixed answer', async () => {
    choose();
    setExpressionRating(PHOTOS[0].path, 'liked');
    setExpressionRating(PHOTOS[1].path, 'disliked');
    setExpressionRating(PHOTOS[2].path, 'meh');
    let seen = '';
    let files: string[] = [];
    const ask: AskAi = async (_ai, prompt, cwd) => {
      seen = prompt;
      files = fs.readdirSync(cwd).sort();
      return JSON.stringify({ ranked: [
        { photo: AI_PHOTO.path, why: 'AI warmth' },
        { photo: PHOTOS[2].path, why: 'kind and a bit sheepish' },
        { photo: PHOTOS[0].path, why: 'warm' },
      ] });
    };
    const { job, finished } = startRanking(PIECE, { ask, starred: () => [PHOTOS[0].path, PHOTOS[1].path], small });
    expect(job).toMatchObject({ state: 'working', looked: 3 });
    await finished;
    expect(job.state).toBe('done');
    expect(files).toEqual(['01.jpg', '02.jpg', '03.jpg']);
    expect(seen).toContain('- 01.jpg: Positive/Warmth/Warm_001.jpg (Positive > Warmth, camera photo, starred, liked)');
    expect(seen).toContain('- 02.jpg: Empathy/Compassion/Compassion_002.jpg (Empathy > Compassion, camera photo, meh)');
    expect(seen).toContain('- 03.jpg: Positive/Warmth/Warm_AI_001.jpg (Positive > Warmth, AI-generated)');
    expect(seen).not.toContain(PHOTOS[1].path);
    expect(seen).toContain("Title: \"They Know Me. I Don't Know Who They Are.\"");
    const saved = readRanking(PIECE)!;
    expect(saved).toMatchObject({ title: PICK.title, looked: 3, cameraFirst: true });
    expect(saved.ranked).toEqual([
      { photo: 'Empathy/Compassion/Compassion_002.jpg', why: 'kind and a bit sheepish' },
      { photo: 'Positive/Warmth/Warm_001.jpg', why: 'warm' },
    ]);
  });
  it.each([
    { result: 'an AI fallback', ranked: [{ photo: AI_PHOTO.path, why: 'suitable fallback' }] },
    { result: 'an empty ranking', ranked: [] },
  ])('saves $result when no camera photo is suitable', async ({ ranked }) => {
    choose();
    let calls = 0;
    const ask: AskAi = async () => { calls++; return JSON.stringify({ ranked }); };
    const { job, finished } = startRanking(PIECE, { ask, starred: () => [], small });
    await finished;
    expect(job.state).toBe('done');
    expect(calls).toBe(1);
    expect(readRanking(PIECE)).toMatchObject({ cameraFirst: true, ranked });
  });
  it('updates saved recommendations when ratings change without rewriting the saved ranking', () => {
    const file = path.join(tmp, 'Videos', PIECE, 'Packaging', 'Drafts', RANKING_FILE);
    const ranked = PHOTOS.slice(0, 2).map(photo => ({ photo: photo.path, why: 'warm' }));
    const saved = JSON.stringify({ title: PICK.title, thumbnailText: PICK.thumbnailText, looked: 2, ranked });
    fs.writeFileSync(file, saved);
    expect(readRanking(PIECE)?.ranked).toEqual(ranked);
    setExpressionRating(PHOTOS[0].path, 'disliked');
    expect(readRanking(PIECE)?.ranked).toEqual([ranked[1]]);
    setExpressionRating(PHOTOS[1].path, 'disliked');
    expect(readRanking(PIECE)?.ranked).toEqual([]);
    setExpressionRating(PHOTOS[0].path, 'meh');
    expect(readRanking(PIECE)?.ranked).toEqual([ranked[0]]);
    expect(fs.readFileSync(file, 'utf8')).toBe(saved);
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
