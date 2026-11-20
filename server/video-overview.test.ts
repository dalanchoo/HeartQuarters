import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from './testing';
import { makeVideoOverview, readLinkRecords } from './video-overview';
import type { Video } from './projects';
import { config } from './config';

let tmp: string;
beforeEach(() => { tmp = makeTree({ 'jobs/111.json': JSON.stringify({ piece: 'p/Shorts/s', status: 'done', videoId: '8rpVGGL5N10' }), 'jobs/222.json': 'broken' }); });
afterEach(() => removeTree(tmp));
const videos: { projectId: string; video: Video }[] = [{ projectId: 'p', video: { name: 'p', path: 'p', pieces: [
  { name: 'Longform', kind: 'longform', path: 'p/Longform', exports: [], packagingVersion: 'V01', versions: [{ name: 'V01', path: 'v1', docs: [], covers: [{ name: 'cover', path: 'cover', size: 1 }], notes: null }], drafts: null },
  { name: 's', kind: 'short', path: 'p/Shorts/s', exports: [], packagingVersion: null, versions: [], drafts: null },
] } }];
describe('video overview', () => {
  it('reports saved longform links, known Short uploads, and local packaging separately', () => {
    const result = makeVideoOverview(videos, { jobs: [{ piece: 'p/Shorts/s', status: 'done', videoId: '8rpVGGL5N10' }], complete: true }, () => ({ state: 'linked', id: '8rpVGGL5N10' }));
    expect(result[0]).toMatchObject({ link: 'linked', localThumbnail: true });
    expect(result[1]).toMatchObject({ link: 'linked', localThumbnail: false });
  });
  it('reports the CapCut, Exported, Metadata and Thumbnail steps', () => {
    const old = config.videoProjectsDir; config.videoProjectsDir = tmp;
    try {
      fs.mkdirSync(path.join(tmp, 'p/Longform/Packaging/V01'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'p/Longform/Packaging/V01/YouTube.md'), 'Title:\nA Title\n\nDescription:\nWords #sdam\n\nTags:\nSDAM\n\nPinned Comment:\nHi\n\nVideo language:\nen-US\n\nMade for kids:\nNo\n\nAltered content:\nNo\n');
      const doc = { name: 'YouTube.md', path: 'p/Longform/Packaging/V01/YouTube.md', size: 1 };
      const cover = { name: 'Thumbnail.png', path: 'p/Longform/Packaging/V01/Thumbnail/Thumbnail.png', size: 1 };
      const video: Video = { name: 'p', path: 'p', pieces: [
        { name: 'Longform', kind: 'longform', path: 'p/Longform', exports: [{ name: 'p.mp4', path: 'p/Longform/Exports/p.mp4', size: 1 }], packagingVersion: 'V01', drafts: null, versions: [{ name: 'V01', path: 'p/Longform/Packaging/V01', docs: [doc], covers: [cover], notes: null }] },
        { name: 'p_S01 - One', kind: 'short', path: 'p/Shorts/p_S01 - One', exports: [], packagingVersion: 'V01', drafts: null, versions: [{ name: 'V01', path: 'x', docs: [], covers: [cover], notes: null }] },
        { name: 'p_S02 - Two', kind: 'short', path: 'p/Shorts/p_S02 - Two', exports: [], packagingVersion: null, drafts: null, versions: [] },
      ] };
      const result = makeVideoOverview([{ projectId: 'Group/p', video }], { jobs: [], complete: true }, () => ({ state: 'missing' }), new Set(['p', 'p_s01 - one']));
      expect(result.map(({ capcut, exported, metadataMissing, localThumbnail }) => ({ capcut, exported, metadata: metadataMissing.length, localThumbnail }))).toEqual([
        { capcut: true, exported: true, metadata: 0, localThumbnail: true },
        { capcut: true, exported: false, metadata: 8, localThumbnail: true },
        { capcut: false, exported: false, metadata: 8, localThumbnail: false },
      ]);
    } finally { config.videoProjectsDir = old; }
  });
  it('does not call an unreadable record or unknown upload missing', () => {
    const result = makeVideoOverview(videos, { jobs: [{ piece: 'p/Shorts/s', status: 'unknown' }], complete: false }, () => ({ state: 'missing' }));
    expect(result.map((item) => item.link)).toEqual(['unknown', 'unknown']);
  });
  it('reads records from a fake folder and flags damaged records', () => {
    const result = readLinkRecords(path.join(tmp, 'jobs'));
    expect(result.jobs).toHaveLength(1); expect(result.complete).toBe(false);
  });
  it('does not pick an arbitrary video when several links exist', () => {
    const result = makeVideoOverview(videos, { jobs: [{ piece: 'p/Longform', status: 'done', videoId: '8rpVGGL5N10' }], complete: true }, () => ({ state: 'linked', id: 'KIcY9kSF1QY' }));
    expect(result[0].link).toBe('linked'); expect(result[0].videoId).toBeUndefined();
  });
  it('includes saved titles from different versions and skips missing metadata', () => {
    const old = config.videoProjectsDir; config.videoProjectsDir = tmp;
    try {
      fs.mkdirSync(path.join(tmp, 'piece/Packaging/V01'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'piece/Packaging/V01/YouTube.md'), 'Title:\nThat Might Be a Story\n\nDescription:\nWords\n');
      const video: Video = { name: 'piece', path: 'piece', pieces: [{ name: 'short', path: 'piece', kind: 'short', exports: [], packagingVersion: null, drafts: null, versions: [
        { name: 'V01', path: 'piece/Packaging/V01', covers: [], notes: null, docs: [{ name: 'YouTube.md', path: 'piece/Packaging/V01/YouTube.md', size: 1 }] },
        { name: 'V02', path: 'piece/Packaging/V02', covers: [], notes: null, docs: [{ name: 'YouTube.md', path: 'piece/Packaging/V02/YouTube.md', size: 1 }] },
      ] }] };
      expect(makeVideoOverview([{ projectId: 'piece', video }], { jobs: [], complete: true }, () => ({ state: 'missing' }))[0].titles).toEqual(['That Might Be a Story']);
    } finally { config.videoProjectsDir = old; }
  });
});
