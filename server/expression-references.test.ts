import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from './testing';
import { readExpressionReferences, saveExpressionReferences } from './expression-references';
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
});
