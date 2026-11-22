import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTree, removeTree } from './testing.js';

vi.mock('./youtube-auth.js', () => ({ youtubeAccessToken: async () => 'test-token', youtubeStatus: () => ({ reportingAccess: false }) }));
vi.mock('./youtube.js', () => ({ youtubeChannel: async () => ({ id: 'channel-id', title: 'Heart Mind Fusion' }) }));
let links = new Map<string, { piece: string; kind?: 'longform' | 'short' }>();
vi.mock('./video-links.js', () => ({ videoLinks: () => links }));
import { mergeChannelVideos, parseDuration, readChannelVideos, refreshChannelVideos } from './channel-videos.js';

let root: string;
beforeEach(() => {
  root = makeTree({});
  links = new Map([['b', { piece: '001 - Linked/Shorts/Clip', kind: 'short' }], ['c', { piece: 'Gone/Missing' }]]);
  process.env.HQ_CHANNEL_VIDEOS_FILE = path.join(root, 'channel-videos.json');
  const video = (id: string, duration: string, date: string) => ({ id, snippet: { title: `Video ${id}`, publishedAt: date }, contentDetails: { duration }, status: { privacyStatus: 'public' } });
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
    if (url.pathname.endsWith('/playlistItems')) {
      return url.searchParams.get('pageToken') ? Response.json({ items: [{ contentDetails: { videoId: 'c' } }, { contentDetails: { videoId: 'd' } }] })
        : Response.json({ items: [{ contentDetails: { videoId: 'a' } }, { contentDetails: { videoId: 'b' } }], nextPageToken: 'page2' });
    }
    if (url.pathname.endsWith('/videos')) return Response.json({ items: [video('a', 'PT12M30S', '2026-01-01T00:00:00Z'), video('b', 'PT45S', '2026-03-01T00:00:00Z'), video('c', 'PT2M10S', '2026-02-01T00:00:00Z'), video('d', 'PT1H1M1S', '2026-04-01T00:00:00Z')] });
    // Analytics: no numbers yet for video d
    return Response.json({ columnHeaders: [{ name: 'video' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'likes' }, { name: 'subscribersGained' }], rows: [['a', 100, 50, 30, 40.5, 7, 2], ['b', 9, 1, 20, 80, 0, 0]] });
  });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.HQ_CHANNEL_VIDEOS_FILE; removeTree(root); });

it('reads YouTube durations in seconds', () => {
  expect(parseDuration('PT12M30S')).toBe(750);
  expect(parseDuration('PT1H1M1S')).toBe(3661);
  expect(parseDuration('PT45S')).toBe(45);
  expect(parseDuration('nonsense')).toBe(0);
});

it('lists every video across pages, newest first, with numbers merged in', async () => {
  const list = await refreshChannelVideos();
  expect(list.videos.map((v) => v.id)).toEqual(['d', 'b', 'c', 'a']);
  expect(list.videos.find((v) => v.id === 'a')?.numbers).toEqual({ views: 100, minutesWatched: 50, averageViewDuration: 30, averageViewPercentage: 40.5, likes: 7, subscribersGained: 2 });
});

it('marks a video with no analytics yet as having no numbers, not zero', async () => {
  const list = await refreshChannelVideos();
  expect(list.videos.find((v) => v.id === 'd')?.numbers).toBeNull();
});

it('uses the project folder for linked videos and guesses from length for the rest', async () => {
  const byId = Object.fromEntries((await refreshChannelVideos()).videos.map((v) => [v.id, v]));
  expect(byId.b).toMatchObject({ kind: 'short', kindGuessed: false, piece: '001 - Linked/Shorts/Clip' });
  expect(byId.c).toMatchObject({ kind: 'short', kindGuessed: true, piece: 'Gone/Missing' }); // linked folder not found: guess
  expect(byId.a).toMatchObject({ kind: 'longform', kindGuessed: true, piece: null });
  expect(byId.d).toMatchObject({ kind: 'longform', kindGuessed: true });
});

it('saves a copy that opens without asking YouTube, and returns nothing before the first refresh', async () => {
  expect(readChannelVideos()).toBeNull();
  await refreshChannelVideos();
  expect(fs.existsSync(process.env.HQ_CHANNEL_VIDEOS_FILE!)).toBe(true);
  expect(readChannelVideos()?.channel.title).toBe('Heart Mind Fusion');
});

it('ignores a saved file in some other format instead of showing it', () => {
  fs.writeFileSync(process.env.HQ_CHANNEL_VIDEOS_FILE!, JSON.stringify([{ id: 'x', title: 'old script output' }]));
  expect(readChannelVideos()).toBeNull();
});

it('works links out when the list is opened, so a link made after the refresh shows straight away', async () => {
  await refreshChannelVideos();
  expect(readChannelVideos()?.videos.find((v) => v.id === 'a')?.piece).toBeNull();
  links.set('a', { piece: '002 - New/Longform', kind: 'longform' });
  expect(readChannelVideos()?.videos.find((v) => v.id === 'a')).toMatchObject({ piece: '002 - New/Longform', kindGuessed: false });
});

it('keeps a linked video as longform when its project piece says so, even if it is short', () => {
  const [v] = mergeChannelVideos([{ id: 'x', title: 't', publishedAt: '2026-01-01', seconds: 30, privacy: 'public' }], new Map(), new Map([['x', { piece: 'p', kind: 'longform' as const }]]));
  expect(v.kind).toBe('longform');
});
