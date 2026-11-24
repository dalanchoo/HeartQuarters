import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { copyVersionThumbnail, decodeThumbnail, fetchYoutubeThumbnail, firstWorkingThumbnail, savePackagingThumbnail } from './thumbnail-files';

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
  it('copies a thumbnail between versions without replacing existing images', () => {
    fs.mkdirSync(path.join(tmp, 'Videos/piece/Packaging/V02'));
    const source = savePackagingThumbnail('piece', 'piece/Packaging/V01', png);
    const copy = copyVersionThumbnail('piece', 'piece/Packaging/V01', 'piece/Packaging/V02');
    expect(fs.readFileSync(path.join(tmp, 'Videos', copy.path))).toEqual(fs.readFileSync(path.join(tmp, 'Videos', source.path)));
    expect(() => copyVersionThumbnail('piece', 'piece/Packaging/V01', 'piece/Packaging/V02')).toThrow(/already has a thumbnail/);
    expect(() => copyVersionThumbnail('piece', 'other/Packaging/V01', 'piece/Packaging/V02')).toThrow();
  });
  it('deletes an inherited Source folder when copying a thumbnail from a draft (Dxx)', () => {
    fs.mkdirSync(path.join(tmp, 'Videos/piece/Packaging/D01'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'Videos/piece/Packaging/V02/Thumbnail/Source'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Videos/piece/Packaging/V02/Thumbnail/Source/old.psd'), 'psd');
    savePackagingThumbnail('piece', 'piece/Packaging/D01', png);
    const oldThumb = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
    const current = savePackagingThumbnail('piece', 'piece/Packaging/V02', oldThumb);
    const st = fs.statSync(path.join(tmp, 'Videos', current.path));
    copyVersionThumbnail('piece', 'piece/Packaging/D01', 'piece/Packaging/V02', { size: st.size, modified: Math.round(st.mtimeMs) });
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V02/Thumbnail/Source'))).toBe(false);
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/V02/Thumbnail/Thumbnail.png'))).toEqual(png);
  });
  it('backs up and replaces a thumbnail only when the displayed target still matches', () => {
    fs.mkdirSync(path.join(tmp, 'Videos/piece/Packaging/V02'));
    savePackagingThumbnail('piece', 'piece/Packaging/V01', png);
    const old = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]);
    const current = savePackagingThumbnail('piece', 'piece/Packaging/V02', old);
    const currentPath = path.join(tmp, 'Videos', current.path); const st = fs.statSync(currentPath);
    expect(() => copyVersionThumbnail('piece', 'piece/Packaging/V01', 'piece/Packaging/V02', { size: st.size + 1, modified: Math.round(st.mtimeMs) })).toThrow(/changed/);
    expect(() => copyVersionThumbnail('piece', 'piece/Packaging/V01', 'piece/Packaging/V02', { size: st.size, modified: Math.round(st.mtimeMs) }, { size: 0, modified: 0 })).toThrow(/source thumbnail changed/);
    const copied = copyVersionThumbnail('piece', 'piece/Packaging/V01', 'piece/Packaging/V02', { size: st.size, modified: Math.round(st.mtimeMs) });
    expect(fs.readFileSync(path.join(tmp, 'Videos', copied.path))).toEqual(png);
    const backups = path.join(tmp, 'Videos/piece/Packaging/V02/Thumbnail/Backups');
    expect(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]))).toEqual(old);
    expect(fs.existsSync(currentPath)).toBe(false);
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
  it('skips sizes YouTube lists but answers "not found" for, and other hosts', async () => {
    const fake = vi.fn().mockImplementation(async (url: URL) => new Response(null, { status: url.pathname.includes('qhd') ? 404 : 200 }));
    vi.stubGlobal('fetch', fake);
    try {
      const urls = ['https://evil.example.com/vi/x/uhd.jpg', 'https://i.ytimg.com/vi/x/qhddefault.jpg', 'https://i.ytimg.com/vi/x/maxresdefault.jpg'];
      // With a changing number, so YouTube's servers send the current image, not a copy kept from before.
      expect(await firstWorkingThumbnail(urls, 123)).toBe('https://i.ytimg.com/vi/x/maxresdefault.jpg?hq=123');
      expect(fake).toHaveBeenCalledTimes(2); // the other host is never asked
      expect(await firstWorkingThumbnail([])).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
  it('refuses a Thumbnail junction even if its target is inside the projects folder', () => {
    const target = path.join(tmp, 'Videos/other/Packaging/V01');
    fs.symlinkSync(target, path.join(tmp, 'Videos/piece/Packaging/V01/Thumbnail'), 'junction');
    expect(() => savePackagingThumbnail('piece', 'piece/Packaging/V01', png)).toThrow(/shortcut/);
    expect(fs.existsSync(path.join(target, 'Thumbnail.png'))).toBe(false);
  });
});
