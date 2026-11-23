import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readAnalysisTranscript, videoContext } from './analytics-context.js';
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

it('prefers plain text for reading and formats subtitle-only transcripts into prose', async () => {
  const cue = '1\r\n00:00:00,000 --> 00:00:04,000\r\n<i>This is the first sentence.</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:08,000\r\nThis is the second sentence.\r\n';
  const longCue = cue + '\r\n3\r\n00:00:08,000 --> 00:01:00,000\r\n' + 'Another sentence in the transcript. '.repeat(20);
  const root = makeTree({
    'Both/Longform/Subtitles/Transcript.txt': 'First paragraph.\r\n\r\nSecond paragraph.',
    'Both/Longform/Subtitles/Captions.srt': cue,
    'Timed/Longform/Subtitles/Captions.srt': longCue,
  });
  const old = config.videoProjectsDir; config.videoProjectsDir = root;
  try {
    await expect(readAnalysisTranscript('Both/Longform')).resolves.toEqual({ source: 'transcript', text: 'First paragraph.\n\nSecond paragraph.' });
    const transcript = await readAnalysisTranscript('Timed/Longform');
    expect(transcript?.text).toMatch(/^This is the first sentence\. This is the second sentence\./);
    expect(transcript?.text.split('\n\n').length).toBeGreaterThan(1);
    expect(transcript?.text).not.toMatch(/-->|<\/?i>/);
    expect(fs.readFileSync(path.join(root, 'Timed/Longform/Subtitles/Captions.srt'), 'utf8')).toBe(longCue);
  } finally { config.videoProjectsDir = old; removeTree(root); }
});
