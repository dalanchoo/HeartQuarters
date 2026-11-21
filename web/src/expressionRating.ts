import type { ExpressionPhoto } from './api';

export type Rating = NonNullable<ExpressionPhoto['rating']>;
/** One of the rating buttons in a filter: the three ratings, or "no rating yet". */
export type RatingChoice = Rating | 'unrated';

/** A photo passes when no rating button is on, or when its rating is one of those that are on. */
export function matchesRatingFilter(photo: Pick<ExpressionPhoto, 'rating'>, choices: readonly RatingChoice[] | undefined): boolean {
  if (!choices?.length) return true;
  return choices.includes(photo.rating ?? 'unrated');
}

/** The Star and Reference filter buttons; each one that is on must match. Both off shows every photo. */
export function matchesMarkFilter(path: string, filter: { starred: boolean; reference: boolean }, starred: readonly string[], references: readonly string[]): boolean {
  return (!filter.starred || starred.includes(path)) && (!filter.reference || references.includes(path));
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
