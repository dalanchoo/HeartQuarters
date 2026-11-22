import { beforeEach, expect, it, vi } from 'vitest';

let records: { piece: string; videoId: string }[] = [];
let urlFiles: Record<string, string> = {};
vi.mock('./youtube.js', () => ({ linkedVideos: () => records }));
vi.mock('./shorts.js', () => ({ readLongformUrl: (video: string) => urlFiles[video] ?? null }));
vi.mock('./projects.js', () => ({
  listProjectVideos: () => [
    { projectId: 'a', video: { name: 'a', path: '016 - Ocean', pieces: [{ kind: 'longform', path: '016 - Ocean/Longform' }, { kind: 'short', path: '016 - Ocean/Shorts/S01' }] } },
    { projectId: 'b', video: { name: 'b', path: '017 - Pain', pieces: [{ kind: 'longform', path: '017 - Pain/Longform' }] } },
  ],
}));
import { videoLinks } from './video-links.js';

beforeEach(() => { records = []; urlFiles = {}; });

it('uses upload records, with the kind of the piece folder', () => {
  records = [{ piece: '016 - Ocean/Shorts/S01', videoId: 'shortid' }];
  expect(videoLinks().get('shortid')).toEqual({ piece: '016 - Ocean/Shorts/S01', kind: 'short' });
});

it('finds a longform from the Drive file when it has no upload record', () => {
  urlFiles = { '017 - Pain': 'https://www.youtube.com/watch?v=VagD6WIie8w' };
  expect(videoLinks().get('VagD6WIie8w')).toEqual({ piece: '017 - Pain/Longform', kind: 'longform' });
});

it('lets an upload record win over the Drive file for the same longform', () => {
  records = [{ piece: '017 - Pain/Longform', videoId: 'recordid1' }];
  urlFiles = { '017 - Pain': 'https://www.youtube.com/watch?v=otherid0000' };
  const links = videoLinks();
  expect(links.has('recordid1')).toBe(true);
  expect(links.has('otherid0000')).toBe(false);
});

it('ignores a Drive file that is not a YouTube address', () => {
  urlFiles = { '017 - Pain': 'not a link' };
  expect(videoLinks().size).toBe(0);
});
