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
  it('saves Thumbnail/Thumbnail.png or .jpg by the image format, and never replaces one', () => {
    const saved = savePackagingThumbnail('piece', 'piece/Packaging/V01', png);
    expect(saved.path).toBe('piece/Packaging/V01/Thumbnail/Thumbnail.png');
    expect(fs.readFileSync(path.join(tmp, 'Videos', saved.path))).toEqual(png);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', jpeg)).toThrow(/already has Thumbnail\.png/);
    expect(fs.readFileSync(path.join(tmp, 'Videos', saved.path))).toEqual(png);
    fs.mkdirSync(path.join(tmp, 'Videos/piece/Packaging/V02'));
    expect(savePackagingThumbnail('piece', 'piece/Packaging/V02', jpeg).path).toBe('piece/Packaging/V02/Thumbnail/Thumbnail.jpg');
  });
  it('rejects other projects and invalid images', () => {
    expect(() => savePackagingThumbnail('piece', 'other/Packaging/V01', png)).toThrow();
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01/..', png)).toThrow();
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', Buffer.from('not an image'))).toThrow(/PNG or JPEG/);
    expect(() => decodeThumbnail('not base64!')).toThrow();
  });
  it('never fetches thumbnail URLs from other hosts', async () => {
    await expect(fetchYoutubeThumbnail('http://127.0.0.1:4321/')).rejects.toThrow(/unsupported/);
    await expect(fetchYoutubeThumbnail('https://i.ytimg.com.example.com/x')).rejects.toThrow(/unsupported/);
  });
  it('refuses a Thumbnail junction even if its target is inside the projects folder', () => {
    const target = path.join(tmp, 'Videos/other/Packaging/V01');
    fs.symlinkSync(target, path.join(tmp, 'Videos/piece/Packaging/V01/Thumbnail'), 'junction');
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', png)).toThrow(/shortcut/);
    expect(fs.existsSync(path.join(target, 'Thumbnail.png'))).toBe(false);
  });
});
