import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { channelOverview, channelVideoDetail, refreshChannelWorkspace } from './channel-workspace.js';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import { downloadChannelAnalytics } from './channel-analytics.js';
import { readChannelVideos, refreshChannelVideos } from './channel-videos.js';

vi.mock('./channel-analytics.js', () => ({ downloadChannelAnalytics: vi.fn() }));
vi.mock('./channel-videos.js', () => ({ readChannelVideos: vi.fn(), refreshChannelVideos: vi.fn() }));
vi.mock('./video-links.js', () => ({ videoLinks: () => new Map([['abcdefghijk', { piece: 'Video/Longform' }]]) }));

const channel = { id: 'channel', title: 'Example Channel' };
const catalog = { channel, updatedAt: '2026-11-23T16:00:00Z', videos: [] };
const date = '2026-11-23';
let root: string;
let previous: string;
beforeEach(() => {
  root = makeTree({
    [`_HeartQuarters/Analytics/${date}/Stats.json`]: JSON.stringify({
      channel, downloadedAt: catalog.updatedAt,
      reports: [{ name: 'Last 28 Days', start: '2026-10-27', end: date, report: { columns: ['views', 'estimatedMinutesWatched'], rows: [[100, 60]] } }],
      reach: { status: 'ready', days: [
        { start: '2026-11-21', end: '2026-11-22', rows: [{ video_id: 'abcdefghijk', video_thumbnail_impressions: '20', video_thumbnail_impressions_ctr: '0.25' }] },
        { start: '2026-11-22', end: date, rows: [{ video_id: 'lmnopqrstuv', video_thumbnail_impressions: '30', video_thumbnail_impressions_ctr: '0.10' }] },
      ] },
    }),
    'Video/Longform/Subtitles/Captions.srt': 'A local transcript.',
    'Video/Longform/Exports/Video.mp4': 'example',
    'Video/Longform/Exports/Notes.txt': 'Ignore this file.',
  });
  previous = config.videoProjectsDir;
  config.videoProjectsDir = root;
  vi.clearAllMocks();
});
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });

it('refreshes both sources together, shares concurrent refreshes and keeps the catalog if it fails', async () => {
  vi.mocked(readChannelVideos).mockReturnValue(catalog);
  vi.mocked(refreshChannelVideos).mockRejectedValue(new Error('Unavailable'));
  vi.mocked(downloadChannelAnalytics).mockResolvedValue({ file: 'Stats.json', channel: channel.title, emptyReports: [], topVideoCount: 0, reach: { status: 'unavailable', note: 'No reach reports.' } });
  const first = refreshChannelWorkspace();
  expect(refreshChannelWorkspace()).toBe(first);
  await expect(first).resolves.toEqual({ catalog, errors: ['Video catalog: Unavailable'] });
  expect(downloadChannelAnalytics).toHaveBeenCalledTimes(1);
  expect(refreshChannelVideos).toHaveBeenCalledTimes(1);
});

it('shows channel totals and each video’s own reported reach window', () => {
  const overview = channelOverview();
  expect(overview?.periods[0]).toMatchObject({ views: 100, watchHours: 1 });
  expect(overview?.reach).toMatchObject({ impressions: 50, ctrPercent: 16 });
  expect(overview?.videoReach.abcdefghijk).toMatchObject({ impressions: 20, ctrPercent: 25, from: '2026-11-21', to: '2026-11-22' });
  expect(overview?.videoReach.lmnopqrstuv).toMatchObject({ impressions: 30, ctrPercent: 10 });
});

it('finds playable exports and the transcript by linked video and checks the requested ID', async () => {
  await expect(channelVideoDetail('abcdefghijk')).resolves.toEqual({
    piece: 'Video/Longform',
    exports: [{ name: 'Video.mp4', path: 'Video/Longform/Exports/Video.mp4', size: 7, modified: expect.any(Number) }],
    transcript: { source: 'transcript', text: 'A local transcript.' },
  });
  await expect(channelVideoDetail('lmnopqrstuv')).resolves.toEqual({ piece: null, exports: [], transcript: null });
  await expect(channelVideoDetail('../not-a-video')).rejects.toThrow('Choose a YouTube video');
});

it('leaves playback unavailable when the Exports folder points outside Video Projects', async () => {
  const outside = makeTree({ 'Outside.mp4': 'outside' });
  const exports = path.join(root, 'Video/Longform/Exports');
  fs.renameSync(exports, path.join(root, 'Video/Longform/Previous Exports'));
  try {
    fs.symlinkSync(outside, exports, 'junction');
    await expect(channelVideoDetail('abcdefghijk')).resolves.toMatchObject({ exports: [] });
  } finally { removeTree(outside); }
});
