import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { copyPackagingVersion, renamePackagingVersion, trashPackagingVersion } from './packaging-version';
let tmp: string; let old: string; let oldTrash: string;
beforeEach(() => { tmp = makeTree({ 'Videos/piece/Packaging/V01/YouTube.md': 'original', 'Videos/piece/Packaging/V01/Covers/image.png': 'cover', 'Videos/piece/Packaging/V02/YouTube.md': 'existing', 'Videos/other/Packaging/V01/YouTube.md': 'other' }); old = config.videoProjectsDir; oldTrash = config.trashDir; config.videoProjectsDir = path.join(tmp, 'Videos'); config.trashDir = path.join(tmp, 'Trash'); });
afterEach(() => { config.videoProjectsDir = old; config.trashDir = oldTrash; removeTree(tmp); });
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
describe('managing a packaging version', () => {
  it('renames a version without changing its files', () => {
    expect(renamePackagingVersion('piece', 'piece/Packaging/V01', 'Legacy').name).toBe('Legacy');
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/Legacy/YouTube.md'), 'utf8')).toBe('original');
  });
  it('rejects collisions, invalid names, and another video’s version', () => {
    expect(() => renamePackagingVersion('piece', 'piece/Packaging/V01', 'V02')).toThrow(/already exists/);
    expect(() => renamePackagingVersion('piece', 'piece/Packaging/V01', '../bad')).toThrow();
    expect(() => trashPackagingVersion('piece', 'other/Packaging/V01')).toThrow(/version in this video/);
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V01/YouTube.md'))).toBe(true);
  });
  it('moves only the selected version into a recoverable trash folder', () => {
    const result = trashPackagingVersion('piece', 'piece/Packaging/V01');
    expect(fs.readFileSync(path.join(result.trashPath, 'YouTube.md'), 'utf8')).toBe('original');
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V02/YouTube.md'))).toBe(true);
  });
});
