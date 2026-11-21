// Turns a saved Stats.json snapshot into the few numbers worth a glance, like the top of YouTube Studio's Analytics.
// No file or network access here, so the screens use the same code to show a snapshot.

export interface SnapshotReport { columns?: unknown[]; rows?: unknown[][] }
export interface SnapshotLike {
  videoId?: string; publishedAt?: string; downloadedAt?: string;
  periods?: { period: { name: string; start: string; end: string; complete: boolean }; statistics?: SnapshotReport | null; retention?: SnapshotReport | null }[];
  breakdowns?: { name: string; report: SnapshotReport | null }[];
  reach?: { status?: string; note?: string; days?: { start: string; end: string; rows: Record<string, string>[] }[] } | null;
}

export interface ReachTotals {
  impressions: number;
  /** Impressions click-through rate as a percentage (4.5 means 4.5%), or null when there were no impressions. */
  ctrPercent: number | null;
  /** The days covered, as YouTube labels them (start of the first, end of the last). */
  from: string; to: string; days: number;
}

export interface PeriodStats {
  name: string; start: string; end: string; complete: boolean;
  views: number | null; watchHours: number | null; averageViewSeconds: number | null; averageViewPercent: number | null;
  likes: number | null; comments: number | null; shares: number | null; subscribersNet: number | null;
  /** Audience retention: share of viewers still watching (1 = 100%) at each point of the video (0 = start, 1 = end). */
  retention: { at: number; watching: number }[];
}

export interface Breakdown { label: string; views: number; share: number }
export interface StatsSummary { periods: PeriodStats[]; trafficSources: Breakdown[]; devices: Breakdown[]; countries: Breakdown[]; reach: ReachTotals | null; reachStatus: string; reachNote: string }

const number = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The column's position, found by name (YouTube's column headers are objects with a `name`). */
function column(report: SnapshotReport | null | undefined, name: string): number {
  return (report?.columns ?? []).findIndex(c => (c && typeof c === 'object' ? (c as { name?: unknown }).name : c) === name);
}

/**
 * Totals across every day of YouTube's reach reports. CTR is weighted by impressions (a day with 1,000 impressions
 * counts more than a day with 10), which is how YouTube Studio adds it up too.
 */
export function reachTotals(reach: SnapshotLike['reach'], videoId?: string): ReachTotals | null {
  const days = (reach?.days ?? []).filter(day => day.rows?.length);
  let impressions = 0; let clicks = 0; let from = ''; let to = '';
  for (const day of days) {
    for (const row of day.rows) {
      if (videoId && row.video_id && row.video_id !== videoId) continue;
      const shown = number(row.video_thumbnail_impressions); const rate = number(row.video_thumbnail_impressions_ctr);
      if (shown === null) continue;
      impressions += shown;
      // YouTube gives CTR as a fraction (0.045); a value above 1 is taken to be a percentage already.
      if (rate !== null) clicks += shown * (rate > 1 ? rate / 100 : rate);
    }
    if (!from || day.start < from) from = day.start;
    if (!to || day.end > to) to = day.end;
  }
  if (!days.length) return null;
  return { impressions, ctrPercent: impressions ? (clicks / impressions) * 100 : null, from, to, days: days.length };
}

const TRAFFIC_NAMES: Record<string, string> = {
  ADVERTISING: 'YouTube Advertising', ANNOTATION: 'Annotations', CAMPAIGN_CARD: 'Campaign Cards', END_SCREEN: 'End Screens',
  EXT_URL: 'External', HASHTAGS: 'Hashtag Pages', LIVE_REDIRECT: 'Live Redirects', NO_LINK_EMBEDDED: 'Embedded Players',
  NO_LINK_OTHER: 'Direct or Unknown', NOTIFICATION: 'Notifications', PLAYLIST: 'Playlists', PRODUCT_PAGE: 'Product Pages',
  PROMOTED: 'Promoted', RELATED_VIDEO: 'Suggested Videos', SHORTS: 'Shorts Feed', SHORTS_CONTENT_LINKS: 'Shorts Links',
  SOUND_PAGE: 'Sound Pages', SUBSCRIBER: 'Browse Features (Subscribers)', BROWSE: 'Browse Features', YT_CHANNEL: 'Channel Pages',
  YT_OTHER_PAGE: 'Other YouTube Pages', YT_PLAYLIST_PAGE: 'Playlist Pages', YT_SEARCH: 'YouTube Search', VIDEO_REMIXES: 'Remixes',
};
const DEVICE_NAMES: Record<string, string> = { MOBILE: 'Phone', DESKTOP: 'Computer', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Game Console', UNKNOWN_PLATFORM: 'Unknown' };
const titleCase = (code: string) => code.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function breakdown(snapshot: SnapshotLike, name: string, names: Record<string, string>, keepCodes = false): Breakdown[] {
  const report = snapshot.breakdowns?.find(b => b.name === name)?.report;
  const viewsAt = column(report, 'views');
  if (!report?.rows?.length || viewsAt < 0) return [];
  const items = report.rows.map(row => ({ code: String(row[0] ?? ''), views: number(row[viewsAt]) ?? 0 })).filter(item => item.code && item.views > 0);
  const total = items.reduce((sum, item) => sum + item.views, 0);
  return items.sort((a, b) => b.views - a.views).map(item => ({ label: names[item.code] ?? (keepCodes ? item.code : titleCase(item.code)), views: item.views, share: total ? item.views / total : 0 }));
}

export function summarizeSnapshot(snapshot: SnapshotLike): StatsSummary {
  const periods = (snapshot.periods ?? []).map(({ period, statistics, retention }) => {
    const row = statistics?.rows?.[0];
    const get = (name: string) => { const at = column(statistics, name); return row && at >= 0 ? number(row[at]) : null; };
    const minutes = get('estimatedMinutesWatched'); const gained = get('subscribersGained'); const lost = get('subscribersLost');
    const atRatio = column(retention, 'elapsedVideoTimeRatio'); const atWatch = column(retention, 'audienceWatchRatio');
    const curve = atRatio < 0 || atWatch < 0 ? [] : (retention?.rows ?? []).flatMap(r => { const at = number(r[atRatio]); const watching = number(r[atWatch]); return at === null || watching === null ? [] : [{ at, watching }]; }).sort((a, b) => a.at - b.at);
    return {
      name: period.name, start: period.start, end: period.end, complete: period.complete,
      views: row ? get('views') ?? 0 : null, watchHours: minutes === null ? null : minutes / 60,
      averageViewSeconds: get('averageViewDuration'), averageViewPercent: get('averageViewPercentage'),
      likes: get('likes'), comments: get('comments'), shares: get('shares'),
      subscribersNet: gained === null && lost === null ? null : (gained ?? 0) - (lost ?? 0),
      retention: curve,
    };
  });
  return {
    periods,
    trafficSources: breakdown(snapshot, 'Traffic Sources', TRAFFIC_NAMES),
    devices: breakdown(snapshot, 'Devices', DEVICE_NAMES),
    countries: breakdown(snapshot, 'Countries', {}, true),
    reach: reachTotals(snapshot.reach, snapshot.videoId),
    reachStatus: snapshot.reach?.status ?? 'missing',
    reachNote: snapshot.reach?.note ?? '',
  };
}
