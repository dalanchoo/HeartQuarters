export const YOUTUBE_SELECTION = '__youtube__';

/** Resolve which local version supplies the YouTube view and how the two sides are displayed. */
export function comparisonSelection(left: string, right: string, current: string) {
  const youtube = left === YOUTUBE_SELECTION || right === YOUTUBE_SELECTION;
  const localPath = left === YOUTUBE_SELECTION ? (right && right !== YOUTUBE_SELECTION ? right : current) : left;
  const display = left === YOUTUBE_SELECTION && !right ? 'youtube' : youtube && !!right && left !== right ? 'diff' : youtube && left === YOUTUBE_SELECTION ? 'youtube' : 'local';
  return { youtube, localPath, display, reverse: left === YOUTUBE_SELECTION && !!right && right !== YOUTUBE_SELECTION } as const;
}
