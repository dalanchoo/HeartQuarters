// The daily YouTube quota count. Fake fetch only; tests never write the app's data folder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTA_USED_UP, minutesUntilReset, pacificDay, resetQuotaForTests, youtubeCost, youtubeFetch, youtubeQuota } from './youtube-quota';

beforeEach(() => resetQuotaForTests());
afterEach(() => vi.unstubAllGlobals());

describe('YouTube quota', () => {
  it("knows YouTube's published cost of each request", () => {
    const api = 'https://www.googleapis.com/youtube/v3';
    expect(youtubeCost(`${api}/videos?id=x`)).toBe(1);
    expect(youtubeCost(`${api}/videos?part=snippet`, 'PUT')).toBe(50);
    expect(youtubeCost(`${api}/captions?videoId=x`)).toBe(50);
    expect(youtubeCost('https://www.googleapis.com/upload/youtube/v3/captions?part=snippet', 'POST')).toBe(400);
    expect(youtubeCost('https://www.googleapis.com/upload/youtube/v3/captions?part=snippet', 'PUT')).toBe(450);
    expect(youtubeCost('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=x', 'POST')).toBe(50);
    expect(youtubeCost(`${api}/playlistItems?part=id`)).toBe(1);
    expect(youtubeCost(`${api}/playlistItems?part=snippet`, 'POST')).toBe(50);
    expect(youtubeCost(`${api}/playlistItems?id=x`, 'DELETE')).toBe(50);
    expect(youtubeCost('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable', 'POST')).toBe(0);
    expect(youtubeCost('https://oauth2.googleapis.com/token', 'POST')).toBe(0);
  });

  it('adds up what HeartQuarters spends today', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({})));
    await youtubeFetch('https://www.googleapis.com/youtube/v3/videos?id=x');
    await youtubeFetch('https://www.googleapis.com/youtube/v3/captions?videoId=x');
    expect(youtubeQuota()).toMatchObject({ used: 51, limit: 10000, exhausted: false });
  });

  it("turns YouTube's quota error into one plain message and remembers it", async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 })));
    await expect(youtubeFetch('https://www.googleapis.com/youtube/v3/videos?id=x')).rejects.toThrow(QUOTA_USED_UP);
    expect(youtubeQuota().exhausted).toBe(true);
    // After that it doesn't ask YouTube again today.
    await expect(youtubeFetch('https://www.googleapis.com/youtube/v3/videos?id=y')).rejects.toThrow(QUOTA_USED_UP);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the Pacific-time day, which starts again at midnight there', () => {
    const lateEvening = new Date('2026-11-13T07:30:00Z'); // 11:30 PM Pacific on November 12
    expect(pacificDay(lateEvening)).toBe('2026-11-12');
    expect(minutesUntilReset(lateEvening)).toBe(30);
  });
});
