import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { buildExpressionIndex } from './expressions';
import { isAiExpression } from './expression-origin';
import { markExpressionAi } from './mark-expression-ai';
import { makeTree, removeTree } from './testing';

let tmp: string; let previous: string;
beforeEach(() => {
  tmp = makeTree({ 'Confidence/Confidence_001.png': 'photo', 'Confidence/Confidence_001.txt': 'Confidence, N/A, CONFIRMED\r\n', 'Confidence/Confidence_002.png': 'photo' });
  previous = config.expressionsDir; config.expressionsDir = tmp;
});
afterEach(() => { config.expressionsDir = previous; removeTree(tmp); });
describe('mark expression photo as AI', () => {
  it('preserves existing tags and makes the photo identifiable', () => {
    markExpressionAi('Confidence/Confidence_001.png');
    const text = fs.readFileSync(path.join(tmp, 'Confidence/Confidence_001.txt'), 'utf8');
    expect(text).toBe('Confidence, N/A, CONFIRMED\r\n==========\r\nAIGenerated, N/A, CONFIRMED\r\n');
    expect(isAiExpression(buildExpressionIndex().photos.find(p => p.name === 'Confidence_001')!)).toBe(true);
    markExpressionAi('Confidence/Confidence_001.png');
    expect(fs.readFileSync(path.join(tmp, 'Confidence/Confidence_001.txt'), 'utf8')).toBe(text);
  });
  it('creates a tag file when needed and refuses paths outside the library', () => {
    markExpressionAi('Confidence/Confidence_002.png');
    expect(fs.readFileSync(path.join(tmp, 'Confidence/Confidence_002.txt'), 'utf8')).toBe('AIGenerated, N/A, CONFIRMED\n');
    expect(() => markExpressionAi('../other.png')).toThrow();
  });
});
