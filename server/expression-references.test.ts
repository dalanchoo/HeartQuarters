import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from './testing';
import fs from 'node:fs';
import { readExpressionReferences, readLikenessReferences, saveExpressionReferences, saveLikenessReferences } from './expression-references';
let tmp: string; let previous: string | undefined;
beforeEach(() => { tmp = makeTree({}); previous = process.env.HQ_EXPRESSION_REFS_FILE; process.env.HQ_EXPRESSION_REFS_FILE = path.join(tmp, 'data', 'refs.json'); });
afterEach(() => { if (previous === undefined) delete process.env.HQ_EXPRESSION_REFS_FILE; else process.env.HQ_EXPRESSION_REFS_FILE = previous; removeTree(tmp); });
describe('expression reference storage', () => {
  it('keeps choices across reads and does not replace existing choices during migration', () => {
    expect(readExpressionReferences().initialized).toBe(false);
    saveExpressionReferences(['Neutral/photo.jpg'], true);
    expect(saveExpressionReferences(['Other/photo.jpg'], true).paths).toEqual(['Neutral/photo.jpg']);
    saveExpressionReferences(['Neutral/photo.jpg', 'Other/photo.jpg'], false);
    expect(readExpressionReferences().paths).toEqual(['Neutral/photo.jpg', 'Other/photo.jpg']);
  });
  it('rejects unsafe paths without replacing saved choices', () => {
    saveExpressionReferences(['Neutral/photo.jpg'], true);
    expect(() => saveExpressionReferences(['../outside.jpg'], false)).toThrow();
    expect(readExpressionReferences().paths).toEqual(['Neutral/photo.jpg']);
  });
  it('starts Reference Photos as a copy of the stars once, then keeps the two lists apart', () => {
    saveExpressionReferences(['Neutral/a.jpg', 'Neutral/b.jpg'], true);
    expect(readLikenessReferences()).toEqual(['Neutral/a.jpg', 'Neutral/b.jpg']);
    expect(fs.existsSync(path.join(tmp, 'data', 'likeness-references.json'))).toBe(true);
    saveLikenessReferences(['Neutral/b.jpg']);
    saveExpressionReferences(['Neutral/a.jpg', 'Neutral/b.jpg', 'Neutral/c.jpg'], false);
    expect(readLikenessReferences()).toEqual(['Neutral/b.jpg']);
    expect(readExpressionReferences().paths).toEqual(['Neutral/a.jpg', 'Neutral/b.jpg', 'Neutral/c.jpg']);
    expect(() => saveLikenessReferences(['../outside.jpg'])).toThrow();
    expect(readLikenessReferences()).toEqual(['Neutral/b.jpg']);
  });
});
