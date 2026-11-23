// Read-only YouTube Analytics queries and dated, non-overwriting snapshots.
// The caller supplies the linked video ID and publication date from YouTube.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { youtubeAccessToken, youtubeStatus } from './youtube-auth.js';
import { uploadsFor } from './youtube.js';
import { readYoutubeVideo } from './youtube-video.js';
import { recordAnalyticsUse } from './youtube-quota.js';
import { getReachData, type ReachData } from './youtube-reach.js';
import { reachTotals, type ReachTotals } from './analytics-summary.js';

export interface AnalyticsPeriod { name: string; start: string; end: string; complete: boolean }
export interface AnalyticsReport { columns?: unknown[]; rows?: unknown[][] }
export interface AnalyticsSnapshot {
  videoId: string; publishedAt: string; downloadedAt: string;
  published?: { title: string; thumbnail: string | null };
  periods: { period: AnalyticsPeriod; statistics: AnalyticsReport; retention: AnalyticsReport | null; retentionError?: string }[];
  breakdowns?: { name: string; start: string; end: string; report: AnalyticsReport | null; error?: string }[];
  /** `totals` adds up all the days: impressions, and CTR weighted by impressions. */
  reach?: (ReachData & { totals?: ReachTotals | null }) | { status: 'unavailable'; note: string };
}

