import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from './testing';
import { makeVideoOverview, readLinkRecords } from './video-overview';
import type { Video } from './projects';

let tmp: string;
beforeEach(() => { tmp = makeTree({ 'jobs/111.json': JSON.stringify({ piece: 'p/Shorts/s', status: 'done', videoId: '8rpVGGL5N10' }), 'jobs/222.json': 'broken' }); });
afterEach(() => removeTree(tmp));
const videos: { projectId: string; video: Video }[] = [{ projectId: 'p', video: { name: 'p', path: 'p', pieces: [
  { name: 'Longform', kind: 'longform', path: 'p/Longform', exports: [], packagingVersion: 'V01', versions: [{ name: 'Legacy', path: 'legacy', docs: [], covers: [] }, { name: 'V01', path: 'v1', docs: [], covers: [{ name: 'cover', path: 'cover', size: 1 }] }] },
  { name: 's', kind: 'short', path: 'p/Shorts/s', exports: [], packagingVersion: null, versions: [] },
] } }];
describe('video overview', () => {
  it('reports saved longform links, known Short uploads, and local packaging separately', () => {
    const result = makeVideoOverview(videos, { jobs: [{ piece: 'p/Shorts/s', status: 'done', videoId: '8rpVGGL5N10' }], complete: true }, () => ({ state: 'linked', id: '8rpVGGL5N10' }));
    expect(result[0]).toMatchObject({ link: 'linked', legacy: true, localThumbnail: true });
    expect(result[1]).toMatchObject({ link: 'linked', legacy: false, localThumbnail: false });
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
});
