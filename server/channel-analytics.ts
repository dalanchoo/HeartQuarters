// Channel-wide YouTube Analytics, kept in dated folders under Video Projects/Analytics.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { pacificDate, type AnalyticsReport } from './analytics.js';
import { youtubeAccessToken } from './youtube-auth.js';
import { youtubeChannel } from './youtube.js';
import { recordAnalyticsUse } from './youtube-quota.js';

const FIRST_DATE = '2008-07-01';
const METRICS = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost';
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface ChannelSnapshot {
  channel: { id: string; title: string }; downloadedAt: string;
  reports: { name: string; start: string; end: string; report: AnalyticsReport }[];
  notes: string[];
}

function daysBefore(day: string, n: number): string {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - n); return date.toISOString().slice(0, 10);
}

export async function collectChannelAnalytics(channel: ChannelSnapshot['channel'], token: string, now = new Date(), fetcher: Fetch = fetch): Promise<ChannelSnapshot> {
  const end = pacificDate(now);
  const requests = [
    { name: 'Lifetime', start: FIRST_DATE },
    { name: 'Last 28 Days', start: daysBefore(end, 27) },
    { name: 'Last 90 Days', start: daysBefore(end, 89) },
    { name: 'Last 365 Days', start: daysBefore(end, 364) },
    { name: 'Daily: Last 90 Days', start: daysBefore(end, 89), dimensions: 'day', sort: 'day' },
    { name: 'Top Videos: Lifetime', start: FIRST_DATE, dimensions: 'video', sort: '-views', maxResults: '200' },
  ];
  const reports: ChannelSnapshot['reports'] = [];
  for (const item of requests) {
    const params = new URLSearchParams({ ids: 'channel==MINE', startDate: item.start, endDate: end, metrics: METRICS });
    if (item.dimensions) params.set('dimensions', item.dimensions);
    if (item.sort) params.set('sort', item.sort);
    if (item.maxResults) params.set('maxResults', item.maxResults);
    recordAnalyticsUse();
    const response = await fetcher(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`YouTube Analytics could not load ${item.name} (${response.status}). Check that the Analytics API is enabled and your YouTube connection is working.`);
    const data = await response.json() as { columnHeaders?: unknown[]; rows?: unknown[][] };
    reports.push({ name: item.name, start: item.start, end, report: { columns: data.columnHeaders ?? [], rows: data.rows ?? [] } });
  }
  return { channel, downloadedAt: now.toISOString(), reports, notes: [
    'Dates are Pacific calendar days. Recent data may not yet be available.',
    'The top-video report contains at most 200 videos, sorted by views; it is not a complete inventory.',
    'Lifetime reporting starts July 1, 2008. Audience retention and per-video age milestones are not included.',
  ] };
}

export function saveChannelAnalytics(snapshot: ChannelSnapshot): string {
  const root = safeResolve('projects', 'Analytics');
  if (fs.existsSync(root) && !fs.lstatSync(root).isDirectory()) throw new Error('Analytics must be a real folder.');
  fs.mkdirSync(root, { recursive: true });
  const day = pacificDate(new Date(snapshot.downloadedAt));
  for (let n = 1; ; n++) {
    const relative = path.join('Analytics', `${day}${n === 1 ? '' : ` (${n})`}`);
    const folder = safeResolve('projects', relative);
    try { fs.mkdirSync(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    const file = safeResolve('projects', path.join(relative, 'Stats.json'));
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    return path.join(relative, 'Stats.json').split(path.sep).join('/');
  }
}

export async function downloadChannelAnalytics() {
  const channel = await youtubeChannel();
  const token = await youtubeAccessToken();
  const snapshot = await collectChannelAnalytics(channel, token);
  const file = saveChannelAnalytics(snapshot);
  return { file, channel: channel.title, emptyReports: snapshot.reports.filter(item => !item.report.rows?.length).map(item => item.name), topVideoCount: snapshot.reports.at(-1)?.report.rows?.length ?? 0 };
}
