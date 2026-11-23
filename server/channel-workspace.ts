import { analyticsSnapshots, prepareVideoSnapshot, readAnalyticsSnapshot, startAnalyticsAnalysis } from './analytics-analysis.js';
import { readAnalysisTranscript } from './analytics-context.js';
import { reachTotals, summarizeSnapshot, type ReachTotals } from './analytics-summary.js';
import { downloadChannelAnalytics, type ChannelSnapshot } from './channel-analytics.js';
import { readChannelVideos, refreshChannelVideos } from './channel-videos.js';
import { videoLinks } from './video-links.js';
import type { ReachData } from './youtube-reach.js';

const RECENT_MS = 24 * 60 * 60 * 1000;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function channelOverview() {
  const name = analyticsSnapshots('')[0];
  if (!name) return null;
  const snapshot = readAnalyticsSnapshot<ChannelSnapshot>('', name);
  const reports = snapshot.reports.filter(report => !report.error && ['Last 28 Days', 'Last 90 Days', 'Last 365 Days', 'Lifetime'].includes(report.name));
  const { periods } = summarizeSnapshot({ periods: reports.map(({ name, start, end, report }) => ({ period: { name, start, end, complete: true }, statistics: report })) });
  const reach = snapshot.reach?.status === 'ready' ? snapshot.reach : null;
  const byVideo = new Map<string, ReachData['days']>();
  for (const day of reach?.days ?? []) {
    const grouped = new Map<string, typeof day.rows>();
    for (const row of day.rows) {
      if (!row.video_id) continue;
      const rows = grouped.get(row.video_id) ?? [];
      rows.push(row);
      grouped.set(row.video_id, rows);
    }
    for (const [id, rows] of grouped) {
      const days = byVideo.get(id) ?? [];
      days.push({ ...day, rows });
      byVideo.set(id, days);
    }
  }
  const videoReach: Record<string, ReachTotals | null> = Object.fromEntries([...byVideo].map(([id, days]) => [id, reachTotals({ days })]));
  return { channelId: snapshot.channel.id, downloadedAt: snapshot.downloadedAt, periods, reach: reachTotals(reach), reachNote: snapshot.reach?.note, reachTruncated: reach?.truncated ?? false, videoReach };
}

async function refresh() {
  const [catalog, stats] = await Promise.allSettled([refreshChannelVideos(), downloadChannelAnalytics()]);
  const errors: string[] = [];
  if (catalog.status === 'rejected') errors.push(`Video catalog: ${errorText(catalog.reason)}`);
  if (stats.status === 'rejected') errors.push(`Channel stats: ${errorText(stats.reason)}`);
  return { catalog: catalog.status === 'fulfilled' ? catalog.value : readChannelVideos(), errors };
}

let refreshInProgress: ReturnType<typeof refresh> | undefined;
export function refreshChannelWorkspace() {
  return refreshInProgress ??= refresh().finally(() => { refreshInProgress = undefined; });
}

function linkedPiece(videoId: string) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Choose a YouTube video.');
  return videoLinks().get(videoId)?.piece ?? null;
}

export async function channelVideoDetail(videoId: string) {
  const piece = linkedPiece(videoId);
  return { piece, transcript: piece ? await readAnalysisTranscript(piece) : null };
}

export async function startChannelVideoAnalysis(videoId: string) {
  const piece = linkedPiece(videoId);
  if (!piece) throw new Error('Link this video in Video Projects to analyze it.');
  const recentChannel = analyticsSnapshots('')[0];
  const channel = recentChannel ? readAnalyticsSnapshot<ChannelSnapshot>('', recentChannel) : null;
  const catalog = readChannelVideos();
  const reach = channel && Date.now() - Date.parse(channel.downloadedAt) < RECENT_MS && channel.reach?.status === 'ready' && !channel.reach.truncated && catalog?.channel.id === channel.channel.id ? channel.reach : undefined;
  const snapshot = await prepareVideoSnapshot(piece, videoId, reach);
  return { snapshot, job: startAnalyticsAnalysis(piece, snapshot).job };
}
