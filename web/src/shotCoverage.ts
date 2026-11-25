import { isAiExpression } from '../../server/expression-origin';
import type { ExpressionPhoto } from './api';

// How well the library already covers an expression folder, for the Shot List (John, 2026-11-25): only photos John
// rated Liked or Meh count. Disliked photos don't, and unrated ones are left out until he rates them.
export interface Coverage { realLiked: number; realMeh: number; aiLiked: number; aiMeh: number }
/** Liked photos at which a folder counts as well covered. A guide, not a limit: it can still get more. */
export const WELL_COVERED = 5;

/** Counts the Liked and Meh photos in `folder` and its sub-folders, real and AI apart. */
export function folderCoverage(photos: ExpressionPhoto[], folder: string): Coverage {
  const coverage: Coverage = { realLiked: 0, realMeh: 0, aiLiked: 0, aiMeh: 0 };
  if (!folder) return coverage;
  for (const photo of photos) {
    if (photo.category !== folder && !photo.category.startsWith(`${folder}/`)) continue;
    if (photo.rating !== 'liked' && photo.rating !== 'meh') continue;
    const ai = isAiExpression(photo);
    if (photo.rating === 'liked') { if (ai) coverage.aiLiked++; else coverage.realLiked++; }
    else if (ai) coverage.aiMeh++; else coverage.realMeh++;
  }
  return coverage;
}

export const likedCount = (c: Coverage) => c.realLiked + c.aiLiked;
export const isWellCovered = (c: Coverage) => likedCount(c) >= WELL_COVERED;

/** Neediest first: fewest Liked, then fewest Meh, then by name. Looks not yet sorted into a folder go last. */
export function byNeed(folders: string[], coverage: (folder: string) => Coverage): string[] {
  return [...folders].sort((a, b) => {
    if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
    const ca = coverage(a); const cb = coverage(b);
    return likedCount(ca) - likedCount(cb) || (ca.realMeh + ca.aiMeh) - (cb.realMeh + cb.aiMeh) || a.localeCompare(b);
  });
}

/** "Liked 2 real, 1 AI · Meh 1 real, 0 AI" */
export function coverageText(c: Coverage): string {
  return `Liked ${c.realLiked} real, ${c.aiLiked} AI · Meh ${c.realMeh} real, ${c.aiMeh} AI`;
}
