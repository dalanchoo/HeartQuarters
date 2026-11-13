import { videoLanguage } from './youtube-language.js';
import { youtubeFetch } from './youtube-quota.js';

export interface YoutubeVideoSettings {
  etag: string; title: string; description: string; tags: string[]; language: string | null;
  privacy: 'private' | 'unlisted' | 'public'; madeForKids: boolean | null; synthetic: boolean | null;
  thumbnail: string | null; customThumbnail?: boolean | null;
}
interface VideoResource { etag?: string; snippet?: Record<string, unknown>; status?: Record<string, unknown>; contentDetails?: Record<string, unknown> }
export function youtubeVideoId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a YouTube video link.');
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('Enter a valid YouTube video link.'); }
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname.toLowerCase())) throw new Error('Enter a valid YouTube video link.');
  const parts = url.pathname.split('/').filter(Boolean);
  const id = url.hostname.toLowerCase() === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'live'].includes(parts[0]) ? parts[1] : null;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('That link does not contain a valid YouTube video ID.');
  return id;
}
import { QUOTA_USED_UP } from './youtube-quota.js';
export { QUOTA_USED_UP };

/** YouTube's error, in words: the daily quota gets its own message, since everything else fails until it resets. */
async function youtubeReadError(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  if (res.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(body)) return new Error(QUOTA_USED_UP);
  return new Error(`Couldn't read ${what} from YouTube (${res.status}).`);
}

export async function readYoutubeVideo(token: string, id: string): Promise<{ settings: YoutubeVideoSettings; resource: VideoResource }> {
  const res = await youtubeFetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await youtubeReadError(res, 'this video');
  const data = await res.json() as { items?: VideoResource[] };
  const settings = data.items?.[0] && videoSettings(data.items[0]);
  if (!settings) throw new Error('YouTube did not return complete video settings.');
  return { resource: data.items![0], settings };
}

/**
 * Many videos at once, 50 to a request (YouTube charges 1 unit per request, not per video). Videos YouTube doesn't
 * return, or returns incompletely, are left out, so the caller can tell they weren't checked.
 */
export async function readYoutubeVideos(token: string, ids: string[]): Promise<Record<string, YoutubeVideoSettings>> {
  const out: Record<string, YoutubeVideoSettings> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).map(encodeURIComponent).join(',');
    const res = await youtubeFetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${batch}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await youtubeReadError(res, 'these videos');
    const data = await res.json() as { items?: (VideoResource & { id?: string })[] };
    for (const resource of data.items ?? []) {
      const settings = videoSettings(resource);
      if (settings && typeof resource.id === 'string') out[resource.id] = settings;
    }
  }
  return out;
}

function videoSettings(resource: VideoResource): YoutubeVideoSettings | null {
  const snippet = resource.snippet; const status = resource.status;
  if (!resource.etag || !snippet || !status || typeof snippet.title !== 'string' || typeof snippet.categoryId !== 'string' || !['private', 'unlisted', 'public'].includes(String(status.privacyStatus))) return null;
  const thumbs = snippet.thumbnails as Record<string, { url?: string } | undefined> | undefined;
  return {
    etag: resource.etag, title: snippet.title, description: typeof snippet.description === 'string' ? snippet.description : '',
    tags: Array.isArray(snippet.tags) ? snippet.tags.filter((t): t is string => typeof t === 'string') : [],
    language: typeof snippet.defaultAudioLanguage === 'string' ? snippet.defaultAudioLanguage : null,
    privacy: status.privacyStatus as YoutubeVideoSettings['privacy'],
    madeForKids: typeof status.selfDeclaredMadeForKids === 'boolean' ? status.selfDeclaredMadeForKids : null,
    synthetic: typeof status.containsSyntheticMedia === 'boolean' ? status.containsSyntheticMedia : null,
    thumbnail: thumbs?.shortsAspectRatio?.url ?? thumbs?.uhd?.url ?? thumbs?.qhd?.url ?? thumbs?.fhd?.url ?? thumbs?.maxres?.url ?? thumbs?.standard?.url ?? thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url ?? null,
    customThumbnail: typeof resource.contentDetails?.hasCustomThumbnail === 'boolean' ? resource.contentDetails.hasCustomThumbnail : null,
  };
}

