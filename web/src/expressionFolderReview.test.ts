import { describe, expect, it } from 'vitest';
import { expressionCategoryNames, reviewExpressionFolder } from './expressionFolderReview';
import type { ExpressionCategory, ExpressionPhoto } from './api';

const tag = (tag: string, confidence: number | null, confirmed = false) => ({ tag, confidence, confirmed });
const photo = (tags: ExpressionPhoto['tags']): ExpressionPhoto => ({ path: 'Positive/Warmth/Warmth_001.jpg', name: 'Warmth_001', category: 'Positive/Warmth', tags });
const category = (name: string): ExpressionCategory => ({ name, path: `Example/${name}`, parent: 'Example', ownCount: 0, totalCount: 0, reference: null, definition: null });
const names = expressionCategoryNames(['Warmth', 'Hostility', 'Intimidating'].map(category));

describe('expression folder review', () => {
  it('shows different guesses only when the folder expression is missing', () => {
    expect(reviewExpressionFolder(photo([tag('Hostility', 10), tag('Intimidating', null)]), names, 'missing')?.alternatives.map(t => t.tag)).toEqual(['Hostility', 'Intimidating']);
    expect(reviewExpressionFolder(photo([tag('Warmth', 60), tag('Hostility', 90)]), names, 'missing')).toBeNull();
    expect(reviewExpressionFolder(photo([tag('EyesClosed', 99)]), names, 'missing')).toBeNull();
  });
  it('shows higher scores only when the folder has a comparable score', () => {
    const result = reviewExpressionFolder(photo([tag('Warmth', 60), tag('Hostility', 80), tag('Intimidating', 30)]), names, 'higher');
    expect(result?.folderTag?.confidence).toBe(60); expect(result?.alternatives.map(t => t.tag)).toEqual(['Hostility']);
    expect(reviewExpressionFolder(photo([tag('Warmth', 80), tag('Hostility', 80)]), names, 'higher')).toBeNull();
    expect(reviewExpressionFolder(photo([tag('Warmth', null, true), tag('Hostility', 99)]), names, 'higher')).toBeNull();
    expect(reviewExpressionFolder(photo([tag('Hostility', 99)]), names, 'higher')).toBeNull();
    expect(reviewExpressionFolder(photo([tag('Warmth', 60, true), tag('Hostility', 80)]), names, 'higher')).not.toBeNull();
  });
});
