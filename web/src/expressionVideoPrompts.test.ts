import { describe, expect, it } from 'vitest';
import type { ExpressionIndex } from './api';
import type { ExpressionShot } from '../../server/expression-shot-list';
import { buildPromptsFromGaps, buildPromptsFromShotList, findLibraryGaps } from './expressionVideoPrompts';

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

  const shot = (id: string, category: string, done: boolean): ExpressionShot => ({ id, category, title: '', description: '', framing: [], pose: [], morphology: [], alsoFits: [], sources: [], addedAt: '', done });
  it('uses a shot title and description in the clip list', () => {
    const [prompt] = buildPromptsFromShotList([{ ...shot('1', 'Composure/Calm', false), title: 'Settled', description: 'A slight smile.' }], 'right', 3);
    expect(prompt.prompt).toContain('1. Composure > Calm: Settled — A slight smile.');
  });
  it('builds batched prompts from unchecked shot list items with neutral backdrop, studio lighting, and gaze', () => {
    const shots: ExpressionShot[] = [
      shot('1', 'Already/Done', true),
      shot('2', 'Positive/Relief', false),
      shot('3', 'Composure/Calm', false),
      shot('4', 'Reactive/Curiosity', false),
      shot('5', 'Cognitive/Thinking', false),
      shot('6', 'Empathy/Compassion', false),
    ];
    const prompts = buildPromptsFromShotList(shots, 'right', 4);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].expressions).toEqual(['Positive > Relief', 'Composure > Calm', 'Reactive > Curiosity', 'Cognitive > Thinking']);
    expect(prompts[0].prompt).toContain('solid matte neutral medium-grey studio backdrop');
    expect(prompts[0].prompt).toContain('soft, even studio key lighting');
    expect(prompts[0].prompt).toContain('looking toward camera right');
    expect(prompts[1].expressions).toEqual(['Empathy > Compassion']);
  });

  it('builds prompts for library gaps up to the selected max photo threshold', () => {
    const gaps = findLibraryGaps(SAMPLE_INDEX);
    const prompts = buildPromptsFromGaps(gaps, 'both', 4, 1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].expressions).toEqual(['Positive > Relief', 'Reactive > Concern']);
    expect(prompts[0].prompt).toContain('camera right');
    expect(prompts[0].prompt).toContain('camera left');
  });
});
