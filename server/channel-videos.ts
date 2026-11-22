// Every video on the YouTube channel with its lifetime numbers, for the Channel tab.
// The saved copy lives in the app's own data folder, never in Google Drive.
import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './config.js';
import { pacificDate } from './analytics.js';
import { listProjectVideos } from './projects.js';
import { youtubeAccessToken } from './youtube-auth.js';
import { recordAnalyticsUse, youtubeFetch } from './youtube-quota.js';
import { linkedVideos, youtubeChannel } from './youtube.js';

const FIRST_DATE = '2008-07-01';
const METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'subscribersGained'] as const;
/** YouTube allows Shorts up to three minutes, but its API doesn't say which videos are Shorts. */
const SHORT_MAX_SECONDS = 180;

export interface VideoNumbers { views: number; minutesWatched: number; averageViewDuration: number; averageViewPercentage: number; likes: number; subscribersGained: number }
export interface ChannelVideo {
  id: string; title: string; publishedAt: string; seconds: number; privacy: string;
  kind: 'longform' | 'short';
  /** True when the kind is a guess from the video's length (the video isn't linked to a project). */
  kindGuessed: boolean;
  /** The project piece folder this video is linked to, or null. */
  piece: string | null;
  /** Null when YouTube Analytics has no numbers for this video yet. */
  numbers: VideoNumbers | null;
}
export interface ChannelVideoList { channel: { id: string; title: string }; updatedAt: string; videos: ChannelVideo[] }

/** "PT1H2M3S" -> 3723. */
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

async function getJson<T>(url: string, token: string, what: string): Promise<T> {
  const res = await youtubeFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`YouTube could not ${what} (${res.status}). Check that your YouTube connection is working.`);
  return await res.json() as T;
}
const chunks = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Every video id in the channel's uploads playlist, newest first. */
async function uploadIds(token: string): Promise<string[]> {
  const channel = await getJson<{ items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', token, 'find your uploads');
  const playlist = channel.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!playlist) throw new Error('YouTube did not return an uploads list for this channel.');
  const ids: string[] = [];
  let page = '';
  do {
    const params = new URLSearchParams({ part: 'contentDetails', playlistId: playlist, maxResults: '50' });
    if (page) params.set('pageToken', page);
    const data = await getJson<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`, token, 'list your videos');
    for (const item of data.items ?? []) ids.push(item.contentDetails.videoId);
    page = data.nextPageToken ?? '';
  } while (page);
  return ids;
}

type Detail = { id: string; title: string; publishedAt: string; seconds: number; privacy: string };
async function videoDetails(token: string, ids: string[]): Promise<Detail[]> {
  const out: Detail[] = [];
  for (const batch of chunks(ids, 50)) {
    const params = new URLSearchParams({ part: 'snippet,contentDetails,status', id: batch.join(',') });
    const data = await getJson<{ items?: { id: string; snippet: { title: string; publishedAt: string }; contentDetails: { duration: string }; status?: { privacyStatus?: string } }[] }>(`https://www.googleapis.com/youtube/v3/videos?${params}`, token, 'read your videos');
    for (const v of data.items ?? []) out.push({ id: v.id, title: v.snippet.title, publishedAt: v.snippet.publishedAt, seconds: parseDuration(v.contentDetails.duration), privacy: v.status?.privacyStatus ?? 'unknown' });
  }
  return out;
}

/** Lifetime numbers by video id. Videos YouTube Analytics has nothing for yet are left out. */
async function videoNumbers(token: string, ids: string[], now: Date): Promise<Map<string, VideoNumbers>> {
  const result = new Map<string, VideoNumbers>();
  for (const batch of chunks(ids, 200)) {
    const params = new URLSearchParams({ ids: 'channel==MINE', startDate: FIRST_DATE, endDate: pacificDate(now), metrics: METRICS.join(','), dimensions: 'video', sort: '-views', maxResults: '200', filters: `video==${batch.join(',')}` });
    recordAnalyticsUse();
    const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`YouTube Analytics could not load your video numbers (${res.status}). Check that the Analytics API is enabled and your YouTube connection is working.`);
    const data = await res.json() as { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };
    const names = (data.columnHeaders ?? []).map((c) => c.name);
    const at = (row: (string | number)[], name: string) => Number(row[names.indexOf(name)] ?? 0);
    for (const row of data.rows ?? []) {
      result.set(String(row[names.indexOf('video')]), { views: at(row, 'views'), minutesWatched: at(row, 'estimatedMinutesWatched'), averageViewDuration: at(row, 'averageViewDuration'), averageViewPercentage: at(row, 'averageViewPercentage'), likes: at(row, 'likes'), subscribersGained: at(row, 'subscribersGained') });
    }
  }
  return result;
}

/** What each linked video is, by video id: its project piece folder and whether that piece is a Short. */
function linkedKinds(): Map<string, { piece: string; kind?: 'longform' | 'short' }> {
  let pieceKinds = new Map<string, 'longform' | 'short'>();
  try {
    for (const { video } of listProjectVideos()) for (const p of video.pieces) pieceKinds.set(p.path, p.kind === 'longform' ? 'longform' : 'short');
  } catch { pieceKinds = new Map(); } // Drive not running: fall back to guessing from length
  return new Map(linkedVideos().map(({ piece, videoId }) => [videoId, { piece, kind: pieceKinds.get(piece) }]));
}

export function mergeChannelVideos(details: Detail[], numbers: Map<string, VideoNumbers>, links: Map<string, { piece: string; kind?: 'longform' | 'short' }>): ChannelVideo[] {
  return details.map((d) => {
    const link = links.get(d.id);
    const kind = link?.kind ?? (d.seconds <= SHORT_MAX_SECONDS ? 'short' : 'longform');
    return { ...d, kind, kindGuessed: !link?.kind, piece: link?.piece ?? null, numbers: numbers.get(d.id) ?? null };
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function collectChannelVideos(channel: { id: string; title: string }, now = new Date()): Promise<ChannelVideoList> {
  const token = await youtubeAccessToken();
  const ids = await uploadIds(token);
  const [details, numbers] = await Promise.all([videoDetails(token, ids), videoNumbers(token, ids, now)]);
  return { channel, updatedAt: now.toISOString(), videos: mergeChannelVideos(details, numbers, linkedKinds()) };
}

const savedFile = () => process.env.HQ_CHANNEL_VIDEOS_FILE ?? path.join(appDir, 'data', 'channel-video-list.json');

export function readChannelVideos(): ChannelVideoList | null {
  try {
    const saved = JSON.parse(fs.readFileSync(savedFile(), 'utf8')) as ChannelVideoList;
    return Array.isArray(saved?.videos) ? saved : null; // anything else isn't ours
  } catch { return null; }
}

export async function refreshChannelVideos(): Promise<ChannelVideoList> {
  const list = await collectChannelVideos(await youtubeChannel());
  fs.mkdirSync(path.dirname(savedFile()), { recursive: true });
  fs.writeFileSync(savedFile(), JSON.stringify(list, null, 2) + '\n');
  return list;
}
