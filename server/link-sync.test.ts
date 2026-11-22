import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';

vi.mock('./youtube-auth.js', () => ({ youtubeAccessToken: async () => 'test-token', youtubeStatus: () => ({ reportingAccess: false }) }));
vi.mock('./projects.js', () => ({
  listProjectVideos: () => [{ projectId: 'x', video: { name: 'x', path: '016 - Ocean', pieces: [
    { kind: 'longform', path: '016 - Ocean/Longform' }, { kind: 'short', path: '016 - Ocean/Shorts/S01' }, { kind: 'reel', path: '016 - Ocean/Reels/R01' }, { kind: 'short', path: '016 - Ocean/Shorts/Missing' },
  ] } }],
}));
import { linkFileVideoId, saveLinkFile } from './link-files.js';
import { syncLinkFiles } from './link-sync.js';
import { linkedVideos } from './youtube.js';

let root: string; let jobs: string; let previous: string;
const record = (piece: string, videoId: string, createdAt: string) => fs.writeFileSync(path.join(jobs, `${Math.random().toString(16).slice(2)}.json`), JSON.stringify({ id: 'a', piece, video: '', status: 'done', videoId, sent: 0, total: 0, createdAt }));
beforeEach(() => {
  root = makeTree({ '016 - Ocean/Longform/': '', '016 - Ocean/Shorts/S01/': '', '016 - Ocean/Reels/R01/': '' });
  jobs = makeTree({});
  process.env.HQ_YOUTUBE_JOBS_DIR = jobs;
  previous = config.videoProjectsDir; config.videoProjectsDir = root;
});
afterEach(() => { delete process.env.HQ_YOUTUBE_JOBS_DIR; config.videoProjectsDir = previous; removeTree(root); removeTree(jobs); });

it('writes a missing link file from the record, and skips reels and folders that do not exist', () => {
  record('016 - Ocean/Longform', 'AAAAAAAAAAA', '2026-01-01T00:00:00Z');
  record('016 - Ocean/Reels/R01', 'BBBBBBBBBBB', '2026-01-01T00:00:00Z');
  record('016 - Ocean/Shorts/Missing', 'CCCCCCCCCCC', '2026-01-01T00:00:00Z');
  expect(syncLinkFiles()).toEqual({ written: 1, restored: 0 });
  expect(fs.readFileSync(path.join(root, '016 - Ocean/Longform/YouTube Link.txt'), 'utf8')).toBe('https://www.youtube.com/watch?v=AAAAAAAAAAA\n');
  expect(fs.existsSync(path.join(root, '016 - Ocean/Reels/R01/YouTube Link.txt'))).toBe(false);
});

it('uses the newest record when a piece was linked twice', () => {
  record('016 - Ocean/Longform', 'OLDOLDOLDOL', '2026-01-01T00:00:00Z');
  record('016 - Ocean/Longform', 'NEWNEWNEWNE', '2026-02-01T00:00:00Z');
  syncLinkFiles();
  expect(linkFileVideoId('016 - Ocean/Longform')).toBe('NEWNEWNEWNE');
});

it('never overwrites an existing link file when filling in old videos', () => {
  fs.writeFileSync(path.join(root, '016 - Ocean/Longform/YouTube Link.txt'), 'https://www.youtube.com/watch?v=KEEPKEEPKEE\n');
  expect(saveLinkFile('016 - Ocean/Longform', 'OTHEROTHERO', false)).toBe('exists');
  expect(linkFileVideoId('016 - Ocean/Longform')).toBe('KEEPKEEPKEE');
  expect(saveLinkFile('016 - Ocean/Longform', 'OTHEROTHERO', true)).toBe('written'); // an explicit new link does replace it
  expect(linkFileVideoId('016 - Ocean/Longform')).toBe('OTHEROTHERO');
});

it('loses nothing when the records folder is deleted: the next sync rebuilds them from Drive', () => {
  record('016 - Ocean/Longform', 'AAAAAAAAAAA', '2026-01-01T00:00:00Z');
  record('016 - Ocean/Shorts/S01', 'SSSSSSSSSSS', '2026-01-01T00:00:00Z');
  syncLinkFiles();
  fs.rmSync(jobs, { recursive: true, force: true });
  expect(linkedVideos()).toEqual([]);
  expect(syncLinkFiles()).toEqual({ written: 0, restored: 2 });
  expect(linkedVideos().map((l) => l.videoId).sort()).toEqual(['AAAAAAAAAAA', 'SSSSSSSSSSS']);
  expect(syncLinkFiles()).toEqual({ written: 0, restored: 0 }); // and a second run changes nothing
});

it('lets the Drive file win when it disagrees with the record', () => {
  record('016 - Ocean/Longform', 'RECORDRECOR', '2026-01-01T00:00:00Z');
  fs.writeFileSync(path.join(root, '016 - Ocean/Longform/YouTube Link.txt'), 'https://www.youtube.com/watch?v=FILEFILEFIL\n');
  expect(syncLinkFiles().restored).toBe(1);
  expect(linkedVideos().at(-1)).toEqual({ piece: '016 - Ocean/Longform', videoId: 'FILEFILEFIL' });
});
