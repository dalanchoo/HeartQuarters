// Channel-wide YouTube Analytics, kept in dated folders under Video Projects/Analytics.
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { pacificDate, type AnalyticsReport } from './analytics.js';
import { youtubeAccessToken, youtubeStatus } from './youtube-auth.js';
import { youtubeChannel } from './youtube.js';
import { recordAnalyticsUse } from './youtube-quota.js';
import { getReachData, type ReachData } from './youtube-reach.js';

const FIRST_DATE = '2008-07-01';
const METRICS = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost';
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface ChannelSnapshot {
  channel: { id: string; title: string }; downloadedAt: string;
  reports: { name: string; start: string; end: string; report: AnalyticsReport; error?: string }[];
  notes: string[];
  reach?: ReachData | { status: 'unavailable'; note: string };
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
    { name: 'Traffic Sources: Lifetime', start: FIRST_DATE, dimensions: 'insightTrafficSourceType', sort: '-views' },
    { name: 'Devices: Lifetime', start: FIRST_DATE, dimensions: 'deviceType', sort: '-views' },
    { name: 'Countries: Lifetime', start: FIRST_DATE, dimensions: 'country', sort: '-views' },
  ];
  const reports: ChannelSnapshot['reports'] = [];
  for (const item of requests) {
    const params = new URLSearchParams({ ids: 'channel==MINE', startDate: item.start, endDate: end, metrics: ['insightTrafficSourceType', 'deviceType', 'country'].includes(item.dimensions ?? '') ? 'views,estimatedMinutesWatched' : METRICS });
    if (item.dimensions) params.set('dimensions', item.dimensions);
    if (item.sort) params.set('sort', item.sort);
    if (item.maxResults) params.set('maxResults', item.maxResults);
    try {
      recordAnalyticsUse();
      const response = await fetcher(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`YouTube Analytics could not load ${item.name} (${response.status}). Check that the Analytics API is enabled and your YouTube connection is working.`);
      const data = await response.json() as { columnHeaders?: unknown[]; rows?: unknown[][] };
      reports.push({ name: item.name, start: item.start, end, report: { columns: data.columnHeaders ?? [], rows: data.rows ?? [] } });
    } catch (error) {
      if (!['insightTrafficSourceType', 'deviceType', 'country'].includes(item.dimensions ?? '')) throw error;
      reports.push({ name: item.name, start: item.start, end, report: { columns: [], rows: [] }, error: error instanceof Error ? error.message : String(error) });
    }
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
  if (!youtubeStatus().reportingAccess) snapshot.reach = { status: 'unavailable', note: 'Reconnect YouTube with Analytics permission to retrieve impressions and CTR.' };
  else try { snapshot.reach = await getReachData(token); } catch (error) { snapshot.reach = { status: 'unavailable', note: error instanceof Error ? error.message : String(error) }; }
  const file = saveChannelAnalytics(snapshot);
  return { file, channel: channel.title, emptyReports: snapshot.reports.filter(item => !item.report.rows?.length).map(item => item.name), topVideoCount: snapshot.reports.find(item => item.name === 'Top Videos: Lifetime')?.report.rows?.length ?? 0, reach: snapshot.reach };
}
