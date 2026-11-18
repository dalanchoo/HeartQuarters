// The shared file checks: shortcuts and junctions inside the folders can't be used to reach anything outside them.
// Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { copyNewFile, makeFolder, moveFile, readable, readText, writable, writeFile } from './safe-files';

let tmp: string;
let old: string;
const P = (...p: string[]) => path.join(tmp, 'Videos', ...p);
beforeEach(() => {
  tmp = makeTree({ 'Videos/piece/Packaging/V01/YouTube.md': 'mine', 'Videos/other/notes.txt': 'other video', 'Outside/secret.txt': 'secret' });
  old = config.videoProjectsDir;
  config.videoProjectsDir = path.join(tmp, 'Videos');
  // A junction inside a version that points outside the Video Projects folder, and one that points inside it.
  fs.symlinkSync(path.join(tmp, 'Outside'), P('piece', 'Packaging', 'V01', 'Backups'), 'junction');
  fs.symlinkSync(P('other'), P('piece', 'Linked'), 'junction');
});
afterEach(() => {
  config.videoProjectsDir = old;
  removeTree(tmp);
});

describe('reading', () => {
  it('allows files inside, and refuses anything that really ends up outside', () => {
    expect(readText(P('piece', 'Packaging', 'V01', 'YouTube.md'))).toBe('mine');
    expect(() => readText(P('piece', 'Packaging', 'V01', 'Backups', 'secret.txt'))).toThrow(/outside/);
    expect(() => readable(path.join(tmp, 'Outside', 'secret.txt'))).toThrow(/outside/);
    expect(readText(P('piece', 'Linked', 'notes.txt'))).toBe('other video'); // a link that stays inside may be read
  });
});

describe('writing, moving and creating', () => {
  it('refuses to go through any shortcut or junction, even one that stays inside', () => {
    expect(() => writeFile(P('piece', 'Packaging', 'V01', 'Backups', 'x.png'), 'x')).toThrow();
    expect(() => moveFile(P('piece', 'Packaging', 'V01', 'YouTube.md'), P('piece', 'Packaging', 'V01', 'Backups', 'YouTube.md'))).toThrow();
    expect(() => makeFolder(P('piece', 'Linked', 'New'))).toThrow(/shortcut or junction/);
    expect(() => writable(P('piece', 'Linked', 'notes.txt'))).toThrow(/shortcut or junction/);
    expect(fs.readdirSync(path.join(tmp, 'Outside'))).toEqual(['secret.txt']);
    expect(fs.existsSync(P('piece', 'Packaging', 'V01', 'YouTube.md'))).toBe(true);
  });
  it('works for ordinary folders and files', () => {
    const folder = makeFolder(P('piece', 'Packaging', 'V01', 'Thumbnail', 'Source'));
    writeFile(path.join(folder, 'a.txt'), 'a');
    copyNewFile(path.join(folder, 'a.txt'), path.join(folder, 'b.txt'));
    copyNewFile(P('piece', 'Packaging', 'V01', 'YouTube.md'), path.join(folder, 'b.txt')); // never over an existing file
    moveFile(path.join(folder, 'a.txt'), path.join(folder, 'c.txt'));
    expect(fs.readdirSync(folder).sort()).toEqual(['b.txt', 'c.txt']);
    expect(fs.readFileSync(path.join(folder, 'b.txt'), 'utf8')).toBe('a');
  });
  it('refuses a file that is itself a link to somewhere else', () => {
    fs.symlinkSync(path.join(tmp, 'Outside', 'secret.txt'), P('piece', 'Packaging', 'V01', 'Notes.md'), 'file');
    expect(() => writeFile(P('piece', 'Packaging', 'V01', 'Notes.md'), 'x')).toThrow();
    expect(fs.readFileSync(path.join(tmp, 'Outside', 'secret.txt'), 'utf8')).toBe('secret');
  });
});
