import { getJson } from './api';

// What the YouTube section has already read from YouTube, kept while the page is open, so closing and reopening a
// section (or another card asking for the same channel or playlists) doesn't spend quota again. It's read again only
// when John clicks Reload from YouTube, after Push Changes, or when the page reloads. Nothing is saved anywhere.
const cache = new Map<string, Promise<unknown>>();

/** A YouTube read through the engine: the remembered answer, unless `fresh`. Two cards asking at once share one read. */
export function cachedYoutube<T>(url: string, fresh = false): Promise<T> {
  if (fresh || !cache.has(url)) {
    const request = getJson<T>(url);
    cache.set(url, request);
    request.catch(() => { if (cache.get(url) === request) cache.delete(url); }); // a failed read isn't remembered
  }
  return cache.get(url) as Promise<T>;
}
