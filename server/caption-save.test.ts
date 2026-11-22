import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

const SHORT = "022 - Worth Telling Them/Shorts/022_S09 - You're Lucky";
const PIECES = ['022 - Worth Telling Them/Longform', SHORT, '999 - Shorts/2025/999-2025-01 - Protein Bar', '015 - NVC/015A - Making Conversations Worse/Longform'];
vi.mock('./projects.js', () => ({ listProjectVideos: () => PIECES.map((p) => ({ projectId: p, video: { name: p, path: p, pieces: [{ kind: 'longform', path: p }] } })) }));
import { captionPlainText, captionPrefix, saveYoutubeCaptions } from './caption-save.js';

const SRT = "1\n00:00:00,000 --> 00:00:02,000\nMy profound thought is I'm hungry.\n\n2\n00:00:02,000 --> 00:00:04,000\nHoly damn, that's good.\n";
let root: string; let previous: string;
beforeEach(() => { root = makeTree(Object.fromEntries(PIECES.map((p) => [`${p}/`, '']))); previous = config.videoProjectsDir; config.videoProjectsDir = root; });
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });

it('names the captions file by the video number, like the other captions files', () => {
  expect(captionPrefix('022 - Worth Telling Them/Longform')).toBe('022');
  expect(captionPrefix('015 - NVC/015A - Making Conversations Worse/Longform')).toBe('015A');
  expect(captionPrefix('010 - Invalidated Feelings/010A - How To Not Be Heard/Shorts/010A_S06 - Privilege Example')).toBe('010A_S06');
  expect(captionPrefix(SHORT)).toBe('022_S09');
  expect(captionPrefix("999 - Shorts/2026/999-2026-01 - You're the Constant")).toBe('999-2026-01');
  expect(captionPrefix('999 - Shorts/2025/999-2025-01 - Protein Bar')).toBe('999-2025-01');
  expect(() => captionPrefix('Notes/Random Folder')).toThrow(/Can't tell/);
});

it('turns SRT into just the words', () => {
  expect(captionPlainText(SRT)).toBe("My profound thought is I'm hungry. Holy damn, that's good.");
  expect(captionPlainText('WEBVTT\n\n00:00.000 --> 00:02.000\nHello there\n')).toBe('Hello there');
});

it('writes the plain words and the timed captions exactly as sent, named by the video number, making the folder when it is missing', () => {
  const piece = '999 - Shorts/2025/999-2025-01 - Protein Bar';
  const r = saveYoutubeCaptions(piece, SRT);
  expect(r.written.map((f) => [f.name, f.replaced])).toEqual([['999-2025-01-captions.txt', false], ['999-2025-01-captions.srt', false]]);
  expect(fs.readFileSync(path.join(root, piece, 'Subtitles', '999-2025-01-captions.txt'), 'utf8')).toBe("My profound thought is I'm hungry. Holy damn, that's good.\r\n");
  expect(fs.readFileSync(path.join(root, piece, 'Subtitles', '999-2025-01-captions.srt'), 'utf8')).toBe(SRT);
});

it('replaces captions files that are already there, and only those two', () => {
  const dir = path.join(root, SHORT, 'Subtitles');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '022_S09-captions.txt'), 'old words');
  fs.writeFileSync(path.join(dir, '022_S09-captions.srt'), 'old timed');
  fs.writeFileSync(path.join(dir, '022_S09-captions.vtt'), 'older vtt');
  const r = saveYoutubeCaptions(SHORT, SRT);
  expect(r.written.map((f) => [f.name, f.replaced])).toEqual([['022_S09-captions.txt', true], ['022_S09-captions.srt', true]]);
  expect(fs.readFileSync(path.join(dir, '022_S09-captions.srt'), 'utf8')).toBe(SRT);
  expect(fs.readFileSync(path.join(dir, '022_S09-captions.vtt'), 'utf8')).toBe('older vtt');
});

it('refuses empty captions and any folder that is not a video piece', () => {
  expect(() => saveYoutubeCaptions('022 - Worth Telling Them/Longform', '  ')).toThrow(/no captions/);
  expect(() => saveYoutubeCaptions('022 - Worth Telling Them/Longform', '1\n00:00:00,000 --> 00:00:01,000\n')).toThrow(/no words/);
  expect(() => saveYoutubeCaptions('../outside', SRT)).toThrow(/Choose a video/);
  expect(() => saveYoutubeCaptions(undefined, SRT)).toThrow(/Choose a video/);
});
