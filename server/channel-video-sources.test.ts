import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readChannelVideos } from './channel-videos.js';
import { config } from './config.js';
import { syncLinkFiles } from './link-sync.js';
import { makeTree, removeTree } from './testing.js';

const clip = '005 - Series/005A - One/Shorts/S01';
const otherId = 'OTHEROTHERO';
const clipId = 'SHORTSHORTS';
const standaloneId = 'ALONEALONEA';
const unlinkedId = 'UNKNOWNLINK';
const link = (id: string) => `https://www.youtube.com/watch?v=${id}\n`;
const previous = config.videoProjectsDir;
let root: string;
let data: string;

function cacheChannelList() {
  fs.mkdirSync(data, { recursive: true });
  const videos = [otherId, clipId, standaloneId, unlinkedId].map((id) => ({
    id, title: id, publishedAt: '2026-01-01', seconds: id === standaloneId ? 240 : 60, privacy: 'public', numbers: null,
  }));
  fs.writeFileSync(path.join(data, 'channel.json'), JSON.stringify({ videos }));
}

beforeEach(() => {
  root = makeTree({
    'Projects/005 - Series/005A - One/Longform/': '',
    [`Projects/${clip}/YouTube Link.txt`]: link(clipId),
    [`Projects/${clip}/From Longform.txt`]: 'Standalone\n',
    'Projects/006 - Other/Longform/YouTube Link.txt': link(otherId),
    'Projects/007 - No Parent/Shorts/S01/YouTube Link.txt': link(unlinkedId),
    'Projects/999 - Shorts/2026/999-2026-01 - Alone/Packaging/': '',
    'Projects/999 - Shorts/2026/999-2026-01 - Alone/YouTube Link.txt': link(standaloneId),
  });
  config.videoProjectsDir = path.join(root, 'Projects');
  data = path.join(root, 'data');
  vi.stubEnv('HQ_YOUTUBE_JOBS_DIR', path.join(data, 'youtube-uploads'));
  vi.stubEnv('HQ_CHANNEL_VIDEOS_FILE', path.join(data, 'channel.json'));
  syncLinkFiles();
  cacheChannelList();
});

afterEach(() => {
  config.videoProjectsDir = previous;
  vi.unstubAllEnvs();
  removeTree(root);
});

const sourceOf = (id: string) => readChannelVideos()?.videos.find((video) => video.id === id)?.fromLongform;

it('uses the parent folder even without a longform YouTube link and leaves any old override file intact', () => {
  expect(sourceOf(clipId)).toBe('005 - Series/005A - One/Longform');
  expect(fs.readFileSync(path.join(config.videoProjectsDir, clip, 'From Longform.txt'), 'utf8')).toBe('Standalone\n');
});

it('leaves the source unknown for Shorts without a parent and blank for longform videos', () => {
  expect(sourceOf(unlinkedId)).toBeNull();
  expect(sourceOf(otherId)).toBeUndefined();
});

it('classifies a linked Short in 999 - Shorts as Standalone without a saved source or a duration guess', () => {
  const video = readChannelVideos()?.videos.find((v) => v.id === standaloneId);
  expect(video).toMatchObject({ kind: 'short', kindGuessed: false, fromLongform: 'standalone' });
});

it('derives the same source after the cache is rebuilt', () => {
  removeTree(data);
  syncLinkFiles();
  cacheChannelList();
  expect(sourceOf(clipId)).toBe('005 - Series/005A - One/Longform');
  expect(sourceOf(standaloneId)).toBe('standalone');
});
