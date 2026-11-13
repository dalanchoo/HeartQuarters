import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedYoutube } from './youtubeCache';

afterEach(() => vi.unstubAllGlobals());

describe('remembering what was read from YouTube', () => {
  it('asks YouTube once, again only when told to, and not after a failed read', async () => {
    vi.stubGlobal('window', { dispatchEvent: () => true });
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(async () => (n++ === 0 ? Response.json({ error: 'quota' }, { status: 400 }) : Response.json({ title: `read ${n}` })));
    vi.stubGlobal('fetch', fetchMock);
    const url = '/api/youtube/channel?test=1';
    await expect(cachedYoutube(url)).rejects.toThrow('quota');
    expect(await cachedYoutube<{ title: string }>(url)).toEqual({ title: 'read 2' });
    expect(await cachedYoutube<{ title: string }>(url)).toEqual({ title: 'read 2' }); // closing and reopening: no new read
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await cachedYoutube<{ title: string }>(url, true)).toEqual({ title: 'read 3' }); // Reload from YouTube
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
