import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { decodeThumbnail, fetchYoutubeThumbnail, savePackagingThumbnail } from './thumbnail-files';

let tmp: string; let old: string;
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
beforeEach(() => { tmp = makeTree({ 'Videos/piece/Packaging/V01/YouTube.md': 'original', 'Videos/other/Packaging/V01/YouTube.md': 'other' }); old = config.videoProjectsDir; config.videoProjectsDir = path.join(tmp, 'Videos'); });
afterEach(() => { config.videoProjectsDir = old; removeTree(tmp); });
describe('saving thumbnails', () => {
  it('adds a thumbnail and refuses to replace it', () => {
    const saved = savePackagingThumbnail('piece', 'piece/Packaging/V01', 'Cover.png', png);
    expect(fs.readFileSync(path.join(tmp, 'Videos', saved.path))).toEqual(png);
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', 'Cover.png', png)).toThrow(/already exists/);
  });
  it('rejects other projects, escaped filenames, and invalid or mismatched images', () => {
    expect(() => savePackagingThumbnail('piece', 'other/Packaging/V01', 'x.png', png)).toThrow();
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', '../x.png', png)).toThrow();
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', 'x.jpg', png)).toThrow(/format/);
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', 'x.png', Buffer.from('not an image'))).toThrow(/PNG or JPEG/);
    expect(() => decodeThumbnail('not base64!')).toThrow();
  });
  it('never fetches thumbnail URLs from other hosts', async () => {
    await expect(fetchYoutubeThumbnail('http://127.0.0.1:4321/')).rejects.toThrow(/unsupported/);
    await expect(fetchYoutubeThumbnail('https://i.ytimg.com.example.com/x')).rejects.toThrow(/unsupported/);
  });
});
