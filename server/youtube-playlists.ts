export const SHORTS_PLAYLIST = 'PLRugoq-5oewtiiVZSSnHvjxENllCrjCmr';
export interface YoutubePlaylist { id: string; title: string }

export function checkPlaylistIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new Error('Choose valid playlists.');
  return [...new Set(value as string[])];
}

/** Fetch every page of the connected channel's playlists. */
export async function listYoutubePlaylists(token: string): Promise<YoutubePlaylist[]> {
  const playlists: YoutubePlaylist[] = [];
  const seen = new Set<string>();
  let page = '';
  do {
    const params = new URLSearchParams({ part: 'snippet', mine: 'true', maxResults: '50' });
    if (page) params.set('pageToken', page);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlists?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Couldn't load your YouTube playlists (${res.status}).`);
    const body = await res.json() as { items?: { id: string; snippet?: { title?: string } }[]; nextPageToken?: string };
    for (const item of body.items ?? []) if (item.id && item.snippet?.title) playlists.push({ id: item.id, title: item.snippet.title });
    page = body.nextPageToken ?? '';
    if (page && seen.has(page)) throw new Error('YouTube repeated a playlist page. Please try again.');
    if (page) seen.add(page);
  } while (page);
  return playlists;
}

/** Avoid adding a duplicate if an earlier attempt already succeeded. */
export async function addYoutubePlaylist(token: string, playlist: string, video: string): Promise<void> {
  const params = new URLSearchParams({ part: 'id', playlistId: playlist, videoId: video, maxResults: '1' });
  const headers = { Authorization: `Bearer ${token}` };
  const check = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`, { headers });
  if (!check.ok) throw new Error(`Couldn't check playlist (${check.status}).`);
  const current = await check.json() as { items?: unknown[] };
  if (current.items?.length) return;
  const res = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ snippet: { playlistId: playlist, resourceId: { kind: 'youtube#video', videoId: video } } }) });
  if (!res.ok) throw new Error(`Couldn't add to playlist (${res.status}).`);
}
