import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from './testing';
import { config } from './config';
import { linkYoutubeVideo, syncYoutubeSettings } from './youtube';
import type { YoutubeVideoSettings } from './youtube-video';

const mocks = vi.hoisted(() => ({ update: vi.fn(async () => {}), read: vi.fn(), list: vi.fn(async () => [{ id: 'p', title: 'Playlist' }]), items: vi.fn(async () => [] as string[]), add: vi.fn(async () => {}) }));
vi.mock('./youtube-auth', () => ({ youtubeAccessToken: vi.fn(async () => 'token'), youtubeStatus: vi.fn(() => ({ captionAccess: true })) }));
vi.mock('./youtube-video', async (original) => ({ ...(await original<typeof import('./youtube-video')>()), updateYoutubeVideo: mocks.update, readYoutubeVideo: mocks.read, youtubeCaptionTracks: vi.fn() }));
vi.mock('./youtube-playlists', async (original) => ({ ...(await original<typeof import('./youtube-playlists')>()), listYoutubePlaylists: mocks.list, playlistVideoItems: mocks.items, addYoutubePlaylist: mocks.add }));
let tmp: string; let oldRoot: string;
const settings: YoutubeVideoSettings = { etag: 'e', title: 'Title', description: 'Text', tags: [], language: 'en-US', privacy: 'private', madeForKids: false, synthetic: null, thumbnail: null };
beforeEach(() => { tmp = makeTree({ 'videos/piece/': '', 'jobs/abc-123.json': JSON.stringify({ id: 'abc-123', piece: 'piece', video: 'piece/Exports/x.mp4', videoId: 'youtube-id', status: 'done', total: 1, sent: 1 }) }); oldRoot = config.videoProjectsDir; config.videoProjectsDir = path.join(tmp, 'videos'); process.env.HQ_YOUTUBE_JOBS_DIR = path.join(tmp, 'jobs'); vi.clearAllMocks(); });
afterEach(() => { config.videoProjectsDir = oldRoot; delete process.env.HQ_YOUTUBE_JOBS_DIR; vi.unstubAllGlobals(); removeTree(tmp); });
describe('saving the combined YouTube form', () => {
  it('only links an existing video that belongs to the connected channel', async () => {
    mocks.read.mockResolvedValue({ resource: { snippet: { channelId: 'mine' } } });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ items: [{ id: 'mine', snippet: { title: 'Mine' } }] })));
    const linked = await linkYoutubeVideo('piece', 'https://youtu.be/Abc_123-xyz');
    expect(linked.videoId).toBe('Abc_123-xyz');
    mocks.read.mockResolvedValue({ resource: { snippet: { channelId: 'other' } } });
    await expect(linkYoutubeVideo('piece', 'https://youtu.be/Another_123')).rejects.toThrow(/not on the connected/);
  });
  it('saves video settings and only the changed playlist selections', async () => {
    mocks.items.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(['item']);
    expect(await syncYoutubeSettings('piece', 'abc-123', settings, { ...settings, title: 'New' }, [], ['p'], '', '')).toEqual({ errors: [] });
    expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.add).toHaveBeenCalledWith('token', 'p', 'youtube-id');
  });
  it('stops before changing metadata if a selected playlist changed in Studio', async () => {
    mocks.items.mockResolvedValueOnce([]);
    await expect(syncYoutubeSettings('piece', 'abc-123', settings, settings, ['p'], [], '', '')).rejects.toThrow(/changed in Studio/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not guess playlist choices if they were not loaded', async () => {
    await expect(syncYoutubeSettings('piece', 'abc-123', settings, settings, undefined, undefined, '', '')).rejects.toThrow(/playlists first/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
