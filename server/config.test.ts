// safeResolve is what stops the app reading files outside your allowed folders.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config, safeResolve } from './config';
import { makeTree, removeTree } from './testing';

let tmp: string;
let allowed: string;
let original: string;

beforeAll(() => {
  tmp = makeTree({
    'Allowed/Project/file.txt': 'hello',
    'Allowed2/secret.txt': 'next door',
    'Outside/secret.txt': 'private',
  });
  allowed = path.join(tmp, 'Allowed');
  original = config.videoProjectsDir;
  config.videoProjectsDir = allowed;
  // A Windows junction (shortcut-folder) inside the allowed folder that points outside it.
  fs.symlinkSync(path.join(tmp, 'Outside'), path.join(allowed, 'Sneaky'), 'junction');
});

afterAll(() => {
  config.videoProjectsDir = original;
  removeTree(tmp);
});

describe('safeResolve', () => {
  it('allows files inside the folder', () => {
    expect(safeResolve('projects', 'Project/file.txt')).toBe(path.join(allowed, 'Project', 'file.txt'));
  });

  it('allows the folder itself', () => {
    expect(safeResolve('projects', '')).toBe(allowed);
  });

  it('allows files that do not exist yet', () => {
    expect(safeResolve('projects', 'Project/new.txt')).toBe(path.join(allowed, 'Project', 'new.txt'));
  });

  it('blocks climbing out with ..', () => {
    expect(() => safeResolve('projects', '../Outside/secret.txt')).toThrow(/outside/);
    expect(() => safeResolve('projects', 'Project/../../Outside/secret.txt')).toThrow(/outside/);
  });

  it('blocks absolute paths', () => {
    expect(() => safeResolve('projects', 'C:\\Windows\\win.ini')).toThrow(/outside/);
    expect(() => safeResolve('projects', path.join(tmp, 'Outside', 'secret.txt'))).toThrow(/outside/);
  });

  it('blocks a neighbouring folder whose name starts the same', () => {
    expect(() => safeResolve('projects', '../Allowed2/secret.txt')).toThrow(/outside/);
  });

  it('blocks a junction that points outside the folder', () => {
    expect(() => safeResolve('projects', 'Sneaky/secret.txt')).toThrow(/outside/);
    expect(() => safeResolve('projects', 'Sneaky')).toThrow(/outside/);
    expect(() => safeResolve('projects', 'Sneaky/not-there-yet.txt')).toThrow(/outside/);
  });

  it('ignores upper/lower case differences, like Windows', () => {
    expect(() => safeResolve('projects', 'PROJECT/file.txt')).not.toThrow();
  });
});
