import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { readSubtitle, subtitleFiles } from './youtube-captions';

let tmp: string; let oldRoot: string;
beforeEach(() => { tmp = makeTree({ 'Videos/piece/Subtitles/test.vtt': 'WEBVTT', 'Videos/piece/Subtitles/notes.txt': 'notes', 'Videos/other.vtt': 'other' }); oldRoot = config.videoProjectsDir; config.videoProjectsDir = path.join(tmp, 'Videos'); });
afterEach(() => { config.videoProjectsDir = oldRoot; removeTree(tmp); });
describe('YouTube subtitles', () => {
  it('finds timed files in the piece’s Subtitles folder only', () => {
    expect(subtitleFiles('piece')).toEqual([{ name: 'test.vtt', path: 'piece/Subtitles/test.vtt' }]);
    expect(readSubtitle('piece', 'piece/Subtitles/test.vtt').toString()).toBe('WEBVTT');
    expect(() => readSubtitle('piece', 'other.vtt')).toThrow(/Subtitles/);
    expect(() => readSubtitle('piece', 'piece/Subtitles/notes.txt')).toThrow(/Subtitles/);
    expect(subtitleFiles('missing')).toEqual([]);
  });
});
