import { parseFields, setFieldValue } from './packaging';
import type { YoutubeVideoSettings } from '../../server/youtube-video';

// Visibility and playlists aren't kept in the file (John, 2026-11-12): YouTube is their only home.
export const SYNC_FIELDS = ['Title', 'Description', 'Tags', 'Video language', 'Made for kids', 'Altered content'] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];

export function localValue(text: string, label: SyncField): string | null {
  const fields = parseFields(text);
  if (!fields) return null;
  const matches = fields.filter((f) => f.label.toLowerCase() === label.toLowerCase());
  if (matches.length > 1) throw new Error(`The local file has more than one ${label} field. Resolve that before copying.`);
  return matches[0]?.value ?? null;
}

/** Add a named field or change only its value; never rewrite the rest of the file. */
export function setLocalValue(text: string, label: SyncField, value: string): string {
  const fields = parseFields(text);
  if (!fields) throw new Error('The local YouTube file does not have recognizable fields.');
  const matches = fields.map((f, i) => ({ f, i })).filter(({ f }) => f.label.toLowerCase() === label.toLowerCase());
  if (matches.length > 1) throw new Error(`The local file has more than one ${label} field. Resolve that before copying.`);
  if (matches.length) return setFieldValue(text, matches[0].i, value);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${text.replace(/(?:\r?\n)*$/, '')}${eol}${eol}${label}:${eol}${value}${eol}`;
}

export function youtubeValues(video: YoutubeVideoSettings): Record<SyncField, string | null> {
  return {
    Title: video.title, Description: video.description, Tags: video.tags.join(', '),
    'Video language': video.language,
    'Made for kids': video.madeForKids === null ? null : video.madeForKids ? 'Yes' : 'No',
    'Altered content': video.synthetic === null ? null : video.synthetic ? 'Yes' : 'No',
  };
}

/**
 * The Altered content answer to keep in YouTube.md. YouTube doesn't report this setting back when reading a video, so
 * the file keeps the answer HeartQuarters sent. Null means no answer was chosen, and nothing should be written.
 */
export function alteredContentValue(synthetic: boolean | null): string | null {
  return synthetic === null ? null : synthetic ? 'Yes' : 'No';
}

/**
 * How one field compares. A value YouTube doesn't report, such as Altered content, isn't a difference: the file only
 * records what was sent, and there's nothing on YouTube's side to compare it with.
 */
export function comparisonState(local: string | null, remote: string | null, same: boolean | undefined, issue: string): string {
  if (issue) return 'Needs attention';
  if (local === null && remote === null) return 'Not provided';
  if (remote === null) return "YouTube doesn't report this";
  return same ? 'Same' : 'Different';
}

export function localBoolean(value: string): boolean {
  if (/^yes$/i.test(value.trim())) return true;
  if (/^no$/i.test(value.trim())) return false;
  throw new Error('Use Yes or No in the local field.');
}
