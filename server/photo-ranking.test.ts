// Best Photos for This Pair: fake folders, fake photos and a fake Claude, so no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { MAX_CANDIDATES, RANKING_FILE, pairShot, photosMadeFor, pickCategories, readMadeFor, rankingCandidates, rankingFromAnswer, readRanking, startRanking } from './photo-ranking';
import { setExpressionRating } from './expression-rating';
import { clearExpressionIndex, type ExpressionPhoto } from './expressions';
import { readShotList } from './expression-shot-list';
import type { AskAi } from './brief';
import type { BriefPick } from './projects';

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
const choose = (pick: BriefPick = PICK) => fs.writeFileSync(path.join(tmp, 'Videos', PIECE, 'Packaging', 'Drafts', 'Choice.json'), JSON.stringify({ pick, index: 0, photo: null }));
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
  it('uses the categories, with stars only breaking ties, and leaves out starred photos of other expressions', () => {
    const list = rankingCandidates(PHOTOS, ['Positive/Warmth', 'Empathy/Compassion'], ['Positive/Warmth/Warm_002.jpg', 'Composure/Calm/Calm_004.jpg']);
    expect(list.map((c) => [c.photo.path, c.starred])).toEqual([
      ['Positive/Warmth/Warm_002.jpg', true],
      ['Positive/Warmth/Warm_001.jpg', false],
      ['Empathy/Compassion/Compassion_002.jpg', false],
    ]);
  });
  it('leaves out photos John marked as not having a requested cue, or with a confirmed opposite gaze, but keeps untagged ones', () => {
    const [untagged, notCamera, lookingLeft, guessedLeft, closedMouth] = Array.from({ length: 5 }, (_, i) => photo(`Positive/Warmth/P_${i}.jpg`));
    notCamera.tags = [{ tag: 'LookAtCamera', confirmed: false, disconfirmed: true, confidence: null }];
    lookingLeft.tags = [{ tag: 'LookLeft', confirmed: true, confidence: null }];
    guessedLeft.tags = [{ tag: 'LookLeft', confirmed: false, confidence: 90 }];
    closedMouth.tags = [{ tag: 'MouthOpen', confirmed: false, disconfirmed: true, confidence: null }];
    const photos = [untagged, notCamera, lookingLeft, guessedLeft, closedMouth];
    expect(rankingCandidates(photos, ['Positive/Warmth'], [], ['LookAtCamera']).map(c => c.photo)).toEqual([untagged, guessedLeft, closedMouth]);
    expect(rankingCandidates(photos, ['Positive/Warmth'], [], ['LookRight', 'MouthOpen']).map(c => c.photo)).toEqual([untagged, notCamera, guessedLeft]);
    expect(rankingCandidates(photos, ['Positive/Warmth'], []).map(c => c.photo)).toEqual(photos);
  });
  it('puts pictures generated for this pair first, from any folder, and not as AI fallbacks', () => {
    const made = { ...photo('Doubt/Unsure/Made_AI_001.jpg'), tags: [{ tag: 'AIGenerated', confirmed: true, confidence: null }] };
    const list = rankingCandidates([...PHOTOS, made], ['Positive/Warmth'], [], [], new Set([made.path]));
    expect(list[0]).toMatchObject({ photo: made, madeForThisPair: true, aiGenerated: false });
  });
  it("finds library photos made from a look with this pair's expression", () => {
    const shot = (id: string, piece: string, text: string) => ({ id, category: 'Positive/Warmth', title: '', description: '', framing: [], pose: [], morphology: [], alsoFits: [], sources: [{ piece, context: 'Top 1', text }], addedAt: '', done: false });
    const [mine, otherPair, otherVideo] = ['mine', 'otherPair', 'otherVideo'].map(id => ({ ...photo(`Positive/Warmth/${id}.jpg`), generation: { shot: id } }));
    const looks = [shot('mine', PIECE, PICK.expression), shot('otherPair', PIECE, 'Composure > Calm (steady)'), shot('otherVideo', 'Another video', PICK.expression)];
    // Only this pair's expression from this video, ignoring case and spacing.
    expect([...photosMadeFor(PIECE, `  ${PICK.expression.toUpperCase()} `, [mine, otherPair, otherVideo, PHOTOS[0]], looks)]).toEqual([mine.path]);
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
  it('gives a confirmed expression match from another folder room in a full shortlist', () => {
    const inFolder = Array.from({ length: MAX_CANDIDATES }, (_, i) => ({ ...photo(`Positive/Warmth/W_${i}.jpg`), rating: 'liked' as const }));
    const confirmed = { ...PHOTOS[3], tags: [{ tag: 'WARMTH', confirmed: true, confidence: null }] };
    const list = rankingCandidates([...inFolder, confirmed], ['Positive/Warmth'], []);
    expect(list).toHaveLength(MAX_CANDIDATES);
    expect(list[0].photo).toBe(confirmed);
  });
  it('prefers confirmed cues over guesses, keeps untagged photos and leaves out a cue John ruled out', () => {
    const [unknown, rejected, guessed, confirmed] = PHOTOS.slice(0, 4).map((_, i) => photo(`Positive/Warmth/Photo_${i}.jpg`));
    rejected.tags = [{ tag: 'LookRight', confirmed: false, disconfirmed: true, confidence: 99 }];
    guessed.tags = ['LookRight', 'MouthOpen'].map(tag => ({ tag, confirmed: false, confidence: 98 }));
    confirmed.tags = [{ tag: 'OpenMouthLaugh', confirmed: true, confidence: null }];
    const photos = [unknown, rejected, guessed, confirmed];
    expect(rankingCandidates(photos, ['Positive/Warmth'], []).map(c => c.photo)).toEqual(photos);
    expect(rankingCandidates(photos, ['Positive/Warmth'], [], ['LookRight', 'MouthOpen']).map(c => c.photo))
      .toEqual([confirmed, guessed, unknown]);
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
  it('ranks photos from sidecar tags even when the requested folder is empty', async () => {
    choose({ ...PICK, expression: 'Cognitive > Curiosity (a questioning look)' });
    fs.mkdirSync(path.join(tmp, 'Expressions', 'Cognitive', 'Curiosity'), { recursive: true });
    const [confirmed, suggested, disconfirmed, disliked, starred] = PHOTOS;
    for (const [p, tag] of [
      [confirmed, 'Curiosity, N/A, CONFIRMED'],
      [suggested, 'Curiosity, 82%, UNCONFIRMED'],
      [disconfirmed, 'Curiosity, 99%, DISCONFIRMED'],
      [disliked, 'Curiosity, N/A, CONFIRMED\n# Rating: Disliked'],
    ] as const) {
      fs.writeFileSync(path.join(tmp, 'Expressions', p.path.replace(/\.jpg$/, '.txt')), tag);
    }
    let seen = '';
    const ranked = [{ photo: confirmed.path, why: 'thoughtful' }];
    const ask: AskAi = async (_ai, prompt) => { seen = prompt; return JSON.stringify({ ranked }); };
    const { job, finished } = startRanking(PIECE, { ask, starred: () => [starred.path], small });
    await finished;
    expect(job).toMatchObject({ state: 'done', looked: 2 });
    expect(seen).toContain(`- 01.jpg: ${confirmed.path}`);
    expect(seen).toContain(`- 02.jpg: ${suggested.path}`);
    expect(seen).not.toContain(starred.path);
    expect(seen).not.toContain(disconfirmed.path);
    expect(seen).not.toContain(disliked.path);
    expect(readRanking(PIECE)?.ranked).toEqual(ranked);
  });
  it('ranks with the AI John chose, attaching the previews, and says who ranked them', async () => {
    choose();
    let asked = '';
    let images: string[] = [];
    const ask: AskAi = async (ai, _prompt, _cwd, imgs = []) => {
      asked = ai;
      images = imgs.map((i) => path.basename(i));
      return JSON.stringify({ ranked: [{ photo: PHOTOS[0].path, why: 'warm' }] });
    };
    const { job, finished } = startRanking(PIECE, { ask, starred: () => [PHOTOS[0].path], small }, 'codex');
    expect(job.ai).toBe('codex');
    await finished;
    expect(job.state).toBe('done');
    expect(asked).toBe('codex');
    expect(images[0]).toBe('01.jpg');
    expect(readRanking(PIECE)).toMatchObject({ by: 'ChatGPT' });
  });
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
    expect(seen).toContain('Avoid a strongly negative look when a more inviting expression also fits.');
    expect(seen).toContain("Title: \"They Know Me. I Don't Know Who They Are.\"");
    const saved = readRanking(PIECE)!;
    expect(saved).toMatchObject({ title: PICK.title, looked: 3, cameraFirst: true });
    expect(saved.ranked).toEqual([
      { photo: 'Empathy/Compassion/Compassion_002.jpg', why: 'kind and a bit sheepish' },
      { photo: 'Positive/Warmth/Warm_001.jpg', why: 'warm' },
    ]);
  });
  it('uses the chosen pair’s photo cues from disk for the previews and the single ranking request', async () => {
    choose({ ...PICK, photoAttributes: ['LookAtCamera'] });
    const match = PHOTOS[2];
    fs.writeFileSync(path.join(tmp, 'Expressions', match.path.replace(/\.jpg$/, '.txt')), 'LookAtCamera, N/A, CONFIRMED');
    const prompts: string[] = [];
    const ask: AskAi = async (_ai, prompt) => {
      prompts.push(prompt);
      return JSON.stringify({ ranked: [{ photo: match.path, why: 'direct gaze' }] });
    };
    const { job, finished } = startRanking(PIECE, { ask, starred: () => [], small });
    await finished;
    expect(job.state).toBe('done');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Photo cues: LookAtCamera');
    expect(prompts[0]).toContain(`- 01.jpg: ${match.path}`);
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

describe('generating a photo for the chosen pair', () => {
  it("finds the pair's look on the Shot List, or adds it once for an older brief", () => {
    expect(() => pairShot(PIECE)).toThrow(/Choose one of the top 3/);
    choose();
    const { id } = pairShot(PIECE);
    expect(pairShot(PIECE).id).toBe(id);
    const shots = readShotList();
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ id, category: 'Positive/Warmth', sources: [{ piece: PIECE, text: PICK.expression }] });
  });
  it("gives the pair's look its photo cues, and adds a specific look beside one without them", () => {
    choose();
    const plain = pairShot(PIECE);
    choose({ ...PICK, photoAttributes: ['LookRight'] });
    const cued = pairShot(PIECE);
    expect(cued.id).not.toBe(plain.id);
    expect(readShotList().find(s => s.id === cued.id)).toMatchObject({ pose: ['LookRight'], sources: [{ cues: ['LookRight'] }] });
    expect(pairShot(PIECE).id).toBe(cued.id);
  });
  it('ranks a confirmed picture generated from that look first, as a normal candidate', async () => {
    choose();
    const { id } = pairShot(PIECE);
    // A picture confirmed into another folder, with the record line its tag file got when it was made.
    const made = 'Doubt/Unsure/Made_AI_001.jpg';
    fs.writeFileSync(path.join(tmp, 'Expressions', made), 'fake photo');
    fs.writeFileSync(path.join(tmp, 'Expressions', made.replace(/\.jpg$/, '.txt')), `AIGenerated, N/A, CONFIRMED\n# Generated shot: ${id}\n`);
    clearExpressionIndex();
    expect(readMadeFor(PIECE)).toEqual([made]);
    let seen = '';
    const ask: AskAi = async (_ai, prompt) => { seen = prompt; return JSON.stringify({ ranked: [{ photo: made, why: 'made for it' }, { photo: PHOTOS[0].path, why: 'warm' }] }); };
    const { finished } = startRanking(PIECE, { ask, starred: () => [], small });
    await finished;
    expect(seen).toContain(`- 01.jpg: ${made} (Doubt > Unsure, made for this pair`);
    expect(readRanking(PIECE)?.ranked.map(r => r.photo)).toEqual([made, PHOTOS[0].path]);
  });
});
