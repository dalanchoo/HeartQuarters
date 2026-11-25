import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import {
  OUTSIDE_DIR, SETTINGS_FILE, VIDEOS_FILE, checkSettings, listScans, outsideOverview, readScanSettings,
  runYoutubeScan, saveScanSettings, scanEstimate, scanFolderName,
} from './outside-youtube';
import { makeTree, removeTree } from './testing';

let root: string;
let saved: string;

beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '' });
  saved = config.videoProjectsDir;
  config.videoProjectsDir = path.join(root, 'Projects');
});

afterEach(() => {
  config.videoProjectsDir = saved;
  removeTree(root);
});

const video = (id: string, duration: string, channelId = 'UCother', views = '100') => ({
  id,
  snippet: { title: `Title ${id}`, description: 'About memory', channelId, channelTitle: `Channel ${channelId}`, publishedAt: '2026-10-01T00:00:00Z', defaultAudioLanguage: 'en' },
  contentDetails: { duration },
  statistics: { viewCount: views, likeCount: '5', commentCount: '2' },
});

function fakeYoutube(searchIds: Record<string, string[]>, videos: ReturnType<typeof video>[]) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/search')) {
      const ids = searchIds[`${u.searchParams.get('q')}|${u.searchParams.get('order')}`] ?? [];
      return new Response(JSON.stringify({ items: ids.map((videoId) => ({ id: { videoId } })) }));
    }
    if (u.pathname.endsWith('/videos')) {
      const wanted = (u.searchParams.get('id') ?? '').split(',');
      return new Response(JSON.stringify({ items: videos.filter((v) => wanted.includes(v.id)) }));
    }
    return new Response('nope', { status: 404 });
  });
}

describe('outside demand: YouTube scan settings', () => {
  it('starts from the topic name and saves tidy settings to Drive', () => {
    expect(readScanSettings('sdam')).toEqual({ version: 1, searchWords: ['SDAM'], format: 'both', reach: 'english', vidiq: false });
    const settings = saveScanSettings('sdam', { searchWords: [' SDAM ', 'sdam', '', 'no  episodic memory'], format: 'longform', reach: 'worldwide', vidiq: true });
    expect(settings).toEqual({ version: 1, searchWords: ['SDAM', 'no episodic memory'], format: 'longform', reach: 'worldwide', vidiq: true });
    expect(fs.existsSync(path.join(config.videoProjectsDir, OUTSIDE_DIR, 'sdam', SETTINGS_FILE))).toBe(true);
    expect(readScanSettings('sdam')).toEqual(settings);
  });

  it('rejects bad settings and unknown topics', () => {
    expect(() => checkSettings({ searchWords: [], format: 'both', reach: 'english' })).toThrow('at least one');
    expect(() => checkSettings({ searchWords: ['a'], format: 'tiktok', reach: 'english' })).toThrow('Longform, Shorts');
    expect(() => checkSettings({ searchWords: ['a'], format: 'both', reach: 'mars' })).toThrow('English or Worldwide');
    expect(() => checkSettings({ searchWords: Array.from({ length: 9 }, (_, i) => `w${i}`), format: 'both', reach: 'english' })).toThrow('at most 8');
    expect(() => saveScanSettings('../x', { searchWords: ['a'], format: 'both', reach: 'english' })).toThrow('Choose a topic');
  });

  it('estimates two 100-unit searches per word', () => {
    expect(scanEstimate(checkSettings({ searchWords: ['a', 'b'], format: 'both', reach: 'english' }))).toBe(404);
  });
});

describe('outside demand: YouTube scan', () => {
  const now = new Date(2026, 10, 25, 14, 30);

  it('searches each word two ways, merges duplicates, skips my channel, and saves the scan', async () => {
    saveScanSettings('sdam', { searchWords: ['SDAM'], format: 'both', reach: 'english', vidiq: false });
    const fetcher = fakeYoutube(
      { 'SDAM|viewCount': ['v1', 'v2', 'mine'], 'SDAM|date': ['v2', 'v3'] },
      [video('v1', 'PT12M', 'UCa', '5000'), video('v2', 'PT45S', 'UCb', '900'), video('v3', 'PT1H2M', 'UCc', '10'), video('mine', 'PT8M', 'UCme')],
    );
    const scan = await runYoutubeScan('sdam', { token: 't', fetcher, now, ownChannelId: 'UCme' });

    const searchUrls = fetcher.mock.calls.map(([url]) => new URL(url as string)).filter((u) => u.pathname.endsWith('/search'));
    expect(searchUrls.map((u) => u.searchParams.get('order'))).toEqual(['viewCount', 'date']);
    expect(searchUrls[0].searchParams.get('relevanceLanguage')).toBe('en');
    expect(searchUrls[1].searchParams.get('publishedAfter')).toBeTruthy();

    expect(scan.videos.map((v) => [v.id, v.kind, v.views])).toEqual([['v1', 'longform', 5000], ['v2', 'short', 900], ['v3', 'longform', 10]]);
    expect(scan.videos[1].foundBy).toEqual(['SDAM (Most Viewed)', 'SDAM (Newest, Last 90 Days)']);
    expect(scan.unitsUsed).toBe(201);

    const folder = scanFolderName(now);
    expect(folder).toBe('2026-11-25 1430');
    expect(fs.existsSync(path.join(config.videoProjectsDir, OUTSIDE_DIR, 'sdam', folder, VIDEOS_FILE))).toBe(true);
    expect(listScans('sdam')).toEqual([folder]);
    expect(outsideOverview('sdam').latest?.videos).toHaveLength(3);
  });

  it('keeps only Shorts or only longform when asked, and searches worldwide without a language', async () => {
    saveScanSettings('sdam', { searchWords: ['SDAM'], format: 'short', reach: 'worldwide', vidiq: false });
    const fetcher = fakeYoutube({ 'SDAM|viewCount': ['v1', 'v2'] }, [video('v1', 'PT12M'), video('v2', 'PT2M59S')]);
    const scan = await runYoutubeScan('sdam', { token: 't', fetcher, now, ownChannelId: null });
    expect(scan.videos.map((v) => v.id)).toEqual(['v2']);
    const search = new URL(fetcher.mock.calls[0][0] as string);
    expect(search.searchParams.has('relevanceLanguage')).toBe(false);
  });

  it('stops with a clear message when YouTube quota runs out, and saves nothing', async () => {
    const fetcher = vi.fn(async () => new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 }));
    await expect(runYoutubeScan('sdam', { token: 't', fetcher, now, ownChannelId: null })).rejects.toThrow('Out of YouTube quota');
    expect(listScans('sdam')).toEqual([]);
  });
});
