import { describe, expect, it } from 'vitest';
import { expressionCategoryNames, reviewExpressionFolder } from './expressionFolderReview';
import type { ExpressionCategory, ExpressionPhoto } from './api';

const tag = (tag: string, confidence: number | null, confirmed = false) => ({ tag, confidence, confirmed });
const photo = (tags: ExpressionPhoto['tags']): ExpressionPhoto => ({ path: 'Positive/Warmth/Warmth_001.jpg', name: 'Warmth_001', category: 'Positive/Warmth', tags });
const category = (name: string): ExpressionCategory => ({ name, path: `Example/${name}`, parent: 'Example', ownCount: 0, totalCount: 0, reference: null, definition: null });
const names = expressionCategoryNames(['Warmth', 'Hostility', 'Intimidating'].map(category));

describe('expression folder review', () => {
  it('flags different guesses when the folder is absent, including low or unknown confidence', () => {
    expect(reviewExpressionFolder(photo([tag('Hostility', 10), tag('Intimidating', null)]), names)?.alternatives.map(t => t.tag)).toEqual(['Hostility', 'Intimidating']);
  });
  it('flags a stronger or confirmed alternative and keeps the folder score for context', () => {
    const result = reviewExpressionFolder(photo([tag('Warmth', 60), tag('Hostility', 80), tag('Intimidating', 30)]), names);
    expect(result?.folderTag?.confidence).toBe(60); expect(result?.alternatives.map(t => t.tag)).toEqual(['Hostility']);
    expect(reviewExpressionFolder(photo([tag('Warmth', 90), tag('Hostility', null, true)]), names)?.alternatives[0].tag).toBe('Hostility');
  });
  it('does not flag a confirmed folder label, weaker guesses, missing assessments or non-expression tags', () => {
    expect(reviewExpressionFolder(photo([tag('Warmth', null, true), tag('Hostility', 99)]), names)).toBeNull();
    expect(reviewExpressionFolder(photo([tag('Warmth', 80), tag('Hostility', 30)]), names)).toBeNull();
    expect(reviewExpressionFolder(photo([tag('EyesClosed', 99), tag('Unknown', 99)]), names)).toBeNull();
    expect(reviewExpressionFolder(photo([]), names)).toBeNull();
  });
});
