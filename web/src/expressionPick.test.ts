import { describe, expect, it } from 'vitest';
import type { ExpressionPhoto } from './api';
import { categoriesIn, photosIn } from './expressionPick';

describe('categoriesIn', () => {
  it('finds the library categories a pick names, and ignores the description after them', () => {
    expect(categoriesIn('Positive > Relief, Composure > Calm (a tired, soft smile: as he is now)')).toEqual(['Positive/Relief', 'Composure/Calm']);
    expect(categoriesIn('Reactive > Surprise; Positive > Relief, Positive > Relief')).toEqual(['Reactive/Surprise', 'Positive/Relief']);
    expect(categoriesIn('a calm look')).toEqual([]);
  });
});

describe('photosIn', () => {
  const photo = (category: string, name: string): ExpressionPhoto => ({ path: `${category}/${name}`, name, category, tags: [] });
  it('takes photos in the category and its sub-categories only', () => {
    const photos = [photo('Positive/Relief', 'a.jpg'), photo('Positive/Relief/Deep', 'b.jpg'), photo('Positive/Reliefish', 'c.jpg'), photo('Composure/Calm', 'd.jpg')];
    expect(photosIn(photos, 'Positive/Relief').map((p) => p.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(photosIn(photos, 'positive/relief')).toHaveLength(2);
  });
});