export async function updateYoutubeVideo(token: string, id: string, baseline: YoutubeVideoSettings, desired: YoutubeVideoSettings): Promise<void> {
  if (!baseline || !desired || typeof baseline.etag !== 'string') throw new Error('Load the current YouTube settings first.');
  if (typeof desired.title !== 'string' || !desired.title.trim() || desired.title.length > 100 || typeof desired.description !== 'string' || desired.description.length > 5000 || !Array.isArray(desired.tags) || desired.tags.some((t) => typeof t !== 'string') || desired.tags.join(',').length > 500) throw new Error('Check the title, description, and tags.');
  if (!['private', 'unlisted', 'public'].includes(desired.privacy) || ![true, false, null].includes(desired.madeForKids) || ![true, false, null].includes(desired.synthetic)) throw new Error('Check visibility and audience settings.');
  if ((baseline.madeForKids !== null && desired.madeForKids === null) || (baseline.synthetic !== null && desired.synthetic === null) || (baseline.language !== null && desired.language === null)) throw new Error('Choose a value instead of clearing an existing YouTube setting.');
  if (desired.language !== null && desired.language !== baseline.language) videoLanguage(desired.language);
  const current = await readYoutubeVideo(token, id);
  if (current.settings.etag !== baseline.etag) throw new Error('This video changed on YouTube. Reload its settings before saving.');
  const snippetChanged = desired.title !== baseline.title || desired.description !== baseline.description || JSON.stringify(desired.tags) !== JSON.stringify(baseline.tags) || desired.language !== baseline.language;
  const statusChanged = desired.privacy !== baseline.privacy || desired.madeForKids !== baseline.madeForKids || desired.synthetic !== baseline.synthetic;
  if (!snippetChanged && !statusChanged) return;
  const payload: Record<string, unknown> = { id }; const parts: string[] = [];
  if (snippetChanged) {
    const source = current.resource.snippet!; const snippet: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'tags', 'categoryId', 'defaultLanguage', 'defaultAudioLanguage']) if (source[key] !== undefined) snippet[key] = source[key];
    Object.assign(snippet, { title: desired.title, description: desired.description, tags: desired.tags });
    if (desired.language !== baseline.language && desired.language !== null) snippet.defaultAudioLanguage = desired.language;
    payload.snippet = snippet; parts.push('snippet');
  }
  if (statusChanged) {
    const source = current.resource.status!; const status: Record<string, unknown> = {};
    for (const key of ['privacyStatus', 'license', 'embeddable', 'publicStatsViewable', 'selfDeclaredMadeForKids', 'containsSyntheticMedia']) if (source[key] !== undefined) status[key] = source[key];
    if (source.publishAt && desired.privacy === 'private') status.publishAt = source.publishAt;
    status.privacyStatus = desired.privacy;
    if (desired.madeForKids !== null) status.selfDeclaredMadeForKids = desired.madeForKids;
    if (desired.synthetic !== null) status.containsSyntheticMedia = desired.synthetic;
    payload.status = status; parts.push('status');
  }
  const res = await youtubeFetch(`https://www.googleapis.com/youtube/v3/videos?part=${parts.join(',')}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': baseline.etag }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`YouTube could not save the video settings (${res.status}). Reload before trying again.`);
  const updated = await res.json() as VideoResource;
  if (snippetChanged && desired.language !== baseline.language && desired.language !== null && updated.snippet?.defaultAudioLanguage !== desired.language) throw new Error('YouTube saved the changes but did not confirm the video language. Check it in Studio.');
}

export async function youtubeCaptionTracks(token: string, id: string): Promise<{ id: string; language: string; name: string; status: string; kind: string }[]> {
  const res = await youtubeFetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Couldn't read caption tracks from YouTube (${res.status}).`);
  const body = await res.json() as { items?: { id?: string; snippet?: { language?: string; name?: string; status?: string; trackKind?: string } }[] };
  return (body.items ?? []).map((c) => ({ id: c.id ?? '', language: c.snippet?.language ?? '', name: c.snippet?.name ?? '', status: c.snippet?.status ?? '', kind: c.snippet?.trackKind ?? '' }));
}
