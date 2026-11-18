export const YOUTUBE_SELECTION = '__youtube__';
/** The packaging Generate Packaging made for the chosen pair: first in the menus, like a V00. */
export const DRAFT_SELECTION = '__draft__';

export interface ComparisonChoices { left: string; right: string }

/** Preserve choices across version/lock changes, falling back only if a version no longer exists. */
export function availableComparisonChoices(choices: ComparisonChoices, current: string, versions: string[]): ComparisonChoices {
  const available = (value: string) => value === YOUTUBE_SELECTION || versions.includes(value);
  return { left: available(choices.left) ? choices.left : current, right: choices.right === '' || available(choices.right) ? choices.right : YOUTUBE_SELECTION };
}

/** Only the unlocked version may receive a copy, even if another version is current. */
export function localCopyTarget(left: string, right: string, unlocked: string | null) {
  if (!unlocked || left === right) return null;
  if (left === unlocked && right) return { target: left, source: right };
  if (right === unlocked && left) return { target: right, source: left };
  return null;
}

/** Resolve which local version supplies the YouTube view and how the two sides are displayed. */
export function comparisonSelection(left: string, right: string, current: string) {
  const youtube = left === YOUTUBE_SELECTION || right === YOUTUBE_SELECTION;
  const localPath = left === YOUTUBE_SELECTION ? (right && right !== YOUTUBE_SELECTION ? right : current) : left;
  const display = left === YOUTUBE_SELECTION && !right ? 'youtube' : youtube && !!right && left !== right ? 'diff' : youtube && left === YOUTUBE_SELECTION ? 'youtube' : 'local';
  return { youtube, localPath, display, reverse: left === YOUTUBE_SELECTION && !!right && right !== YOUTUBE_SELECTION } as const;
}

/** Every choice in order: Draft (when there is one), the versions oldest first, then YouTube. */
export function choiceOrder(versions: string[], hasDraft: boolean): string[] {
  return [...(hasDraft ? [DRAFT_SELECTION] : []), ...versions, YOUTUBE_SELECTION];
}

/**
 * What may go on the right of `left`: only choices later in the order, so the left is always the earlier one. Draft
 * can't be compared with YouTube, because it must go into a version before it can be sent there.
 */
export function rightChoices(left: string, order: string[]): string[] {
  const later = order.slice(order.indexOf(left) + 1);
  return left === DRAFT_SELECTION ? later.filter((c) => c !== YOUTUBE_SELECTION) : later;
}

/**
 * The two choices made valid: anything no longer there falls back (left to the current version), and a right choice
 * that isn't later than the left becomes the next one that is, or none.
 */
export function orderedChoices(choices: ComparisonChoices, current: string, order: string[]): ComparisonChoices {
  const left = order.includes(choices.left) ? choices.left : order.includes(current) ? current : order[0];
  const allowed = rightChoices(left, order);
  if (choices.right === '' || allowed.includes(choices.right)) return { left, right: choices.right };
  const wanted = order.indexOf(choices.right);
  const next = allowed.find((c) => order.indexOf(c) > wanted) ?? allowed[0] ?? '';
  return { left, right: next };
}
