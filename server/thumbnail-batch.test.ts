// Make All 6 Drafts: fake folders, fake photo ranking AI, and fake image AI only, so no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import type { ExpressionPhoto } from './expressions';
import { batchThumbJob, startBatchThumbnails } from './thumbnail-batch';
import type { MakeImage } from './thumbnails';
import { makeTree, removeTree } from './testing';

let tmp: string;
const saved = { projects: '', expressions: '' };
const LONGFORM = '005 - Series/005A - One/Longform';
const drafts = () => path.join(tmp, 'Projects', LONGFORM, 'Packaging', 'Drafts');

const PICKS = [
  { title: 'Pair One Title', thumbnailText: 'PAIR ONE', accent: 'ONE', expression: 'Positive > Relief', background: 'warm room', why: 'because 1', backedBy: ['Claude'] },
  { title: 'Pair Two Title', thumbnailText: 'PAIR TWO', accent: 'TWO', expression: 'Empathy > Compassion', background: 'soft light', why: 'because 2', backedBy: ['Claude'] },
  { title: 'Pair Three Title', thumbnailText: 'PAIR THREE', accent: 'THREE', expression: 'Negative > Doubt', background: 'cool shadow', why: 'because 3', backedBy: ['Claude'] },
];

const PHOTOS: ExpressionPhoto[] = [
  { name: 'Relief_001.jpg', path: 'Positive/Relief/Relief_001.jpg', category: 'Positive/Relief', tags: [{ tag: 'Relief', confidence: 1, confirmed: true, disconfirmed: false }], rating: 'liked' },
  { name: 'Compassion_001.jpg', path: 'Empathy/Compassion/Compassion_001.jpg', category: 'Empathy/Compassion', tags: [{ tag: 'Compassion', confidence: 1, confirmed: true, disconfirmed: false }], rating: 'liked' },
];

beforeEach(() => {
  tmp = makeTree({
    [`Projects/${LONGFORM}/Packaging/V01/YouTube.md`]: '',
    [`Projects/${LONGFORM}/Packaging/Drafts/Picks.json`]: JSON.stringify({ picks: PICKS }),
    'Expressions/Positive/Relief/Relief_001.jpg': 'photo1',
    'Expressions/Empathy/Compassion/Compassion_001.jpg': 'photo2',
    'Expressions/Negative/Doubt/placeholder.txt': '',
  });
  saved.projects = config.videoProjectsDir;
  saved.expressions = config.expressionsDir;
  config.videoProjectsDir = path.join(tmp, 'Projects');
  config.expressionsDir = path.join(tmp, 'Expressions');
});

afterEach(() => {
  config.videoProjectsDir = saved.projects;
  config.expressionsDir = saved.expressions;
  removeTree(tmp);
});

describe('Make All 6 Drafts', () => {
  it('ranks photos for each pair and generates ChatGPT + Gemini thumbnails, skipping pairs with no matching photos', async () => {
    const smallFile = path.join(tmp, 'small.jpg');
    fs.writeFileSync(smallFile, 'small');
    const makeCalls: { ai: string; photo?: string }[] = [];
    const fakeMake: MakeImage = async (ai, _prompt, cwd, out, opts) => {
      makeCalls.push({ ai, photo: opts.photo });
      fs.writeFileSync(path.join(cwd, out), `img-${ai}`);
      return { image: path.join(cwd, out), session: `s-${ai}` };
    };
    let rankCalls = 0;
    const { job, finished } = startBatchThumbnails(LONGFORM, 'claude', {
      ranking: {
        photos: () => PHOTOS,
        starred: () => [],
        shots: () => [],
        small: async () => smallFile,
        ask: async (_ai, prompt) => {
          rankCalls++;
          if (prompt.includes('Pair One Title')) return JSON.stringify({ ranked: [{ photo: 'Positive/Relief/Relief_001.jpg', why: 'best 1' }] });
          return JSON.stringify({ ranked: [{ photo: 'Empathy/Compassion/Compassion_001.jpg', why: 'best 2' }] });
        },
      },
      make: fakeMake,
    });
    await finished;

    expect(job.state).toBe('done');
    expect(batchThumbJob(LONGFORM)?.state).toBe('done');
    expect(rankCalls).toBe(2); // Pair 3 had 0 eligible photos so no AI ranking call was made
    expect(job.pairs[0]).toMatchObject({ state: 'done', photo: 'Positive/Relief/Relief_001.jpg' });
    expect(job.pairs[1]).toMatchObject({ state: 'done', photo: 'Empathy/Compassion/Compassion_001.jpg' });
    expect(job.pairs[2].state).toBe('skipped');
    expect(job.pairs[2].reason).toMatch(/No eligible photos/);

    expect(makeCalls).toHaveLength(4);
    expect(makeCalls.filter(c => c.ai === 'codex')).toHaveLength(2);
    expect(makeCalls.filter(c => c.ai === 'gemini')).toHaveLength(2);
    expect(fs.existsSync(path.join(drafts(), 'ChatGPT 01', '01.png'))).toBe(true);
    expect(fs.existsSync(path.join(drafts(), 'Gemini 01', '01.png'))).toBe(true);
    expect(fs.existsSync(path.join(drafts(), 'ChatGPT 02', '01.png'))).toBe(true);
    expect(fs.existsSync(path.join(drafts(), 'Gemini 02', '01.png'))).toBe(true);
  });

  it('reuses a fresh saved ranking instead of asking the ranking AI again', async () => {
    const smallFile = path.join(tmp, 'small.jpg');
    fs.writeFileSync(smallFile, 'small');
    fs.writeFileSync(
      path.join(drafts(), 'Photo Ranking.json'),
      JSON.stringify({
        rankings: [
          {
            title: PICKS[0].title,
            thumbnailText: PICKS[0].thumbnailText,
            ranked: [{ photo: 'Positive/Relief/Relief_001.jpg', why: 'saved' }],
            looked: 1,
            at: new Date().toISOString(),
            offered: ['Positive/Relief/Relief_001.jpg'],
          },
        ],
      }),
    );
    let rankCalls = 0;
    const fakeMake: MakeImage = async (ai, _prompt, cwd, out) => {
      fs.writeFileSync(path.join(cwd, out), `img-${ai}`);
      return { image: path.join(cwd, out), session: `s-${ai}` };
    };
    const { finished } = startBatchThumbnails(LONGFORM, 'claude', {
      ranking: {
        photos: () => PHOTOS,
        starred: () => [],
        shots: () => [],
        small: async () => smallFile,
        ask: async () => {
          rankCalls++;
          return JSON.stringify({ ranked: [{ photo: 'Empathy/Compassion/Compassion_001.jpg', why: 'best 2' }] });
        },
      },
      make: fakeMake,
    });
    await finished;
    expect(rankCalls).toBe(1); // Pair 1 reused its saved ranking; only Pair 2 asked the AI
  });

  it('requires Picks.json first', () => {
    fs.unlinkSync(path.join(drafts(), 'Picks.json'));
    expect(() => startBatchThumbnails(LONGFORM, 'claude')).toThrow(/pick the top 3 pairs/i);
  });
});
