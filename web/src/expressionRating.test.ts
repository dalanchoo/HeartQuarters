import { describe, expect, it } from 'vitest';
import { matchesMarkFilter, matchesRatingFilter, ratingSearchWords } from './expressionRating';

const liked = { rating: 'liked' as const }; const meh = { rating: 'meh' as const }; const disliked = { rating: 'disliked' as const }; const none = {};
const all = [liked, meh, disliked, none];

describe('expression rating filters', () => {
  it('shows everything when no rating button is on', () => {
    expect(all.map(p => matchesRatingFilter(p, []))).toEqual([true, true, true, true]);
    expect(all.map(p => matchesRatingFilter(p, undefined))).toEqual([true, true, true, true]);
  });
  it('shows the photos whose rating is one of the buttons that are on', () => {
    expect(all.map(p => matchesRatingFilter(p, ['liked']))).toEqual([true, false, false, false]);
    expect(all.map(p => matchesRatingFilter(p, ['meh']))).toEqual([false, true, false, false]);
    expect(all.map(p => matchesRatingFilter(p, ['unrated']))).toEqual([false, false, false, true]);
    expect(all.map(p => matchesRatingFilter(p, ['liked', 'meh', 'unrated']))).toEqual([true, true, false, true]);
  });
  it('treats Star and Reference as separate filters that can both be on', () => {
    const starred = ['a', 'b']; const references = ['b', 'c'];
    expect(['a', 'b', 'c', 'd'].map(p => matchesMarkFilter(p, { starred: false, reference: false }, starred, references))).toEqual([true, true, true, true]);
    expect(['a', 'b', 'c', 'd'].map(p => matchesMarkFilter(p, { starred: true, reference: false }, starred, references))).toEqual([true, true, false, false]);
    expect(['a', 'b', 'c', 'd'].map(p => matchesMarkFilter(p, { starred: false, reference: true }, starred, references))).toEqual([false, true, true, false]);
    expect(['a', 'b', 'c', 'd'].map(p => matchesMarkFilter(p, { starred: true, reference: true }, starred, references))).toEqual([false, true, false, false]);
  });
  it('treats liked, meh and disliked in the search as whole-word ratings', () => {
    expect(ratingSearchWords(liked, ['liked', 'joy'])).toEqual({ matches: true, rest: ['joy'] });
    expect(ratingSearchWords(disliked, ['liked']).matches).toBe(false);
    expect(ratingSearchWords(none, ['disliked']).matches).toBe(false);
    expect(ratingSearchWords(none, ['joy'])).toEqual({ matches: true, rest: ['joy'] });
    expect(ratingSearchWords(meh, ['meh']).matches).toBe(true);
    expect(ratingSearchWords(none, ['meh']).matches).toBe(false);
  });
});
