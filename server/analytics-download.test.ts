import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

vi.mock('./youtube-auth.js', () => ({ youtubeAccessToken: async () => 'test-token' }));
vi.mock('./youtube.js', () => ({ uploadsFor: (piece: string) => piece === 'Video/Longform' ? [{ id: 'linked', status: 'done', videoId: 'abcdefghijk' }] : [] }));
vi.mock('./youtube-video.js', () => ({ readYoutubeVideo: async () => ({ resource: { snippet: { publishedAt: '2026-01-01T12:00:00Z' } } }) }));
import { downloadVideoAnalytics } from './analytics.js';

let root: string; let previous: string;
beforeEach(() => { root = makeTree({ 'Video/Longform/': '' }); previous = config.videoProjectsDir; config.videoProjectsDir = root; vi.stubGlobal('fetch', async () => Response.json({ columnHeaders: [{ name: 'views' }], rows: [[42]] })); });
afterEach(() => { vi.unstubAllGlobals(); config.videoProjectsDir = previous; removeTree(root); });

it('downloads and saves a linked video using its YouTube publication date', async () => {
  const result = await downloadVideoAnalytics('Video/Longform', 'linked');
  expect(result.missingRetention).toEqual([]);
  const saved = JSON.parse(fs.readFileSync(path.join(root, result.file), 'utf8'));
  expect(saved.videoId).toBe('abcdefghijk');
  expect(saved.periods).toHaveLength(4);
});

it('does not download or write for an unrelated or missing link', async () => {
  await expect(downloadVideoAnalytics('Video/Longform', 'wrong')).rejects.toThrow('Link this video');
  expect(fs.existsSync(path.join(root, 'Video/Longform/Analytics'))).toBe(false);
});
