import type { ExpressionPhoto } from './api';

export type Rating = NonNullable<ExpressionPhoto['rating']>;

/** "" means every photo. */
export type RatingFilter = '' | Rating | 'unrated' | 'not-disliked';

/** A short mark for tiles and menus. The viewer draws its own icons. */
export const RATING_MARK: Record<Rating, string> = { liked: '👍', meh: '🫳', disliked: '👎' };

export const RATING_FILTER_OPTIONS: { value: RatingFilter; label: string }[] = [
  { value: '', label: 'All Ratings' },
  { value: 'liked', label: `${RATING_MARK.liked} Liked` },
  { value: 'meh', label: `${RATING_MARK.meh} Meh` },
  { value: 'disliked', label: `${RATING_MARK.disliked} Disliked` },
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
 * The search box understands "liked", "meh" and "disliked" as ratings. They are checked as whole words, so "liked"
 * doesn't also find disliked photos. Returns the words that are left for the ordinary text search.
 */
export function ratingSearchWords(photo: Pick<ExpressionPhoto, 'rating'>, words: string[]): { matches: boolean; rest: string[] } {
  const rest: string[] = [];
  for (const word of words) {
    if (word === 'liked' || word === 'meh' || word === 'disliked') { if (photo.rating !== word) return { matches: false, rest }; }
    else rest.push(word);
  }
  return { matches: true, rest };
}
