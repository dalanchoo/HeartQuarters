// Saving packaging files. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { savePackagingText, saveVersionNotes } from './metadata';
import { makeTree, removeTree } from './testing';

const FILE = '777 - Test/Packaging/V01/YouTube.md';
let tmp: string;
let saved: string;
const onDisk = (rel: string) => fs.readFileSync(path.join(tmp, 'Videos', rel), 'utf8');

beforeEach(() => {
  tmp = makeTree({
    [`Videos/${FILE}`]: 'old',
    'Videos/777 - Test/notes.md': 'notes',
    'Videos/777 - Test/Packaging/V01/Cover.png': 'picture',
    'Outside/Packaging/secret.md': 'secret',
  });
  saved = config.videoProjectsDir;
  config.videoProjectsDir = path.join(tmp, 'Videos');
});

afterEach(() => {
  config.videoProjectsDir = saved;
  removeTree(tmp);
});

describe('saveVersionNotes', () => {
  const NOTES = '777 - Test/Packaging/V01/Notes.md';

  it("makes Notes.md when the version has none, then saves changes to it", () => {
    saveVersionNotes('777 - Test/Packaging/V01', 'NoImages', '');
    expect(onDisk(NOTES)).toBe('NoImages');
    saveVersionNotes('777 - Test/Packaging/V01', 'NoImages, tried a darker look', 'NoImages');
    expect(onDisk(NOTES)).toBe('NoImages, tried a darker look');
  });

  it('refuses if the notes changed since the page read them', () => {
    saveVersionNotes('777 - Test/Packaging/V01', 'mine', '');
    expect(() => saveVersionNotes('777 - Test/Packaging/V01', 'new', '')).toThrow(/changed/);
    expect(onDisk(NOTES)).toBe('mine');
  });

  it('only writes into a version folder inside Packaging, and nowhere outside the video projects', () => {
    expect(() => saveVersionNotes('777 - Test', 'x', '')).toThrow(/version folder/);
    expect(() => saveVersionNotes('777 - Test/Packaging', 'x', '')).toThrow(/version folder/);
    expect(() => saveVersionNotes('777 - Test/Packaging/V02', 'x', '')).toThrow(/version folder/);
    expect(() => saveVersionNotes('../Outside/Packaging', 'x', '')).toThrow();
    expect(onDisk('777 - Test/notes.md')).toBe('notes');
    expect(fs.existsSync(path.join(tmp, 'Videos/777 - Test/Packaging/V02'))).toBe(false);
  });
});

describe('savePackagingText', () => {
  it('saves the new text and leaves no temporary file', () => {
    savePackagingText(FILE, 'new', 'old');
    expect(onDisk(FILE)).toBe('new');
    expect(fs.readdirSync(path.join(tmp, 'Videos', path.dirname(FILE)))).toEqual(['Cover.png', 'YouTube.md']);
  });

  it("refuses if the file changed since the page read it, and doesn't touch it", () => {
    expect(() => savePackagingText(FILE, 'new', 'something else')).toThrow(/changed/);
    expect(onDisk(FILE)).toBe('old');
  });

  it('accepts a file that starts with the invisible byte order mark, which browsers drop', () => {
    fs.writeFileSync(path.join(tmp, 'Videos', FILE), '﻿old');
    savePackagingText(FILE, 'new', 'old');
    expect(onDisk(FILE)).toBe('new');
  });

  it('only writes .md files inside a Packaging folder', () => {
    expect(() => savePackagingText('777 - Test/notes.md', 'x', 'notes')).toThrow(/packaging file/);
    expect(() => savePackagingText('777 - Test/Packaging/V01/Cover.png', 'x', 'picture')).toThrow(/packaging file/);
    expect(onDisk('777 - Test/notes.md')).toBe('notes');
  });

  it('refuses paths outside the video projects', () => {
    expect(() => savePackagingText('../Outside/Packaging/secret.md', 'x', 'secret')).toThrow();
    expect(fs.readFileSync(path.join(tmp, 'Outside/Packaging/secret.md'), 'utf8')).toBe('secret');
  });

  it('refuses a missing file and missing text', () => {
    expect(() => savePackagingText('777 - Test/Packaging/V01/TikTok.md', 'x', 'y')).toThrow(/no longer exists/);
    expect(() => savePackagingText(FILE, undefined, 'old')).toThrow(/Nothing to save/);
  });
});
