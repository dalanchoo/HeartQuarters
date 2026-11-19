import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config.js';
import {
  GENERATED_VIDEOS_FOLDER,
  generatedVideoFile,
  listGeneratedVideos,
  renameGeneratedVideo,
  saveGeneratedVideo,
  trashGeneratedVideo,
} from './expression-videos.js';
import { makeTree, removeTree } from './testing.js';

let tmp: string;
let oldExpr: string;
let oldTrash: string;

beforeEach(() => {
  tmp = makeTree({
    'Expressions/Positive/Warmth/w1.jpg': 'img',
  });
  oldExpr = config.expressionsDir;
  oldTrash = config.trashDir;
  config.expressionsDir = path.join(tmp, 'Expressions');
  config.trashDir = path.join(tmp, 'Trash');
});

afterEach(() => {
  config.expressionsDir = oldExpr;
  config.trashDir = oldTrash;
  removeTree(tmp);
});

describe('generated expression videos', () => {
  it('saves, deduplicates, lists, renames, serves, and trashes videos safely', () => {
    const first = saveGeneratedVideo('veo_take.mp4', Buffer.from('video-1'));
    const second = saveGeneratedVideo('veo_take.mp4', Buffer.from('video-2'));
    expect(first.name).toBe('veo_take.mp4');
    expect(second.name).toBe('veo_take (2).mp4');
    expect(listGeneratedVideos().map((v) => v.name).sort()).toEqual(['veo_take (2).mp4', 'veo_take.mp4']);

    const renamed = renameGeneratedVideo('veo_take.mp4', 'Camera Right Relief');
    expect(renamed.name).toBe('Camera Right Relief.mp4');
    expect(fs.existsSync(generatedVideoFile('Camera Right Relief.mp4'))).toBe(true);

    const trashed = trashGeneratedVideo('Camera Right Relief.mp4');
    expect(fs.existsSync(path.join(trashed.trashPath, 'Camera Right Relief.mp4'))).toBe(true);
    expect(listGeneratedVideos().map((v) => v.name)).toEqual(['veo_take (2).mp4']);
  });

  it('rejects traversal, invalid extensions, and overwriting existing videos on rename', () => {
    saveGeneratedVideo('a.mp4', Buffer.from('1'));
    saveGeneratedVideo('b.mp4', Buffer.from('2'));
    expect(() => saveGeneratedVideo('evil.exe', Buffer.from('x'))).toThrow(/MP4, MOV, and WebM/);
    expect(() => renameGeneratedVideo('a.mp4', 'b.mp4')).toThrow(/already exists/);
    expect(() => generatedVideoFile('../Positive/Warmth/w1.jpg')).toThrow();
    expect(() => trashGeneratedVideo(`../${GENERATED_VIDEOS_FOLDER}/a.mp4`)).toThrow();
  });
});
