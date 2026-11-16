import { describe, expect, it } from 'vitest';
import { isAiExpression, matchesExpressionOrigin } from './expression-origin';

describe('expression photo origin', () => {
  it('recognizes both numbered and older AI filenames', () => {
    expect(isAiExpression({ name: 'Confidence_AI_001', tags: [] })).toBe(true);
    expect(isAiExpression({ name: 'Confidence_AI_13ab45cd', tags: [] })).toBe(true);
  });
  it('recognizes confirmed AI tags but does not assume an unconfirmed guess is true', () => {
    expect(isAiExpression({ name: 'Confidence_001', tags: [{ tag: 'AIGenerated', confirmed: true }] })).toBe(true);
    expect(isAiExpression({ name: 'Confidence_001', tags: [{ tag: 'AIGenerated', confirmed: false }] })).toBe(false);
    expect(isAiExpression({ name: 'Confidence_001', tags: [] })).toBe(false);
  });
  it('filters AI and unmarked photos separately', () => {
    const ai = { name: 'Confidence_AI_001', tags: [] };
    const unmarked = { name: 'Confidence_001', tags: [] };
    expect(matchesExpressionOrigin(ai, 'all')).toBe(true);
    expect(matchesExpressionOrigin(ai, 'ai')).toBe(true);
    expect(matchesExpressionOrigin(ai, 'real')).toBe(false);
    expect(matchesExpressionOrigin(unmarked, 'real')).toBe(true);
    expect(matchesExpressionOrigin(unmarked, 'ai')).toBe(false);
  });
});
