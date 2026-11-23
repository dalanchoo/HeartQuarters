import { expect, it } from 'vitest';
import { getEndScreenData } from './youtube-end-screens.js';

const type = 'channel_end_screens_a1';
const job = { id: 'end-screens', reportTypeId: type };
const header = 'video_id,end_screen_element_id,end_screen_element_type,end_screen_element_impressions,end_screen_element_clicks,country_code\n';
const video = 'abcdefghijk';
const report = (day: number, version: number, url: string) => ({
  id: url,
  startTime: `2026-11-${day}T08:00:00Z`,
  endTime: `2026-11-${day + 1}T08:00:00Z`,
  createTime: `2026-11-${version}T08:00:00Z`,
  downloadUrl: `https://youtubereporting.googleapis.com/v1/media/${url}`,
});

it('requests the end screen report once and returns pending while YouTube prepares it', async () => {
  let jobCreated = false;
  const data = await getEndScreenData('test-token', async (url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token');
    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ reportTypeId: type, name: 'HeartQuarters End Screens' });
      jobCreated = true;
      return Response.json(job);
    }
    return Response.json(url.includes('/reports?') ? { reports: [] } : { jobs: [] });
  });
  expect(jobCreated).toBe(true);
  expect(data.status).toBe('pending');
});

it('totals each distinct element across dates and viewer groups using only the latest report for a day', async () => {
  const downloads: string[] = [];
  const media: Record<string, string> = {
    latest: `${video},a,501,20,2,US\n${video},a,501,10,1,CA\n${video},b,501,15,0,US\n,a,501,2,1,US\n${video},bad,501,1.5,1,US\n`,
    earlier: `${video},a,501,10,1,US\n${video},c,502,30,6,US\n`,
    empty: '',
  };
  const data = await getEndScreenData('test-token', async (url, init) => {
    expect(init?.method).toBeUndefined();
    if (url.includes('/reports?')) return Response.json({ reports: [
      report(12, 13, 'stale'), report(10, 11, 'empty'), report(11, 12, 'earlier'), report(12, 14, 'latest'),
    ] });
    if (url.includes('/jobs?')) return Response.json({ jobs: [job] });
    const name = url.split('/').at(-1)!;
    downloads.push(name);
    return new Response(header + media[name]);
  });
  expect(downloads).toEqual(['latest', 'earlier', 'empty']);
  expect(data).toEqual({ status: 'ready', startDate: '2026-11-10', endDate: '2026-11-12', reportedDays: 3, videos: {
    [video]: [
      { id: 'c', type: 'Playlist', impressions: 30, clicks: 6 },
      { id: 'a', type: 'Video', impressions: 40, clicks: 4 },
      { id: 'b', type: 'Video', impressions: 15, clicks: 0 },
    ],
  } });
});

it('rejects a download outside YouTube before sending authorization', async () => {
  const unsafe = { ...report(12, 13, 'unsafe'), downloadUrl: 'https://example.com/report' };
  const requested: string[] = [];
  await expect(getEndScreenData('test-token', async (url) => {
    requested.push(url);
    return Response.json(url.includes('/reports?') ? { reports: [unsafe] } : { jobs: [job] });
  })).rejects.toThrow('unsafe reporting URL');
  expect(requested).toHaveLength(2);
});
