import { describe, expect, it } from 'vitest';
import { filterCategoryOptions, generationCategories, generationCategoryOnSwitch, nextCategoryIndex, readReferences, readyCandidateCount, saveReferences, suggestedCategories } from './expressionPlanning';
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
  it('filters dropdown choices by any part of their label', () => {
    const options = [{ value: 'a', label: 'Composure > Determined' }, { value: 'b', label: 'Positive > Warmth' }, { value: 'c', label: 'Attitude > Determination' }];
    expect(filterCategoryOptions(options, 'DeT').map(o => o.value)).toEqual(['a', 'c']);
    expect(filterCategoryOptions(options, 'positive').map(o => o.value)).toEqual(['b']);
    expect(filterCategoryOptions(options, '')).toEqual(options);
  });
  it('skips disabled category choices when navigating', () => {
    const options = [{ value: 'a', label: 'Empty', disabled: true }, { value: 'b', label: 'Available' }, { value: 'c', label: 'Empty too', disabled: true }, { value: 'd', label: 'Also available' }];
    expect(nextCategoryIndex(options, -1, 1)).toBe(1);
    expect(nextCategoryIndex(options, 1, 1)).toBe(3);
    expect(nextCategoryIndex(options, 3, -1)).toBe(1);
    expect(nextCategoryIndex(options, 3, 1)).toBe(3);
  });
  it('offers leaf categories, uses the current library category when suitable, and counts ready candidates', () => {
    const category = (path: string, parent: string | null): ExpressionCategory => ({ path, name: path.split('/').at(-1)!, parent, ownCount: 0, totalCount: 0, reference: null, definition: null });
    const categories = [category('', null), category('Positive', ''), category('Positive/Joy', 'Positive'), category('Positive/Warmth', 'Positive')];
    expect(generationCategories(categories).map(c => c.path)).toEqual(['Positive/Joy', 'Positive/Warmth']);
    expect(generationCategoryOnSwitch(categories, 'Positive/Joy', 'Positive/Warmth')).toBe('Positive/Joy');
    expect(generationCategoryOnSwitch(categories, 'Positive', 'Positive/Warmth')).toBe('Positive/Warmth');
    expect(readyCandidateCount([{ state: 'ready' }, { state: 'working' }, { state: 'failed' }, { state: 'ready' }])).toBe(2);
  });
});
