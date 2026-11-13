import { youtubeFetch } from './youtube-quota.js';
export const VIDEO_LANGUAGES = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en', label: 'English' },
] as const;

export function videoLanguage(value: unknown): string {
  if (value === undefined) return 'en-US';
  if (typeof value !== 'string' || !VIDEO_LANGUAGES.some((language) => language.value === value)) throw new Error('Choose a supported video language.');
  return value;
}

/** Preserve the editable snippet fields and check YouTube actually accepted the spoken language. */
export async function setVideoLanguage(token: string, id: string, language: string): Promise<void> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(id)}`;
  const headers = { Authorization: `Bearer ${token}` };
  const response = await youtubeFetch(url, { headers });
  if (!response.ok) throw new Error(`Couldn't read the video settings from YouTube (${response.status}).`);
  const result = await response.json() as { items?: { etag?: string; snippet?: Record<string, unknown> }[] };
  const item = result.items?.[0]; const snippet = item?.snippet;
  if (!snippet || !item?.etag || typeof snippet.title !== 'string' || typeof snippet.categoryId !== 'string') throw new Error('YouTube did not return the video settings needed to safely update its language.');
  if (snippet.defaultAudioLanguage === language) return;
  const editable: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'tags', 'categoryId', 'defaultLanguage']) if (snippet[key] !== undefined) editable[key] = snippet[key];
  editable.defaultAudioLanguage = language;
  const update = await youtubeFetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': item.etag }, body: JSON.stringify({ id, snippet: editable }) });
  if (!update.ok) throw new Error(`YouTube couldn't set the video language (${update.status}). Set it in YouTube Studio before adding subtitles.`);
  const saved = await update.json() as { snippet?: { defaultAudioLanguage?: string } };
  if (saved.snippet?.defaultAudioLanguage !== language) throw new Error('YouTube did not confirm the video language. Set it in YouTube Studio before adding subtitles.');
}
