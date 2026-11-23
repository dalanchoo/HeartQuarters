import { listDailyReports, readReportingRows, type ReportingFetch } from './youtube-reach.js';

// YouTube lists this version for the connected channel; it returns 404 for the newer version.
const REPORT_TYPE = 'channel_end_screens_a1';
const COLUMNS = ['video_id', 'end_screen_element_id', 'end_screen_element_type', 'end_screen_element_impressions', 'end_screen_element_clicks'];
const ELEMENT_TYPES: Record<string, string> = {
  '501': 'Video', '502': 'Playlist', '503': 'Website', '504': 'Channel', '505': 'Subscribe',
  '506': 'Associated', '507': 'Crowdfunding', '508': 'Merchandise', '509': 'Recent Upload', '510': 'Best for Viewer',
};
const MAX_REPORT_DAYS = 60;

export interface EndScreenElement { id: string; type: string; impressions: number; clicks: number }
export type EndScreenData =
  | { status: 'pending' | 'unavailable'; note: string }
  | { status: 'ready'; startDate: string; endDate: string; reportedDays: number; videos: Record<string, EndScreenElement[]>; note?: string };

export async function getEndScreenData(token: string, fetcher: ReportingFetch = fetch): Promise<EndScreenData> {
  const reports = await listDailyReports(token, REPORT_TYPE, 'End Screens', fetcher);
  const recent = reports.slice(0, MAX_REPORT_DAYS);
  if (!recent.length) return { status: 'pending', note: 'YouTube is preparing end screen data. Refresh again in a day or two.' };

  const videos = new Map<string, Map<string, EndScreenElement>>();
  for (const report of recent) {
    const rows = await readReportingRows(token, report.downloadUrl, COLUMNS, 'end screen', fetcher);
    for (const row of rows) {
      const { video_id: videoId, end_screen_element_id: id, end_screen_element_type: type } = row;
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !id) continue;
      const impressions = Number(row.end_screen_element_impressions || NaN);
      const clicks = Number(row.end_screen_element_clicks || NaN);
      if (!Number.isSafeInteger(impressions) || impressions < 0 || !Number.isSafeInteger(clicks) || clicks < 0) continue;

      const elements = videos.get(videoId) ?? new Map<string, EndScreenElement>();
      const element = elements.get(id) ?? {
        id, type: Object.hasOwn(ELEMENT_TYPES, type) ? ELEMENT_TYPES[type] : 'Unknown Element', impressions: 0, clicks: 0,
      };
      element.impressions += impressions;
      element.clicks += clicks;
      elements.set(id, element);
      videos.set(videoId, elements);
    }
  }
  return {
    status: 'ready',
    startDate: recent.at(-1)!.startTime.slice(0, 10),
    endDate: recent[0].startTime.slice(0, 10),
    reportedDays: recent.length,
    videos: Object.fromEntries([...videos].map(([id, elements]) => [id, [...elements.values()].sort((a, b) => b.clicks - a.clicks)])),
  };
}
