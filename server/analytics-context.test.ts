import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { videoContext } from './analytics-context.js';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

it('provides timed captions and local packaging without changing the originals', async () => {
  const root = makeTree({ 'Video/Longform/Subtitles/captions.srt': '1\n00:00:00,000 --> 00:00:05,000\nHello', 'Video/Longform/Packaging/V02/YouTube.md': 'Title:\nTitle here', 'Video/Longform/Packaging/V02/Thumbnail/Thumbnail.png': 'picture' });
  const work = makeTree({}); const old = config.videoProjectsDir; config.videoProjectsDir = root;
  try {
    const result = await videoContext('Video/Longform', work);
    expect(result.text).toContain('Transcript.srt');
    expect(result.text).toContain('may not match YouTube');
    expect(fs.readFileSync(path.join(work, 'Transcript.srt'), 'utf8')).toContain('Hello');
    expect(result.images.map(file => path.basename(file))).toEqual(['Packaging-Thumbnail.png']);
    expect(fs.readFileSync(path.join(root, 'Video/Longform/Packaging/V02/YouTube.md'), 'utf8')).toContain('Title here');
  } finally { config.videoProjectsDir = old; removeTree(root); removeTree(work); }
});