/** YouTube reports use Pacific calendar days, not elapsed 24-hour periods. */
export function pacificDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function analyticsPeriods(publishedAt: string, now: Date): AnalyticsPeriod[] {
  const start = pacificDate(new Date(publishedAt));
  const today = pacificDate(now);
  if (start > today) throw new Error('The publication date is in the future.');
  return [{ name: 'First 2 Days', days: 2 }, { name: 'First Week', days: 7 }, { name: 'First Month', days: 30 }].map(({ name, days }) => {
    const end = addDays(start, days - 1);
    return { name, start, end: end < today ? end : today, complete: end < today };
  }).concat({ name: 'Lifetime to Date', start, end: today, complete: false });
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
async function report(fetcher: Fetch, token: string, videoId: string, period: AnalyticsPeriod, retention: boolean): Promise<AnalyticsReport> {
  const params = new URLSearchParams({ ids: 'channel==MINE', startDate: period.start, endDate: period.end, filters: `video==${videoId}`,
    metrics: retention ? 'audienceWatchRatio' : 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost' });
  if (retention) params.set('dimensions', 'elapsedVideoTimeRatio');
  recordAnalyticsUse(); // Count attempts, including requests YouTube rejects.
  const response = await fetcher(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`YouTube Analytics request failed (${response.status}). Check that the YouTube Analytics API is enabled and YouTube is connected.`);
  const data = await response.json() as { columnHeaders?: unknown[]; rows?: unknown[][] };
  return { columns: data.columnHeaders ?? [], rows: data.rows ?? [] };
}

/** Missing retention is recorded explicitly; a failed statistics request stops the snapshot. */
export async function collectVideoAnalytics(videoId: string, publishedAt: string, token: string, now = new Date(), fetcher: Fetch = fetch): Promise<AnalyticsSnapshot> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
  const periods = [] as AnalyticsSnapshot['periods'];
  for (const period of analyticsPeriods(publishedAt, now)) {
    const statistics = await report(fetcher, token, videoId, period, false);
    let retention: AnalyticsReport | null = null; let retentionError: string | undefined;
    try { retention = await report(fetcher, token, videoId, period, true); }
    catch (error) { retentionError = error instanceof Error ? error.message : String(error); }
    periods.push({ period, statistics, retention, ...(retentionError ? { retentionError } : {}) });
  }
  const lifetime = periods.at(-1)!.period;
  const breakdowns: NonNullable<AnalyticsSnapshot['breakdowns']> = [];
  for (const [name, dimension] of [['Traffic Sources', 'insightTrafficSourceType'], ['Devices', 'deviceType'], ['Countries', 'country']] as const) {
    const params = new URLSearchParams({ ids: 'channel==MINE', startDate: lifetime.start, endDate: lifetime.end, filters: `video==${videoId}`, dimensions: dimension, metrics: 'views,estimatedMinutesWatched', sort: '-views' });
    try {
      recordAnalyticsUse();
      const response = await fetcher(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`YouTube returned ${response.status}.`);
      const data = await response.json() as { columnHeaders?: unknown[]; rows?: unknown[][] };
      breakdowns.push({ name, start: lifetime.start, end: lifetime.end, report: { columns: data.columnHeaders ?? [], rows: data.rows ?? [] } });
    } catch (error) { breakdowns.push({ name, start: lifetime.start, end: lifetime.end, report: null, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { videoId, publishedAt, downloadedAt: now.toISOString(), periods, breakdowns };
}

/** Save a new snapshot alongside the video, never replacing a previous download. */
export function saveVideoAnalytics(piece: string, snapshot: AnalyticsSnapshot): string {
  if (!piece) throw new Error('Choose a video.');
  const video = safeResolve('projects', piece);
  if (!fs.statSync(video, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Video folder not found.');
  const relative = path.join(piece, 'Analytics');
  const folder = safeResolve('projects', relative);
  if (fs.existsSync(folder) && !fs.lstatSync(folder).isDirectory()) throw new Error('Analytics must be a real folder.');
  fs.mkdirSync(folder, { recursive: true });
  const day = pacificDate(new Date(snapshot.downloadedAt));
  for (let number = 1; ; number++) {
    const name = `${day}${number === 1 ? '' : ` (${number})`}`;
    const dir = safeResolve('projects', path.join(relative, name));
    try { fs.mkdirSync(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    const file = safeResolve('projects', path.join(relative, name, 'Stats.json'));
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    return path.join(relative, name, 'Stats.json').split(path.sep).join('/');
  }
}

/** Download only the YouTube video explicitly linked to this project. */
export async function downloadVideoAnalytics(piece: string, id: string) {
  const job = uploadsFor(piece).find(item => item.id === id && item.status === 'done' && item.videoId);
  if (!job?.videoId) throw new Error('Link this video to YouTube first.');
  return downloadLinkedVideoAnalytics(piece, job.videoId);
}

export async function downloadLinkedVideoAnalytics(piece: string, videoId: string, channelReach?: ReachData) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
  const token = await youtubeAccessToken();
  const { resource, settings } = await readYoutubeVideo(token, videoId);
  const publishedAt = resource.snippet?.publishedAt;
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) throw new Error('YouTube did not provide a publication date for this video.');
  const snapshot = await collectVideoAnalytics(videoId, publishedAt, token);
  if (settings) snapshot.published = { title: settings.title, thumbnail: settings.thumbnail };
  if (channelReach) {
    const days = channelReach.days.map(day => ({ ...day, rows: day.rows.filter(row => row.video_id === videoId) }));
    const reach = { ...channelReach, days };
    snapshot.reach = { ...reach, totals: reachTotals(reach, videoId) };
  } else if (!youtubeStatus().reportingAccess) snapshot.reach = { status: 'unavailable', note: 'Reconnect YouTube with Analytics permission to retrieve impressions and CTR.' };
  else try { const reach = await getReachData(token, videoId); snapshot.reach = { ...reach, totals: reachTotals(reach, videoId) }; } catch (error) { snapshot.reach = { status: 'unavailable', note: error instanceof Error ? error.message : String(error) }; }
  const file = saveVideoAnalytics(piece, snapshot);
  const missing = snapshot.periods.filter(p => !p.retention || !p.retention.rows?.length).map(p => p.period.name);
  return { file, missingRetention: missing, emptyStatistics: snapshot.periods.filter(p => !p.statistics.rows?.length).map(p => p.period.name), unavailableBreakdowns: snapshot.breakdowns?.filter(item => !item.report || !item.report.rows?.length).map(item => item.name) ?? [], reach: snapshot.reach };
}
