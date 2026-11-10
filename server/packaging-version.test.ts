import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { copyPackagingVersion } from './packaging-version';
let tmp: string; let old: string;
beforeEach(() => { tmp = makeTree({ 'Videos/piece/Packaging/V01/YouTube.md': 'original', 'Videos/piece/Packaging/V01/Covers/image.png': 'cover', 'Videos/piece/Packaging/V02/YouTube.md': 'existing', 'Videos/other/Packaging/V01/YouTube.md': 'other' }); old = config.videoProjectsDir; config.videoProjectsDir = path.join(tmp, 'Videos'); });
afterEach(() => { config.videoProjectsDir = old; removeTree(tmp); });
describe('copying a packaging version', () => {
  it('copies all files to a new version and leaves the source alone', async () => {
    const result = await copyPackagingVersion('piece', 'piece/Packaging/V01', 'V03 - Alternative');
    expect(result.path).toBe('piece/Packaging/V03 - Alternative');
    expect(fs.readFileSync(path.join(tmp, 'Videos', result.path, 'Covers', 'image.png'), 'utf8')).toBe('cover');
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/V01/YouTube.md'), 'utf8')).toBe('original');
  });
  it('refuses existing destinations and another video’s source', async () => {
    await expect(copyPackagingVersion('piece', 'piece/Packaging/V01', 'V02')).rejects.toThrow(/already exists/);
    await expect(copyPackagingVersion('piece', 'other/Packaging/V01', 'V03')).rejects.toThrow(/version in this video/);
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/V02/YouTube.md'), 'utf8')).toBe('existing');
  });
  it('refuses names that could escape or are not version names', async () => {
    await expect(copyPackagingVersion('piece', 'piece/Packaging/V01', '../escape')).rejects.toThrow();
    await expect(copyPackagingVersion('piece', 'piece/Packaging/V01', 'Final')).rejects.toThrow(/version name/);
  });
  it('does not follow a junction inside a version', async () => {
    const outside = path.join(tmp, 'Videos/other');
    fs.symlinkSync(outside, path.join(tmp, 'Videos/piece/Packaging/V01/shortcut'), 'junction');
    await expect(copyPackagingVersion('piece', 'piece/Packaging/V01', 'V03')).rejects.toThrow(/shortcut or junction/);
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V03'))).toBe(false);
  });
});
