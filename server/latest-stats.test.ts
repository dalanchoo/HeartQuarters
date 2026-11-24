import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { latestStats } from './latest-stats';
import { makeTree, removeTree } from './testing';

const header = (name: string) => ({ name });
const stats = (views: number, downloadedAt: string) => JSON.stringify({
  videoId: 'abc', downloadedAt,
  periods: [
    { period: { name: 'First Week', start: 'a', end: 'b', complete: true }, statistics: { columns: [header('views'), header('averageViewPercentage')], rows: [[1, 50]] } },
    { period: { name: 'Lifetime to Date', start: 'a', end: 'c', complete: false }, statistics: { columns: [header('views'), header('averageViewPercentage')], rows: [[views, 80]] } },
  ],
  reach: { status: 'ready', days: [{ start: 'd1', end: 'd2', rows: [{ video_id: 'abc', video_thumbnail_impressions: '200', video_thumbnail_impressions_ctr: '0.05' }] }] },
});

let tmp: string; let original: string;
beforeEach(() => {
  tmp = makeTree({
    'P/Shorts/S/Analytics/2026-11-20/Stats.json': stats(10, '2026-11-20T10:00:00Z'),
    'P/Shorts/S/Analytics/2026-11-21/Stats.json': stats(40, '2026-11-21T10:00:00Z'),
    'P/Shorts/S/Analytics/2026-11-21 (2)/Stats.json': stats(58, '2026-11-21T12:00:00Z'),
    'P/Shorts/Broken/Analytics/2026-11-21/Stats.json': '{ not json',
    'P/Shorts/None/Script.md': '',
  });
  original = config.videoProjectsDir; config.videoProjectsDir = tmp;
});
afterEach(() => { config.videoProjectsDir = original; removeTree(tmp); });

describe('latest stats for the video list', () => {
  it('uses the newest download and its lifetime numbers', () => {
    expect(latestStats('P/Shorts/S')).toEqual({
      snapshot: '2026-11-21 (2)', downloadedAt: '2026-11-21T12:00:00Z', views: 58, averageViewPercent: 80,
      impressions: 200, ctrPercent: 5, reachFrom: 'd1', reachTo: 'd2',
    });
  });
  it('reads a changed file again', () => {
    expect(latestStats('P/Shorts/S')?.views).toBe(58);
    const file = path.join(tmp, 'P/Shorts/S/Analytics/2026-11-21 (2)/Stats.json');
    fs.writeFileSync(file, stats(612, '2026-11-21T12:00:00Z'));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(latestStats('P/Shorts/S')?.views).toBe(612);
  });
  it('shows nothing for a video without stats or with a damaged file', () => {
    expect(latestStats('P/Shorts/None')).toBeUndefined();
    expect(latestStats('P/Shorts/Broken')).toBeUndefined();
    expect(latestStats('../outside')).toBeUndefined();
  });
});
