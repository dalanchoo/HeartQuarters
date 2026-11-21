import { describe, expect, it } from 'vitest';
import { matchesRatingFilter, ratingSearchWords } from './expressionRating';

const liked = { rating: 'liked' as const }; const disliked = { rating: 'disliked' as const }; const none = {};

describe('expression rating filters', () => {
  it('filters by rating', () => {
    expect([liked, disliked, none].map(p => matchesRatingFilter(p, ''))).toEqual([true, true, true]);
    expect([liked, disliked, none].map(p => matchesRatingFilter(p, 'liked'))).toEqual([true, false, false]);
    expect([liked, disliked, none].map(p => matchesRatingFilter(p, 'disliked'))).toEqual([false, true, false]);
    expect([liked, disliked, none].map(p => matchesRatingFilter(p, 'unrated'))).toEqual([false, false, true]);
    expect([liked, disliked, none].map(p => matchesRatingFilter(p, 'not-disliked'))).toEqual([true, false, true]);
  });
  it('treats liked and disliked in the search as whole-word ratings', () => {
    expect(ratingSearchWords(liked, ['liked', 'joy'])).toEqual({ matches: true, rest: ['joy'] });
    expect(ratingSearchWords(disliked, ['liked']).matches).toBe(false);
    expect(ratingSearchWords(none, ['disliked']).matches).toBe(false);
    expect(ratingSearchWords(none, ['joy'])).toEqual({ matches: true, rest: ['joy'] });
  });
});
