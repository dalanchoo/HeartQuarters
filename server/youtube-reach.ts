// YouTube Reporting API reach data. Reports arrive asynchronously and may have limited history.
import { recordReportingUse } from './youtube-quota.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Job = { id: string; reportTypeId: string; expireTime?: string };
type Report = { id: string; startTime: string; endTime: string; createTime: string; downloadUrl: string };
export interface ReachData { status: 'pending' | 'ready'; note: string; days: { start: string; end: string; rows: Record<string, string>[] }[]; truncated: boolean }
const API = 'https://youtubereporting.googleapis.com/v1';
const TYPE = 'channel_reach_basic_a1';
let jobLock: Promise<void> = Promise.resolve();

/** RFC 4180 CSV fields, including quoted commas and line breaks. */
export function parseReachCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) { if (c === '"' && csv[i + 1] === '"') { value += '"'; i++; } else if (c === '"') quoted = false; else value += c; }
    else if (c === '"' && !value) quoted = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('YouTube returned an incomplete CSV report.');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift()?.map((h, i) => i === 0 ? h.replace(/^\uFEFF/, '') : h) ?? [];
  if (!['video_id', 'video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'].every(h => headers.includes(h))) throw new Error('YouTube returned a reach report with unexpected columns.');
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

async function request(fetcher: Fetch, token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'youtubereporting.googleapis.com' || parsed.port || parsed.username || parsed.password) throw new Error('YouTube returned an unsafe reporting URL.');
  recordReportingUse();
  const response = await fetcher(url, { ...init, redirect: 'error', headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (!response.ok) throw new Error(reportingError(response.status, await response.text().catch(() => '')));
  return response;
}

/**
 * Turns Google's error reply into a message that says what to do. Google's own reason is kept, because a 403 can mean
 * very different things: the Reporting API is turned off in the Google Cloud project, the sign-in lacks permission, ...
 */
export function reportingError(status: number, body: string): string {
  let message = ''; let reason = ''; let activation = '';
  try {
    const error = (JSON.parse(body) as { error?: { message?: unknown; status?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown; metadata?: Record<string, unknown> }[] } }).error;
    message = typeof error?.message === 'string' ? error.message : '';
    const info = error?.details?.find(d => typeof d.reason === 'string');
    reason = typeof info?.reason === 'string' ? info.reason : typeof error?.errors?.[0]?.reason === 'string' ? String(error.errors[0].reason) : typeof error?.status === 'string' ? error.status : '';
    const url = info?.metadata?.activationUrl;
    if (typeof url === 'string' && /^https:\/\/console\.(?:developers|cloud)\.google\.com\//.test(url)) activation = url;
  } catch { /* not JSON: keep the plain status */ }
  if (reason === 'SERVICE_DISABLED' || reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(message))
    return `The YouTube Reporting API is turned off in your Google Cloud project, so YouTube won't send impressions and CTR. Turn it on${activation ? ` at ${activation}` : ' in the Google Cloud console (APIs & Services → Library → YouTube Reporting API)'}, wait a few minutes, then download the stats again.`;
  if (reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || reason === 'insufficientPermissions' || /insufficient authentication scopes/i.test(message))
    return 'The YouTube sign-in does not include analytics permission. Sign in to YouTube again in HeartQuarters, allow every permission it asks for, then download the stats again.';
  return `YouTube Reporting returned ${status}${message ? `: ${message}` : ''}${reason && !message.includes(reason) ? ` (${reason})` : ''}.`;
}

/** Starts or reuses a channel-wide reach job, then reads the latest available daily reports. */
export async function getReachData(token: string, videoId?: string, fetcher: Fetch = fetch): Promise<ReachData> {
  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid video ID.');
  const previous = jobLock; let release!: () => void;
  jobLock = new Promise<void>(resolve => { release = resolve; });
  await previous;
  let job: Job | undefined;
  try {
  const jobs: Job[] = []; let page = '';
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ pageSize: '100', ...(page ? { pageToken: page } : {}) });
    const data = await (await request(fetcher, token, `${API}/jobs?${q}`)).json() as { jobs?: Job[]; nextPageToken?: string };
    jobs.push(...(data.jobs ?? [])); page = data.nextPageToken ?? ''; if (!page) break;
  }
  if (page) throw new Error('Too many reporting jobs to safely locate the reach report.');
  job = jobs.find(item => item.reportTypeId === TYPE && (!item.expireTime || Date.parse(item.expireTime) > Date.now()));
  if (!job) {
    job = await (await request(fetcher, token, `${API}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportTypeId: TYPE, name: 'HeartQuarters Reach' }) })).json() as Job;
    if (!job.id || job.reportTypeId !== TYPE) throw new Error('YouTube did not confirm the reach reporting job.');
  }
  } finally { release(); }
  const reports: Report[] = []; let page = '';
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ pageSize: '100', ...(page ? { pageToken: page } : {}) });
    const data = await (await request(fetcher, token, `${API}/jobs/${encodeURIComponent(job.id)}/reports?${q}`)).json() as { reports?: Report[]; nextPageToken?: string };
    reports.push(...(data.reports ?? [])); page = data.nextPageToken ?? ''; if (!page) break;
  }
  if (page) throw new Error('Too many reach reports to retrieve safely.');
  // Backfilled reports replace older versions of the same day.
  const latest = new Map<string, Report>();
  for (const report of reports) {
    if (!report.startTime || !report.endTime || !report.createTime || !report.downloadUrl) continue;
    const key = `${report.startTime}/${report.endTime}`; const old = latest.get(key);
    if (!old || report.createTime > old.createTime) latest.set(key, report);
  }
  const ordered = [...latest.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));
  const days: ReachData['days'] = []; let count = 0; let bytes = 0; let truncated = ordered.length > 60;
  for (const report of ordered.slice(0, 60)) {
    const response = await request(fetcher, token, report.downloadUrl);
    const csv = await response.text();
    if (csv.length > 20_000_000) throw new Error('A reach report is too large to process safely.');
    const rows = parseReachCsv(csv).filter(row => !videoId || row.video_id === videoId);
    const kept: Record<string, string>[] = [];
    for (const row of rows) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (count >= 30_000 || bytes + size > 2_000_000) { truncated = true; break; }
      kept.push(row); count++; bytes += size;
    }
    days.push({ start: report.startTime, end: report.endTime, rows: kept });
    if (truncated && (count >= 30_000 || bytes >= 1_999_000 || kept.length < rows.length)) break;
  }
  return { status: days.length ? 'ready' : 'pending', note: days.length ? (count ? 'Daily reach rows as supplied by YouTube; coverage may be incomplete. CTR is the raw YouTube reporting value.' : 'Reports are available, but YouTube returned no reach rows for this selection.') : 'YouTube is preparing reach reports. Check again in a few days; historical coverage is limited.', days, truncated };
}
