import type { ExpressionPhoto } from './api';

/** "" means every photo. */
export type RatingFilter = '' | 'liked' | 'disliked' | 'unrated' | 'not-disliked';

export const RATING_FILTER_OPTIONS: { value: RatingFilter; label: string }[] = [
  { value: '', label: 'All Ratings' },
  { value: 'liked', label: '👍 Liked' },
  { value: 'disliked', label: '👎 Disliked' },
  { value: 'unrated', label: 'Not Rated' },
  { value: 'not-disliked', label: 'Everything Except Disliked' },
];

export function matchesRatingFilter(photo: Pick<ExpressionPhoto, 'rating'>, filter: RatingFilter | undefined): boolean {
  if (!filter) return true;
  if (filter === 'unrated') return !photo.rating;
  if (filter === 'not-disliked') return photo.rating !== 'disliked';
  return photo.rating === filter;
}

/**
 * The search box understands "liked" and "disliked" as ratings. They are checked as whole words, so "liked" doesn't
 * also find disliked photos. Returns the words that are left for the ordinary text search.
 */
export function ratingSearchWords(photo: Pick<ExpressionPhoto, 'rating'>, words: string[]): { matches: boolean; rest: string[] } {
  const rest: string[] = [];
  for (const word of words) {
    if (word === 'liked' || word === 'disliked') { if (photo.rating !== word) return { matches: false, rest }; }
    else rest.push(word);
  }
  return { matches: true, rest };
}
