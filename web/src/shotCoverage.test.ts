import { describe, expect, it } from 'vitest';
import type { ExpressionPhoto } from './api';
import { byNeed, coverageText, folderCoverage, isWellCovered } from './shotCoverage';

const photo = (category: string, rating: ExpressionPhoto['rating'], name = 'IMG_1.jpg', aiTag = false): ExpressionPhoto =>
  ({ path: `${category}/${name}`, name, category, ...(rating ? { rating } : {}), tags: aiTag ? [{ tag: 'AIGenerated', confirmed: true }] : [] }) as ExpressionPhoto;

describe('how well the library covers a folder', () => {
  const photos = [
    photo('Composure/Calm', 'liked'), photo('Composure/Calm', 'liked', 'Calm_AI_1.png'), photo('Composure/Calm/Soft', 'meh', 'x.jpg', true),
    photo('Composure/Calm', 'disliked'), photo('Composure/Calm', undefined), photo('Composure/Calmness', 'liked'),
  ];

  it('counts Liked and Meh, real and AI apart, including sub-folders; leaves out Disliked and unrated', () => {
    const calm = folderCoverage(photos, 'Composure/Calm');
    expect(calm).toEqual({ realLiked: 1, realMeh: 0, aiLiked: 1, aiMeh: 1 });
    expect(coverageText(calm)).toBe('Liked 1 real, 1 AI · Meh 0 real, 1 AI');
    expect(folderCoverage(photos, '')).toEqual({ realLiked: 0, realMeh: 0, aiLiked: 0, aiMeh: 0 });
  });

  it('is well covered from 5 Liked photos', () => {
    const five = [1, 2, 3, 4, 5].map(n => photo('Positive/Warmth', 'liked', `${n}.jpg`, n > 3));
    expect(isWellCovered(folderCoverage(five, 'Positive/Warmth'))).toBe(true);
    expect(isWellCovered(folderCoverage(five.slice(1), 'Positive/Warmth'))).toBe(false);
  });

  it('puts the neediest folders first and unsorted looks last', () => {
    const library = [photo('A/One', 'liked'), photo('A/One', 'liked', '2.jpg'), photo('B/Two', 'meh'), photo('C/Three', 'liked')];
    expect(byNeed(['', 'A/One', 'B/Two', 'C/Three', 'D/Four'], f => folderCoverage(library, f))).toEqual(['D/Four', 'B/Two', 'C/Three', 'A/One', '']);
  });
});
