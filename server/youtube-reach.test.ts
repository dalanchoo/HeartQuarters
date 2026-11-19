import { beforeEach, describe, expect, it } from 'vitest';
import { getReachData, parseReachCsv } from './youtube-reach.js';
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
