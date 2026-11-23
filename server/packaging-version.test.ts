import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { copyPackagingVersion, createFirstPackagingVersion, nextVersionName, notYetOnYoutube, recordYoutubePackaging, trashPackagingVersion } from './packaging-version';
let tmp: string; let old: string; let oldTrash: string;
beforeEach(() => { tmp = makeTree({ 'Videos/piece/Packaging/V01/YouTube.md': 'original', 'Videos/piece/Packaging/V01/Covers/image.png': 'cover', 'Videos/piece/Packaging/V02/YouTube.md': 'existing', 'Videos/other/Packaging/V01/YouTube.md': 'other' }); old = config.videoProjectsDir; oldTrash = config.trashDir; config.videoProjectsDir = path.join(tmp, 'Videos'); config.trashDir = path.join(tmp, 'Trash'); });
afterEach(() => { config.videoProjectsDir = old; config.trashDir = oldTrash; removeTree(tmp); });
describe('copying a packaging version', () => {
  it('copies all files to the next version number and leaves the source alone', async () => {
    expect(nextVersionName('piece')).toBe('V03');
    const result = await copyPackagingVersion('piece', 'piece/Packaging/V01');
    expect(result.path).toBe('piece/Packaging/V03');
    expect(fs.readFileSync(path.join(tmp, 'Videos', result.path, 'Covers', 'image.png'), 'utf8')).toBe('cover');
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/V01/YouTube.md'), 'utf8')).toBe('original');
  });
  it("says the copy isn't on YouTube yet, and leaves the source's notes alone", async () => {
    fs.writeFileSync(path.join(tmp, 'Videos/piece/Packaging/V01/Notes.md'), 'Made by hand.\r\n\r\nOn YouTube: from 2026-11-05.\r\n');
    const result = await copyPackagingVersion('piece', 'piece/Packaging/V01');
    expect(fs.readFileSync(path.join(tmp, 'Videos', result.path, 'Notes.md'), 'utf8')).toBe('Made by hand.\r\n\r\nOn YouTube: not yet.\r\n');
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/V01/Notes.md'), 'utf8')).toContain('from 2026-11-05');
  });
  it('adds the On YouTube line when the notes had none, or there were no notes', async () => {
    expect(notYetOnYoutube('Some notes.\n')).toBe('Some notes.\n\nOn YouTube: not yet.\n');
    expect(notYetOnYoutube('')).toBe('On YouTube: not yet.\n');
    const result = await copyPackagingVersion('piece', 'piece/Packaging/V01');
    expect(fs.readFileSync(path.join(tmp, 'Videos', result.path, 'Notes.md'), 'utf8')).toBe('On YouTube: not yet.\n');
  });
  it('keeps earlier dates and John’s notes, and starts clones with no inherited dates', async () => {
    const version = 'piece/Packaging/V01';
    const file = path.join(tmp, 'Videos', version, 'Notes.md');
    fs.writeFileSync(file, 'Made by hand.\r\n\r\nOn YouTube: not yet.\r\n');
    recordYoutubePackaging('piece', version, ['Title'], new Date('2026-11-23T03:00:00Z'));
    recordYoutubePackaging('piece', version, ['Thumbnail'], new Date('2026-11-23T20:00:00Z'));
    const result = await copyPackagingVersion('piece', version);
    expect(fs.readFileSync(file, 'utf8')).toBe('Made by hand.\r\n\r\nOn YouTube: 2026-11-22 (sent Title).\r\nOn YouTube: 2026-11-23 (sent Thumbnail).\r\n');
    expect(fs.readFileSync(path.join(tmp, 'Videos', result.path, 'Notes.md'), 'utf8')).toBe('Made by hand.\r\n\r\nOn YouTube: not yet.\r\n');
  });
  it("refuses another video's source and leaves the other versions alone", async () => {
    await expect(copyPackagingVersion('piece', 'other/Packaging/V01')).rejects.toThrow(/version in this video/);
    expect(fs.readFileSync(path.join(tmp, 'Videos/piece/Packaging/V02/YouTube.md'), 'utf8')).toBe('existing');
  });
  it('does not follow a junction inside a version', async () => {
    const outside = path.join(tmp, 'Videos/other');
    fs.symlinkSync(outside, path.join(tmp, 'Videos/piece/Packaging/V01/shortcut'), 'junction');
    await expect(copyPackagingVersion('piece', 'piece/Packaging/V01')).rejects.toThrow(/shortcut or junction/);
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V03'))).toBe(false);
  });
});
describe('creating the first packaging version', () => {
  it('creates V01 once and never replaces an existing version', () => {
    fs.mkdirSync(path.join(tmp, 'Videos/new-piece'));
    const result = createFirstPackagingVersion('new-piece');
    expect(result.path).toBe('new-piece/Packaging/V01');
    expect(fs.readFileSync(path.join(tmp, 'Videos', result.path, 'YouTube.md'), 'utf8')).toContain('Title:');
    expect(() => createFirstPackagingVersion('new-piece')).toThrow(/already exists/);
  });
});
describe('deleting a packaging version', () => {
  it("refuses another video's version", () => {
    expect(() => trashPackagingVersion('piece', 'other/Packaging/V01')).toThrow(/version in this video/);
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V01/YouTube.md'))).toBe(true);
  });
  it('moves only the selected version into a recoverable trash folder', () => {
    const result = trashPackagingVersion('piece', 'piece/Packaging/V01');
    expect(fs.readFileSync(path.join(result.trashPath, 'YouTube.md'), 'utf8')).toBe('original');
    expect(fs.existsSync(path.join(tmp, 'Videos/piece/Packaging/V02/YouTube.md'))).toBe(true);
  });
});
