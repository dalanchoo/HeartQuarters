import type { YoutubeVideoSettings } from '../../server/youtube-video';
import type { CommentCheck } from '../../server/youtube-comment';

export interface YoutubeChecks { issues: string[]; unknown: string[] }
/**
 * captions: the tracks, null if YouTube couldn't say, or undefined when they weren't checked (the list-wide check skips
 * them). comment: whether the channel's own comment is posted (null if YouTube couldn't say, undefined if not checked).
 */
export function checkYoutubeVideo(video: YoutubeVideoSettings, captions: { kind: string }[] | null | undefined, short: boolean, comment?: CommentCheck | null): YoutubeChecks {
  const issues: string[] = []; const unknown: string[] = [];
  if (!video.title.trim()) issues.push('title is empty');
  if (!video.description.trim()) issues.push('description is empty');
  if (!video.tags.some((tag) => tag.trim())) issues.push('no tags');
  if (video.customThumbnail === false) issues.push('no custom thumbnail');
  else if (video.customThumbnail == null) unknown.push('custom thumbnail');
  if (captions === null) unknown.push('captions');
  else if (captions !== undefined && !captions.some((track) => track.kind.toLowerCase() !== 'asr')) issues.push(captions.length ? 'only automatic captions' : 'no captions');
  if (comment === null) unknown.push('comment posted');
  else if (comment && !comment.posted && !comment.disabled) issues.push('no comment posted');
  if (!short && (video.description.match(/^\s*(?:\d+:)?\d{1,2}:\d{2}(?:\s|\s*[-–])/gm) ?? []).length < 3) issues.push('chapters may be missing');
  return { issues, unknown };
}

/** Whether `posted` is the same comment as `wanted`, ignoring spacing and line breaks. */
export function sameComment(posted: string, wanted: string): boolean {
  const plain = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return !!plain(wanted) && plain(posted) === plain(wanted);
}
