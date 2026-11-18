import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collectChannelAnalytics, saveChannelAnalytics } from './channel-analytics.js';
import { config } from './config.js';
import { resetQuotaForTests, youtubeQuota } from './youtube-quota.js';
import { makeTree, removeTree } from './testing.js';

let root: string; let previous: string;
beforeEach(() => { root = makeTree({}); previous = config.videoProjectsDir; config.videoProjectsDir = root; resetQuotaForTests(); });
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });
const channel = { id: 'channel-id', title: 'Heart Mind Fusion' };
const now = new Date('2026-11-18T20:00:00Z');

describe('channel analytics', () => {
  it('gets six channel reports and stores distinct snapshots without overwriting', async () => {
    const queries: URL[] = [];
    const snapshot = await collectChannelAnalytics(channel, 'token', now, async url => { queries.push(new URL(url)); return Response.json({ columnHeaders: [{ name: 'views' }], rows: [[12]] }); });
    expect(snapshot.reports).toHaveLength(6);
    expect(queries[4].searchParams.get('dimensions')).toBe('day');
    expect(queries[5].searchParams.get('dimensions')).toBe('video');
    expect(queries[5].searchParams.get('maxResults')).toBe('200');
    expect(youtubeQuota()).toMatchObject({ analyticsUsed: 6, used: 0 });
    const first = saveChannelAnalytics(snapshot); const second = saveChannelAnalytics(snapshot);
    expect(first).not.toBe(second);
    expect(JSON.parse(fs.readFileSync(path.join(root, first), 'utf8'))).toEqual(snapshot);
  });
  it('reports a failed request without saving incomplete results', async () => {
    await expect(collectChannelAnalytics(channel, 'token', now, async () => new Response('', { status: 403 }))).rejects.toThrow('Lifetime (403)');
    expect(youtubeQuota().analyticsUsed).toBe(1);
    expect(fs.existsSync(path.join(root, 'Analytics'))).toBe(false);
  });
  it('refuses a linked analytics folder pointing outside the projects root', () => {
    const outside = makeTree({});
    try {
      fs.symlinkSync(outside, path.join(root, 'Analytics'), 'junction');
      expect(() => saveChannelAnalytics({ channel, downloadedAt: now.toISOString(), reports: [], notes: [] })).toThrow();
    } finally { removeTree(outside); }
  });
});
