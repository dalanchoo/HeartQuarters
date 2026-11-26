import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTree, removeTree } from './testing.js';
import type { EndScreenData } from './youtube-end-screens.js';

let endScreens: EndScreenData | Error | undefined;
vi.mock('./youtube-auth.js', () => ({ youtubeAccessToken: async () => 'test-token', youtubeStatus: () => ({ reportingAccess: endScreens !== undefined }) }));
vi.mock('./youtube-end-screens.js', () => ({
  getEndScreenData: async () => {
    if (endScreens instanceof Error) throw endScreens;
    return endScreens;
  },
}));
vi.mock('./youtube.js', () => ({ youtubeChannel: async () => ({ id: 'channel-id', title: 'Heart Mind Fusion' }) }));
vi.mock('./video-profile.js', () => ({ readVideoProfile: () => ({ topic: 'unassigned', topic2: 'unassigned', angle: 'unassigned', angle2: 'unassigned', note: '' }) }));
let links = new Map<string, { piece: string; kind?: 'longform' | 'short' }>();
vi.mock('./video-links.js', () => ({ videoLinks: () => links }));
import { collectChannelVideos, mergeChannelVideos, parseDuration, readChannelVideos, refreshChannelVideos } from './channel-videos.js';

let root: string;
let extraIds: string[];
let trafficBatches: string[][];
let trafficStatus: number;
let nextTrafficStatus: number | undefined;
beforeEach(() => {
  root = makeTree({});
  endScreens = undefined;
  extraIds = [];
  trafficBatches = [];
  trafficStatus = 200;
  nextTrafficStatus = undefined;
  links = new Map([['b', { piece: '001 - Linked/Shorts/Clip', kind: 'short' }], ['c', { piece: 'Gone/Missing' }]]);
  process.env.HQ_CHANNEL_VIDEOS_FILE = path.join(root, 'channel-videos.json');
  const video = (id: string, duration: string, date: string) => ({ id, snippet: { title: `Video ${id}`, publishedAt: date }, contentDetails: { duration }, status: { privacyStatus: 'public' } });
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] });
    if (url.pathname.endsWith('/playlistItems')) {
      return url.searchParams.get('pageToken') ? Response.json({ items: ['b', 'c', 'd', ...extraIds].map(videoId => ({ contentDetails: { videoId } })) })
        : Response.json({ items: [{ contentDetails: { videoId: 'a' } }, { contentDetails: { videoId: 'b' } }], nextPageToken: 'page2' });
    }
    if (url.pathname.endsWith('/videos')) return Response.json({ items: [video('a', 'PT12M30S', '2026-01-01T00:00:00Z'), video('b', 'PT45S', '2026-03-01T00:00:00Z'), video('c', 'PT2M10S', '2026-02-01T00:00:00Z'), video('d', 'PT1H1M1S', '2026-04-01T00:00:00Z'), ...extraIds.map(id => video(id, 'PT45S', '2026-04-01T00:00:00Z'))] });
    const dimensions = url.searchParams.get('dimensions');
    if (dimensions?.includes('insightTrafficSourceType')) {
      const filter = url.searchParams.get('filters') ?? '';
      expect(filter).toMatch(/^video==/);
      expect(url.searchParams.get('metrics')).toBe('views');
      const ids = filter.slice('video=='.length).split(',');
      trafficBatches.push(ids);
      const status = nextTrafficStatus ?? trafficStatus;
      nextTrafficStatus = undefined;
      if (status !== 200) return new Response(null, { status });
      const rows = [['a', 'YT_SEARCH', 25], ['b', 'SUBSCRIBER', 5], ['a', 'SUBSCRIBER', 0], ['a', 'SHORTS', 15], ['c', 'YT_SEARCH', 2], ['h', 'SUBSCRIBER', 3]];
      const matching = rows.filter(([id]) => ids.includes(String(id)));
      expect(dimensions).toBe(ids.length === 1 ? 'insightTrafficSourceType' : 'video,insightTrafficSourceType');
      return Response.json({ rows: ids.length === 1 ? matching.map(row => row.slice(1)) : matching });
    }
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

it('also fetches linked project videos omitted by the uploads playlist, ignoring other channels', async () => {
  links.set('linkedOnly', { piece: '005 - Series/005B - Night One/Longform', kind: 'longform' });
  links.set('otherChannel', { piece: '999 - Other/Longform', kind: 'longform' });
  const prevFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/videos')) {
      return Response.json({
        items: [
          { id: 'linkedOnly', snippet: { channelId: 'channel-id', title: 'Day One', publishedAt: '2025-12-26T23:24:09Z' }, contentDetails: { duration: 'PT14M19S' }, status: { privacyStatus: 'public' } },
          { id: 'otherChannel', snippet: { channelId: 'someone-else', title: 'Not Mine', publishedAt: '2025-12-26T23:24:09Z' }, contentDetails: { duration: 'PT5M' }, status: { privacyStatus: 'public' } },
        ],
      });
    }
    return prevFetch(input);
  });
  const list = await collectChannelVideos({ id: 'channel-id', title: 'Heart Mind Fusion' }, new Date('2026-11-22T12:00:00Z'));
  expect(list.videos.map((v) => v.id)).toEqual(['linkedOnly']);
  expect(list.videos[0].piece).toBe('005 - Series/005B - Night One/Longform');
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

