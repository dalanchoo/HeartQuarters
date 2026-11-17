export const YOUTUBE_SELECTION = '__youtube__';

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
