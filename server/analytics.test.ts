import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { analyticsPeriods, collectVideoAnalytics, pacificDate, saveVideoAnalytics } from './analytics.js';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import { resetQuotaForTests, youtubeQuota } from './youtube-quota.js';

let root: string; let old: string;
beforeEach(() => { resetQuotaForTests(); root = makeTree({ '023 – John\'s Video/Longform/': '' }); old = config.videoProjectsDir; config.videoProjectsDir = root; });
afterEach(() => { config.videoProjectsDir = old; removeTree(root); });

describe('video analytics', () => {
  it('uses Pacific publication days and marks unfinished age windows', () => {
    expect(pacificDate(new Date('2026-01-02T02:00:00Z'))).toBe('2026-01-01');
    const periods = analyticsPeriods('2026-01-02T02:00:00Z', new Date('2026-01-05T20:00:00Z'));
    expect(periods[0]).toEqual({ name: 'First 2 Days', start: '2026-01-01', end: '2026-01-02', complete: true });
    expect(periods[1]).toEqual({ name: 'First Week', start: '2026-01-01', end: '2026-01-05', complete: false });
  });
  it('records unavailable retention and saves separate copies on the same day', async () => {
    const fetcher = async (url: string) => new URL(url).searchParams.has('dimensions')
      ? new Response('{}', { status: 400 })
      : Response.json({ columnHeaders: [{ name: 'views' }], rows: [[12]] });
    const snapshot = await collectVideoAnalytics('abcdefghijk', '2026-01-02T02:00:00Z', 'test', new Date('2026-02-05T20:00:00Z'), fetcher);
    expect(snapshot.periods[0].statistics.rows).toEqual([[12]]);
    expect(snapshot.periods[0].retention).toBeNull();
    expect(snapshot.periods[0].retentionError).toContain('400');
    expect(youtubeQuota()).toMatchObject({ used: 0, analyticsUsed: 8 });
    const one = saveVideoAnalytics("023 – John's Video/Longform", snapshot);
    const two = saveVideoAnalytics("023 – John's Video/Longform", snapshot);
    expect(one).not.toBe(two);
    expect(JSON.parse(fs.readFileSync(path.join(root, one), 'utf8'))).toEqual(snapshot);
  });
  it('counts a failed Analytics request without changing the Data API quota', async () => {
    await expect(collectVideoAnalytics('abcdefghijk', '2026-01-01T12:00:00Z', 'test', new Date('2026-02-05T20:00:00Z'), async () => new Response('', { status: 403 }))).rejects.toThrow('403');
    expect(youtubeQuota()).toMatchObject({ used: 0, analyticsUsed: 1 });
  });
  it('rejects paths outside the project root and bad video IDs', async () => {
    await expect(collectVideoAnalytics('../escape', '2026-01-02T02:00:00Z', 'test')).rejects.toThrow('Invalid YouTube video ID');
    expect(() => saveVideoAnalytics('../outside', {} as never)).toThrow();
  });
});
