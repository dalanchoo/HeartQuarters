// Saving files all at once. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSafely } from './files';
import { makeTree, removeTree } from './testing';

let tmp: string;
beforeEach(() => {
  tmp = makeTree({ 'YouTube.md': 'old', 'YouTube.md.tmp': 'someone else\'s file', 'folder/': '' });
});
afterEach(() => removeTree(tmp));

describe('writeFileSafely', () => {
  it('replaces the file and leaves no temporary file behind', () => {
    writeFileSafely(path.join(tmp, 'YouTube.md'), 'new');
    expect(fs.readFileSync(path.join(tmp, 'YouTube.md'), 'utf8')).toBe('new');
    expect(fs.readdirSync(tmp).sort()).toEqual(['YouTube.md', 'YouTube.md.tmp', 'folder']);
  });

  it("never touches a file that happens to have the old temporary file's name", () => {
    writeFileSafely(path.join(tmp, 'YouTube.md'), 'new');
    expect(fs.readFileSync(path.join(tmp, 'YouTube.md.tmp'), 'utf8')).toBe("someone else's file");
  });

  it('creates a file that is not there yet', () => {
    writeFileSafely(path.join(tmp, 'Plan.json'), '{}');
    expect(fs.readFileSync(path.join(tmp, 'Plan.json'), 'utf8')).toBe('{}');
  });

  it('cleans up its temporary file if the swap fails, and leaves what was there', () => {
    expect(() => writeFileSafely(path.join(tmp, 'folder'), 'x')).toThrow();
    expect(fs.readdirSync(tmp).filter((n) => n.endsWith('.hq-tmp'))).toEqual([]);
    expect(fs.statSync(path.join(tmp, 'folder')).isDirectory()).toBe(true);
  });

  it('retries transient EPERM/EBUSY errors when swapping on Windows', () => {
    const realRename = fs.renameSync;
    let calls = 0;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      return realRename(from, to);
    });
    try {
      writeFileSafely(path.join(tmp, 'YouTube.md'), 'retried');
      expect(calls).toBe(2);
      expect(fs.readFileSync(path.join(tmp, 'YouTube.md'), 'utf8')).toBe('retried');
    } finally {
      spy.mockRestore();
    }
  });
});
