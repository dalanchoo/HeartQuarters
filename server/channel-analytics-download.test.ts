import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

vi.mock('./youtube-auth.js', () => ({ youtubeAccessToken: async () => 'test-token' }));
vi.mock('./youtube.js', () => ({ youtubeChannel: async () => ({ id: 'channel-id', title: 'Heart Mind Fusion' }), uploadsFor: () => [] }));
import { downloadChannelAnalytics } from './channel-analytics.js';

let root: string; let previous: string;
beforeEach(() => { root = makeTree({}); previous = config.videoProjectsDir; config.videoProjectsDir = root; vi.stubGlobal('fetch', async () => Response.json({ columnHeaders: [{ name: 'views' }], rows: [[42]] })); });
afterEach(() => { vi.unstubAllGlobals(); config.videoProjectsDir = previous; removeTree(root); });
it('saves the connected channel reports under the projects analytics folder', async () => {
  const result = await downloadChannelAnalytics();
  expect(result.channel).toBe('Heart Mind Fusion');
  const saved = JSON.parse(fs.readFileSync(path.join(root, result.file), 'utf8'));
  expect(saved.channel.id).toBe('channel-id');
  expect(saved.reports).toHaveLength(6);
});
