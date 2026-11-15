import { describe, expect, it } from 'vitest';
import { matchingDestinations, readReferences, saveReferences, suggestedCategories } from './expressionPlanning';
import type { ExpressionCategory } from './api';
describe('expression planning', () => {
  it('remembers distinct reference paths and handles damaged data', () => {
    let value = ''; const storage = { getItem: () => value, setItem: (_key: string, v: string) => { value = v; } };
    saveReferences(storage, ['a.jpg', 'a.jpg', 'b.jpg']); expect(readReferences(storage)).toEqual(['a.jpg', 'b.jpg']);
    value = '{'; expect(readReferences(storage)).toEqual([]);
  });
  it('suggests sparse useful leaf categories first', () => {
    const category = (path: string, name: string, parent: string, ownCount: number): ExpressionCategory => ({ path, name, parent, ownCount, totalCount: ownCount, reference: null, definition: null });
    expect(suggestedCategories([category('x/Thinking', 'Thinking', 'x', 2), category('x/Curiosity', 'Curiosity', 'x', 0), category('x/Joy', 'Joy', 'x', 6)]).map((c) => c.name)).toEqual(['Curiosity', 'Thinking']);
  });
  it('finds destinations by any part of the name or path, ignoring case', () => {
    const category = (path: string): ExpressionCategory => ({ path, name: path.split('/').at(-1)!, parent: '', ownCount: 0, totalCount: 0, reference: null, definition: null });
    const categories = ['', 'Composure/Determined', 'Attitude/Determination', 'Positive/Joy'].map(category);
    expect(matchingDestinations(categories, 'Attitude/Determination', 'DeT').map(c => c.path)).toEqual(['Composure/Determined']);
    expect(matchingDestinations(categories, '', 'positive').map(c => c.path)).toEqual(['Positive/Joy']);
    expect(matchingDestinations(categories, '', 'not found')).toEqual([]);
  });
});
