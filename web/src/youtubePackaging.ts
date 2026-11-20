import { parseFields, setFieldValue, sortTags } from './packaging';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
import { VIDEO_LANGUAGES } from '../../server/youtube-constants';

// Visibility and playlists aren't kept in the file (John, 2026-11-12): YouTube is their only home.
export const SYNC_FIELDS = ['Title', 'Description', 'Tags', 'Video language', 'Made for kids', 'Altered content'] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];

/**
 * The description as YouTube has it. Older files keep the hashtags in a Hashtags field of their own; YouTube keeps them
 * at the end of the description, so they're added there (unless the description already has them).
 */
export function descriptionWithHashtags(fields: { label: string; value: string }[]): string | null {
  const description = fields.find((f) => f.label.toLowerCase() === 'description')?.value ?? null;
  const hashtags = fields.find((f) => f.label.toLowerCase() === 'hashtags')?.value.trim() ?? '';
  if (description === null) return hashtags || null;
  if (!hashtags || description.includes(hashtags)) return description;
  return description ? `${description}\n\n${hashtags}` : hashtags;
}

/** A description's last paragraph, when it's nothing but hashtags: "#ayahuasca #psychedelichealing". */
export function splitHashtags(description: string): { description: string; hashtags: string | null } {
  const paragraphs = description.trim().split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1]?.trim() ?? '';
  if (paragraphs.length < 2 || !/^(#[\p{L}\p{N}_]+\s*)+$/u.test(last)) return { description, hashtags: null };
  return { description: paragraphs.slice(0, -1).join('\n\n'), hashtags: last };
}

/** Warn before replacing a chaptered description with one that has no chapter list. */
export function wouldLoseChapters(existing: string, replacement: string): boolean {
  const hasChapters = (text: string) => (text.match(/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?=\s|[-–—])[^\r\n]*$/gm) ?? []).length >= 3;
  return hasChapters(existing) && !hasChapters(replacement);
}

export function localValue(text: string, label: SyncField): string | null {
  const fields = parseFields(text);
  if (!fields) return null;
  const matches = fields.filter((f) => f.label.toLowerCase() === label.toLowerCase());
  if (matches.length > 1) throw new Error(`The local file has more than one ${label} field. Resolve that before copying.`);
  if (label === 'Description') return descriptionWithHashtags(fields);
  return matches[0]?.value ?? null;
}

/** Add a named field or change only its value; never rewrite the rest of the file. */
export function setLocalValue(text: string, label: SyncField, value: string): string {
  const fields = parseFields(text);
  if (!fields) throw new Error('The local YouTube file does not have recognizable fields.');
  // A file with a Hashtags field gets YouTube's closing hashtags there, not repeated in the description.
  if (label === 'Description' && fields.some((f) => f.label.toLowerCase() === 'hashtags')) {
    const split = splitHashtags(value);
    if (split.hashtags !== null) return setLocalValue(setPlain(text, 'Hashtags', split.hashtags), 'Description', split.description);
  }
  return setPlain(text, label, value);
}

/** Sets one field's value as it is, or adds the field at the end. */
function setPlain(text: string, label: string, value: string): string {
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
    Title: video.title, Description: video.description, Tags: sortTags(video.tags.join(', ')),
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

/**
 * The first of the video's tags that appears word for word (ignoring capitals) in the description's first 200
 * characters, or null when none does. vidIQ scores a description 50 instead of 100 without one (John's videos,
 * 2026-10 and 2026-11-17).
 */
export function tagInOpening(description: string, tags: string): string | null {
  const opening = description.slice(0, 200).toLowerCase();
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const tag of tags.split(',').map((t) => t.trim()).filter(Boolean)) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(tag.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(opening)) return tag;
  }
  return null;
}

/**
 * Whether to warn that vidIQ's check fails: there are a description and tags, but no tag in the description's
 * first 200 characters. Without tags there's nothing to check yet, such as an empty template (John, 2026-11-18).
 */
export function missingTagInOpening(description: string | null | undefined, tags: string | null | undefined): boolean {
  return !!description?.trim() && !!tags?.split(',').some((t) => t.trim()) && !tagInOpening(description, tags);
}

/**
 * The answers a field allows, when it has a fixed set (shown as a dropdown instead of a text box): the video
 * languages YouTube accepts here, and Yes or No. Null for a field you write freely.
 */
export function fieldChoices(label: string): { value: string; label: string }[] | null {
  const name = label.trim().toLowerCase();
  if (name === 'video language') return VIDEO_LANGUAGES.map((l) => ({ value: l.value, label: `${l.label} (${l.value})` }));
  if (name === 'made for kids' || name === 'altered content') return [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }];
  return null;
}
