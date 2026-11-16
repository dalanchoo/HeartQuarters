import { describe, expect, it } from 'vitest';
import { filterCategoryOptions, filterSelectablePhotos, openPhotoSelection, generationCategories, generationCategoryOnSwitch, nextCategoryIndex, readReferences, readyCandidateCount, saveReferences, suggestedCategories } from './expressionPlanning';
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
  it('filters selectable photos by stars, category and readable attribute names', () => {
    const photos = [
      { path: 'a', name: 'One', category: 'Positive/Warmth', tags: [{ tag: 'EyesClosed', confidence: 88, confirmed: false }] },
      { path: 'b', name: 'Two', category: 'Positive/Joy', tags: [{ tag: 'LookOffCamera', confidence: 90, confirmed: true }] },
      { path: 'c', name: 'Three', category: 'Other', tags: [] },
    ];
    expect(filterSelectablePhotos(photos, ['a'], { scope: 'starred', category: '*', query: '' }).map(p => p.path)).toEqual(['a']);
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: 'Positive', query: 'eyes closed' }).map(p => p.path)).toEqual(['a']);
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: '*', query: 'looking off camera' }).map(p => p.path)).toEqual(['b']);
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: 'Pos', query: '' })).toEqual([]);
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: 'Positive', query: '', attributes: ['lookoffcamera', ''] }).map(p => p.path)).toEqual(['b']);
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: '*', query: '', attributes: ['LookOffCamera', 'EyesClosed'] })).toEqual([]);
  });
  it('applies each text filter to its own group and combines them', () => {
    const photos = [
      { path: 'a', name: 'Frontal', category: 'Positive/Warmth', tags: [{ tag: 'Frontal', confidence: 80, confirmed: false }, { tag: 'LookOffCamera', confidence: 80, confirmed: false }, { tag: 'EyesClosed', confidence: 80, confirmed: false }, { tag: 'Joy', confidence: 80, confirmed: false }] },
      { path: 'b', name: 'Other', category: 'Positive/Joy', tags: [{ tag: 'EyesClosed', confidence: 80, confirmed: false }] },
    ];
    const textFilters = { categoryText: 'warm', framingText: 'fron', poseText: 'off camera', morphologyText: 'eyes closed' };
    const filter = { scope: 'all' as const, category: '*', query: '', textFilters };
    expect(filterSelectablePhotos(photos, [], filter).map(p => p.path)).toEqual(['a']);
    expect(filterSelectablePhotos(photos, [], { ...filter, textFilters: { ...textFilters, framingText: 'Joy' } })).toEqual([]);
    expect(filterSelectablePhotos(photos, [], { ...filter, textFilters: { ...textFilters, morphologyText: 'Frontal' } })).toEqual([]);
    expect(filterSelectablePhotos(photos, [], { ...filter, category: 'Positive', includeSub: false })).toEqual([]);
  });
  it('keeps the selected photo open if updated tags remove it from filtered results', () => {
    const first = { path: 'a', name: 'First', category: 'C', tags: [] };
    const second = { path: 'b', name: 'Second', category: 'C', tags: [] };
    expect(openPhotoSelection([first, second], [first, second], 'a')).toEqual({ photo: first, index: 0 });
    expect(openPhotoSelection([first, second], [second], 'a')).toEqual({ photo: first, index: -1 });
    expect(openPhotoSelection([second], [second], 'a')).toEqual({ photo: undefined, index: -1 });
  });
  it('does not match disconfirmed tags in attribute filters', () => {
    const photos = [{ path: 'a', name: 'Photo', category: 'C', tags: [{ tag: 'EyesClosed', confidence: 90, confirmed: false, disconfirmed: true }] }];
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: '*', query: '', attributes: ['EyesClosed'] })).toEqual([]);
    expect(filterSelectablePhotos(photos, [], { scope: 'all', category: '*', query: '', textFilters: { categoryText: '', framingText: '', poseText: '', morphologyText: 'eyes closed' } })).toEqual([]);
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
