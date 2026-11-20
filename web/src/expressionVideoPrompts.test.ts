import { describe, expect, it } from 'vitest';
import type { ExpressionIndex } from './api';
import { buildLackingVideoPrompt, findLibraryGaps } from './expressionVideoPrompts';

const SAMPLE_INDEX: ExpressionIndex = {
  rootDir: 'D:/Expressions',
  categories: [
    { path: '', name: 'Expressions', parent: null, definition: null, reference: null, ownCount: 0, totalCount: 5 },
    { path: 'Positive', name: 'Positive', parent: '', definition: null, reference: null, ownCount: 0, totalCount: 3 },
    { path: 'Positive/Relief', name: 'Relief', parent: 'Positive', definition: 'Just came through something hard.', reference: null, ownCount: 0, totalCount: 0 },
    { path: 'Positive/Warmth', name: 'Warmth', parent: 'Positive', definition: 'Gentle, welcoming smile.', reference: null, ownCount: 3, totalCount: 3 },
    { path: 'Reactive', name: 'Reactive', parent: '', definition: null, reference: null, ownCount: 0, totalCount: 1 },
    { path: 'Reactive/Concern', name: 'Concern', parent: 'Reactive', definition: 'Furrowed brow, attentive.', reference: null, ownCount: 1, totalCount: 1 },
  ],
  photos: [
    { path: 'Positive/Warmth/w1.jpg', name: 'w1.jpg', category: 'Positive/Warmth', tags: [{ tag: 'RightFacing', confidence: 95, confirmed: true }] },
    { path: 'Positive/Warmth/w2.jpg', name: 'w2.jpg', category: 'Positive/Warmth', tags: [{ tag: 'LeftFacing', confidence: 95, confirmed: true }] },
    { path: 'Positive/Warmth/w3.jpg', name: 'w3.jpg', category: 'Positive/Warmth', tags: [] },
    { path: 'Reactive/Concern/c1.jpg', name: 'c1.jpg', category: 'Reactive/Concern', tags: [{ tag: 'LeftFacing', confidence: 90, confirmed: true }] },
  ],
};

describe('expressionVideoPrompts', () => {
  it('finds leaf categories sorted by fewest photos and fewest camera-right shots', () => {
    const gaps = findLibraryGaps(SAMPLE_INDEX);
    expect(gaps.map((g) => g.path)).toEqual(['Positive/Relief', 'Reactive/Concern', 'Positive/Warmth']);
    expect(gaps[0]).toMatchObject({ count: 0, rightCount: 0, leftCount: 0 });
    expect(gaps[1]).toMatchObject({ count: 1, rightCount: 0, leftCount: 1 });
    expect(gaps[2]).toMatchObject({ count: 3, rightCount: 1, leftCount: 1 });
  });

  it('builds one prompt from the emptiest folders, leaving out hand gestures', () => {
    const index: ExpressionIndex = { ...SAMPLE_INDEX, categories: [...SAMPLE_INDEX.categories,
      { path: 'Gestural', name: 'Gestural', parent: '', definition: null, reference: null, ownCount: 0, totalCount: 0 },
      { path: 'Gestural/Shrugging', name: 'Shrugging', parent: 'Gestural', definition: null, reference: null, ownCount: 0, totalCount: 0 }] };
    const prompt = buildLackingVideoPrompt(index, () => 0)!;
    expect(prompt.expressions).toEqual(['Positive > Relief', 'Reactive > Concern', 'Positive > Warmth']);
    expect(prompt.prompt).toContain('1. Positive > Relief — Just came through something hard.');
    expect(prompt.prompt).toContain('solid matte neutral medium-grey studio backdrop');
    expect(prompt.prompt).toContain('looking toward camera right');
  });
  it('picks a different mix when the random choice differs, and gives nothing for an empty library', () => {
    expect(buildLackingVideoPrompt(SAMPLE_INDEX, () => 0.99, 1)!.expressions).toEqual(['Positive > Warmth']);
    expect(buildLackingVideoPrompt({ ...SAMPLE_INDEX, categories: [SAMPLE_INDEX.categories[0]], photos: [] })).toBeNull();
  });
});
