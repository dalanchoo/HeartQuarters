import { parseFields, setFieldValue } from './packaging';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
import type { YoutubePlaylist } from '../../server/youtube-playlists';

export const SYNC_FIELDS = ['Title', 'Description', 'Tags', 'Video language', 'Visibility', 'Made for kids', 'Altered content', 'Playlists'] as const;
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

export function youtubeValues(video: YoutubeVideoSettings, playlists: YoutubePlaylist[], selected: string[]): Record<SyncField, string | null> {
  return {
    Title: video.title, Description: video.description, Tags: video.tags.join(', '),
    'Video language': video.language, Visibility: video.privacy,
    'Made for kids': video.madeForKids === null ? null : video.madeForKids ? 'Yes' : 'No',
    'Altered content': video.synthetic === null ? null : video.synthetic ? 'Yes' : 'No',
    Playlists: selected.map((id) => `${playlists.find((p) => p.id === id)?.title ?? 'Playlist'} [${id}]`).join('\n'),
  };
}

export function localPlaylistIds(value: string, available: YoutubePlaylist[]): string[] {
  if (!value.trim()) return [];
  const ids = value.split(/\r?\n/).map((line) => {
    const id = /\[([A-Za-z0-9_-]+)\]\s*$/.exec(line.trim())?.[1];
    if (!id || !available.some((p) => p.id === id)) throw new Error('Each local playlist must end with its YouTube ID in brackets and exist on this channel.');
    return id;
  });
  return [...new Set(ids)];
}

export function localBoolean(value: string): boolean {
  if (/^yes$/i.test(value.trim())) return true;
  if (/^no$/i.test(value.trim())) return false;
  throw new Error('Use Yes or No in the local field.');
}
