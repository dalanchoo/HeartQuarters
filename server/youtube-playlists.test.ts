import { afterEach, describe, expect, it, vi } from 'vitest';
import { addYoutubePlaylist, checkPlaylistIds, listYoutubePlaylists } from './youtube-playlists';
afterEach(() => vi.unstubAllGlobals());
describe('YouTube playlists', () => {
  it('loads every page of playlists and preserves their current names', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ id: 'one', snippet: { title: 'First' } }], nextPageToken: 'next' })).mockResolvedValueOnce(Response.json({ items: [{ id: 'two', snippet: { title: 'Renamed' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await listYoutubePlaylists('token')).toEqual([{ id: 'one', title: 'First' }, { id: 'two', title: 'Renamed' }]);
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=next');
  });
  it('checks for the video before adding, so retries do not duplicate it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ id: 'already' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await addYoutubePlaylist('token', 'playlist', 'video');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('adds the video if it is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ items: [] })).mockResolvedValueOnce(Response.json({ id: 'added' }));
    vi.stubGlobal('fetch', fetchMock);
    await addYoutubePlaylist('token', 'playlist', 'video');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).snippet).toEqual({ playlistId: 'playlist', resourceId: { kind: 'youtube#video', videoId: 'video' } });
  });
  it('rejects invalid playlist IDs', () => {
    expect(checkPlaylistIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(() => checkPlaylistIds(['../bad'])).toThrow();
  });
});
