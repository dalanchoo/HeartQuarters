// YouTube's daily quota. YouTube gives each app 10,000 units a day (uploads are counted separately: 100 a day) and
// starts again at midnight Pacific time, but it has no way to ask how much is left. So HeartQuarters counts what it
// spends itself, by YouTube's published cost of each request
// (https://developers.google.com/youtube/v3/determine_quota_cost), and remembers when YouTube said it's used up.
// The count is kept in data/youtube-quota.json so a restart doesn't lose it; it only counts HeartQuarters' requests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DAILY_UNITS = 10_000;
export const DAILY_UPLOADS = 100;
export const QUOTA_USED_UP = "Out of YouTube quota for today. More at midnight Pacific time.";

interface QuotaDay {
  /** The Pacific-time date this count is for, e.g. "2026-11-12". */
  day: string;
  used: number;
  uploads: number;
  /** YouTube said the quota is used up. */
  exhausted: boolean;
  /** How many playlists the channel had last time they were listed, for cost estimates. */
  playlists?: number;
}

let memory: QuotaDay | null = null; // used in tests, which must never write the app's data folder

// The screens share small lists with the YouTube files (languages, the Shorts playlist), which import this file, so
// nothing engine-only may run when it loads: the data folder is worked out only when it's needed (same as config.appDir).
const quotaFile = () => process.env.HQ_YOUTUBE_QUOTA_FILE ?? (process.env.VITEST ? '' : path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data', 'youtube-quota.json'));

export function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Minutes until midnight Pacific time, when YouTube starts the count again. */
export function minutesUntilReset(now = new Date()): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return 24 * 60 - (Number(parts.hour) * 60 + Number(parts.minute));
}

function load(): QuotaDay {
  const today = pacificDay();
  let saved: QuotaDay | null = memory;
  const file = quotaFile();
  if (file) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) as QuotaDay; } catch { saved = null; }
  }
  if (!saved || saved.day !== today) return { day: today, used: 0, uploads: 0, exhausted: false, playlists: saved?.playlists };
  return saved;
}

function save(q: QuotaDay) {
  memory = q;
  const file = quotaFile();
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(q));
}

/** What one request costs, in units, by YouTube's table. Uploads and token requests cost no units. */
export function youtubeCost(url: string, method = 'GET'): number {
  const u = new URL(url);
  if (!u.hostname.endsWith('googleapis.com') || u.hostname.startsWith('oauth2.')) return 0;
  const m = method.toUpperCase();
  const resource = u.pathname.replace(/^\/(upload\/)?youtube\/v3\//, '').split('/')[0];
  if (u.pathname.startsWith('/upload/youtube/v3/videos') || !u.pathname.includes('/youtube/v3/')) return 0; // uploads: their own daily count
  if (resource === 'captions') return m === 'GET' ? 50 : m === 'POST' ? 400 : m === 'PUT' ? 450 : 50;
  if (resource === 'thumbnails') return 50;
  if (['videos', 'playlistItems', 'playlists', 'channels'].includes(resource)) return m === 'GET' ? 1 : 50;
  return 1; // anything else: YouTube charges every request at least 1
}

export function recordYoutubeUse(units: number, upload = false) {
  const q = load();
  q.used += units;
  if (upload) q.uploads += 1;
  save(q);
}

export function rememberPlaylistCount(count: number) {
  const q = load();
  q.playlists = count;
  save(q);
}

/**
 * fetch() for YouTube requests: counts the request's cost, and turns YouTube's "quota exceeded" into one plain message
 * (and remembers it until the count starts again).
 */
export async function youtubeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  // Once YouTube has said it's used up, don't ask again until midnight Pacific: every request costs at least 1 unit.
  if (youtubeCost(url, method) > 0 && load().exhausted) throw new Error(QUOTA_USED_UP);
  const res = await fetch(url, init);
  const isUploadStart = new URL(url).pathname.startsWith('/upload/youtube/v3/videos') && method.toUpperCase() === 'POST';
  recordYoutubeUse(youtubeCost(url, method), isUploadStart);
  if (res.status === 403) {
    const body = await res.clone().text().catch(() => '');
    if (/quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/.test(body)) {
      const q = load();
      q.exhausted = true;
      save(q);
      throw new Error(QUOTA_USED_UP);
    }
  }
  return res;
}

export interface YoutubeQuota {
  used: number;
  limit: number;
  uploads: number;
  uploadLimit: number;
  exhausted: boolean;
  minutesUntilReset: number;
  /** Last known number of playlists on the channel, for estimating what reading a video's playlists costs. */
  playlists: number | null;
}

export function youtubeQuota(): YoutubeQuota {
  const q = load();
  return { used: q.used, limit: DAILY_UNITS, uploads: q.uploads, uploadLimit: DAILY_UPLOADS, exhausted: q.exhausted, minutesUntilReset: minutesUntilReset(), playlists: q.playlists ?? null };
}

/** Tests only: start from an empty count. */
export function resetQuotaForTests() {
  memory = null;
}
