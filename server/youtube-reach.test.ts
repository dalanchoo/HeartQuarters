import { beforeEach, describe, expect, it } from 'vitest';
import { getReachData, parseReachCsv, reportingError } from './youtube-reach.js';
import { resetQuotaForTests, youtubeQuota } from './youtube-quota.js';

beforeEach(() => resetQuotaForTests());
describe('YouTube reach reports', () => {
  it('reads quoted CSV fields and rejects missing reach columns', () => {
    expect(parseReachCsv('video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr,note\nabcdefghijk,100,3.2,"hello, world"\n')[0].note).toBe('hello, world');
    expect(() => parseReachCsv('video_id,views\na,1')).toThrow('unexpected columns');
  });
  it('creates a job and reports when YouTube has not prepared reports yet', async () => {
    const requests: string[] = [];
    const result = await getReachData('test', 'abcdefghijk', async (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') return Response.json({ id: 'job-1', reportTypeId: 'channel_reach_basic_a1' });
      return Response.json(url.includes('/reports?') ? { reports: [] } : { jobs: [] });
    });
    expect(result.status).toBe('pending'); expect(requests).toHaveLength(3); expect(youtubeQuota().reportingUsed).toBe(3);
  });
  it('uses the latest backfilled report, filters by video and refuses an unsafe download URL', async () => {
    const base = { id: 'r', startTime: '2026-11-01', endTime: '2026-11-02', createTime: '2026-11-03', downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/report' };
    let downloads = 0;
    const result = await getReachData('test', 'abcdefghijk', async url => {
      if (url.includes('/media/')) { downloads++; return new Response('video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\nabcdefghijk,100,3.2\nother,20,1\n'); }
      if (url.includes('/reports?')) return Response.json({ reports: [base, { ...base, id: 'new', createTime: '2026-11-04' }] });
      return Response.json({ jobs: [{ id: 'job', reportTypeId: 'channel_reach_basic_a1' }] });
    });
    expect(downloads).toBe(1); expect(result.days[0].rows).toHaveLength(1); expect(result.days[0].rows[0].video_thumbnail_impressions).toBe('100');
    await expect(getReachData('test', undefined, async url => url.includes('/reports?') ? Response.json({ reports: [{ ...base, downloadUrl: 'https://evil.example/file' }] }) : Response.json({ jobs: [{ id: 'job', reportTypeId: 'channel_reach_basic_a1' }] }))).rejects.toThrow('unsafe');
  });
});

describe('reporting error messages', () => {
  it('says to turn on the Reporting API when Google reports it is disabled', () => {
    const body = JSON.stringify({ error: { code: 403, message: 'YouTube Reporting API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', metadata: { activationUrl: 'https://console.developers.google.com/apis/api/youtubereporting.googleapis.com/overview?project=123' } }] } });
    const text = reportingError(403, body);
    expect(text).toContain('turned off');
    expect(text).toContain('https://console.developers.google.com/apis/api/youtubereporting.googleapis.com/overview?project=123');
  });
  it('does not show a link that is not a Google console page', () => {
    const body = JSON.stringify({ error: { message: 'is disabled', details: [{ reason: 'SERVICE_DISABLED', metadata: { activationUrl: 'https://evil.example/' } }] } });
    expect(reportingError(403, body)).not.toContain('evil');
  });
  it('says to sign in again when the permission is missing', () => {
    expect(reportingError(403, JSON.stringify({ error: { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }))).toContain('Sign in to YouTube again');
  });
  it("keeps Google's own message for anything else", () => {
    expect(reportingError(403, JSON.stringify({ error: { message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }))).toBe('YouTube Reporting returned 403: The caller does not have permission (PERMISSION_DENIED).');
    expect(reportingError(500, 'oops')).toBe('YouTube Reporting returned 500.');
  });
});