it('keeps reported search and browse counts, including zero, in the saved list', async () => {
  await refreshChannelVideos();
  const byId = Object.fromEntries(readChannelVideos()!.videos.map((v) => [v.id, v]));
  expect(byId.a.traffic).toEqual({ searchViews: 25, browseViews: 0 });
  expect(byId.b.traffic).toEqual({ browseViews: 5 });
  expect(byId.c.traffic).toEqual({ searchViews: 2 });
  expect(byId.d.traffic).toBeUndefined();
});

it('splits lifetime traffic requests to stay within YouTube’s video-day limit', async () => {
  extraIds = ['e', 'f', 'g', 'h'];
  const list = await collectChannelVideos({ id: 'channel-id', title: 'Heart Mind Fusion' }, new Date('2026-11-22T12:00:00Z'));
  expect(trafficBatches).toEqual([['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['h']]);
  expect(list.videos.find(v => v.id === 'h')?.traffic).toEqual({ browseViews: 3 });
});

it('retries a search and browse batch once when YouTube returns a server error', async () => {
  nextTrafficStatus = 500;
  const list = await refreshChannelVideos();
  expect(trafficBatches).toEqual([['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']]);
  expect(list.videos.find((video) => video.id === 'a')?.traffic?.searchViews).toBe(25);
  expect(list.trafficError).toBeUndefined();
});

it('refreshes end screens and video rows when both traffic attempts fail and retains saved traffic', async () => {
  const previous = await refreshChannelVideos();
  trafficStatus = 503;
  endScreens = { status: 'ready', startDate: '2026-11-12', endDate: '2026-11-12', reportedDays: 1, videos: {} };
  extraIds = ['new'];
  const list = await refreshChannelVideos();
  expect(list.endScreens).toEqual(endScreens);
  expect(list.trafficError).toContain('could not load your search and browse views (503)');
  expect(list.trafficUpdatedAt).toBe(previous.trafficUpdatedAt);
  expect(list.videos.find((video) => video.id === 'new')).toMatchObject({ id: 'new', numbers: null });
  expect(list.videos.find((video) => video.id === 'new')?.traffic).toBeUndefined();
  expect(readChannelVideos()?.videos.find((video) => video.id === 'a')?.traffic).toEqual({ searchViews: 25, browseViews: 0 });
  expect(readChannelVideos()?.endScreens).toEqual(endScreens);
});

it('can load the video list on the first refresh even when traffic is unavailable', async () => {
  trafficStatus = 503;
  const list = await refreshChannelVideos();
  expect(list.videos).toHaveLength(4);
  expect(list.trafficUpdatedAt).toBeUndefined();
  expect(list.trafficError).toContain('503');
});

it('opens an older saved list before search and browse views have been fetched', async () => {
  await refreshChannelVideos();
  const file = process.env.HQ_CHANNEL_VIDEOS_FILE!;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const video of saved.videos) delete video.traffic;
  fs.writeFileSync(file, JSON.stringify(saved));
  const video = readChannelVideos()?.videos.find((v) => v.id === 'a');
  expect(video?.numbers?.views).toBe(100);
  expect(video?.traffic).toBeUndefined();
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

it('saves end screen activity and keeps the saved totals if only the reporting request fails', async () => {
  const activity: EndScreenData = {
    status: 'ready', startDate: '2026-11-10', endDate: '2026-11-12', reportedDays: 3,
    videos: { a: [{ id: 'element-a', type: 'Video', impressions: 40, clicks: 4 }] },
  };
  endScreens = activity;
  await refreshChannelVideos();
  expect(readChannelVideos()?.endScreens).toEqual(activity);
  endScreens = new Error('End screen report is temporarily unavailable.');
  const refreshed = await refreshChannelVideos();
  expect(refreshed.videos).toHaveLength(4);
  expect(readChannelVideos()?.endScreens).toEqual({ ...activity, note: endScreens.message });
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

it('lists a video once even when YouTube repeats it across pages, and cleans up an older saved list that holds a repeat', async () => {
  const list = await refreshChannelVideos();
  expect(list.videos.map((v) => v.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  const saved = JSON.parse(fs.readFileSync(process.env.HQ_CHANNEL_VIDEOS_FILE!, 'utf8'));
  saved.videos.push(saved.videos[0]);
  fs.writeFileSync(process.env.HQ_CHANNEL_VIDEOS_FILE!, JSON.stringify(saved));
  expect(readChannelVideos()?.videos).toHaveLength(4);
});
