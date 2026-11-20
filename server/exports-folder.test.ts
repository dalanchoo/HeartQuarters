import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { ensureExportsFolder } from './exports-folder';
import { makeTree, removeTree } from './testing';

let tmp: string;
let old: string;
beforeEach(() => { tmp = makeTree({ '020 - Video/Longform/Video.txt': 'x' }); old = config.videoProjectsDir; config.videoProjectsDir = tmp; });
afterEach(() => { config.videoProjectsDir = old; removeTree(tmp); });

describe('ensureExportsFolder', () => {
  it("makes the piece's Exports folder when it's missing, and keeps one that's there", () => {
    const full = ensureExportsFolder('020 - Video/Longform');
    expect(full).toBe(path.join(tmp, '020 - Video', 'Longform', 'Exports'));
    expect(fs.statSync(full).isDirectory()).toBe(true);
    fs.writeFileSync(path.join(full, 'video.mp4'), 'v');
    expect(ensureExportsFolder('020 - Video/Longform')).toBe(full);
    expect(fs.readdirSync(full)).toEqual(['video.mp4']);
  });
  it('refuses paths that leave the Video Projects folder or are empty', () => {
    expect(() => ensureExportsFolder('../outside')).toThrow();
    expect(() => ensureExportsFolder('')).toThrow(/Choose a video/);
    expect(() => ensureExportsFolder('020 - Video/../..')).toThrow();
  });
});
