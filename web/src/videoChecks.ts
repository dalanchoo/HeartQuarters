import type { YoutubeVideoSettings } from '../../server/youtube-video';

export interface YoutubeChecks { issues: string[]; unknown: string[] }
/** captions: the tracks, null if YouTube couldn't say, or undefined when they weren't checked (the list-wide check skips them). */
export function checkYoutubeVideo(video: YoutubeVideoSettings, captions: { kind: string }[] | null | undefined, short: boolean): YoutubeChecks {
  const issues: string[] = []; const unknown: string[] = [];
  if (!video.title.trim()) issues.push('title is empty');
  if (!video.description.trim()) issues.push('description is empty');
  if (!video.tags.some((tag) => tag.trim())) issues.push('no tags');
  if (video.customThumbnail === false) issues.push('no custom thumbnail');
  else if (video.customThumbnail == null) unknown.push('custom thumbnail');
  if (captions === null) unknown.push('captions');
  else if (captions !== undefined && !captions.some((track) => track.kind.toLowerCase() !== 'asr')) issues.push(captions.length ? 'only automatic captions' : 'no captions');
  if (!short && (video.description.match(/^\s*(?:\d+:)?\d{1,2}:\d{2}(?:\s|\s*[-–])/gm) ?? []).length < 3) issues.push('chapters may be missing');
  return { issues, unknown };
}
