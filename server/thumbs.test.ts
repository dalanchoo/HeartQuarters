// Finishing a preview: file errors become a refused preview, never an error that stops the server. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from './testing';
import { finishPreview } from './thumbs';

let tmp: string;
beforeEach(() => {
  tmp = makeTree({ 'cache/made.tmp.jpg': 'jpeg', 'cache/blocked.jpg/keep.txt': 'a folder sits where the preview would go' });
});
afterEach(() => removeTree(tmp));

describe('finishing a preview', () => {
  it('moves a finished preview into place', () => {
    const out = path.join(tmp, 'cache', 'made.jpg');
    expect(finishPreview(0, path.join(tmp, 'cache', 'made.tmp.jpg'), out, '')).toBe(out);
    expect(fs.readFileSync(out, 'utf8')).toBe('jpeg');
  });
  it('throws, and cleans up, when the preview cannot be saved', () => {
    const made = path.join(tmp, 'cache', 'made.tmp.jpg');
    expect(() => finishPreview(0, made, path.join(tmp, 'cache', 'blocked.jpg'), '')).toThrow(/Couldn't save the preview/);
    expect(fs.existsSync(made)).toBe(false);
  });
  it('explains an FFmpeg failure', () => {
    expect(() => finishPreview(1, path.join(tmp, 'cache', 'none.tmp.jpg'), path.join(tmp, 'cache', 'x.jpg'), 'bad input')).toThrow(/bad input/);
  });
});
