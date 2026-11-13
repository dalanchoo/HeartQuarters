import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetQuotaForTests } from './youtube-quota';
import { QUOTA_USED_UP, readYoutubeVideo, readYoutubeVideos, updateYoutubeVideo, youtubeVideoId } from './youtube-video';
afterEach(() => { vi.unstubAllGlobals(); resetQuotaForTests(); });
const resource = { etag: 'tag', snippet: { title: 'Original', description: 'Text', categoryId: '22', tags: ['tag'], defaultAudioLanguage: 'en-US' }, status: { privacyStatus: 'private', license: 'youtube', embeddable: true, publicStatsViewable: true, selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
describe('checking many videos at once', () => {
  it('asks for 50 videos per request and leaves out the ones YouTube does not return', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `video${String(i).padStart(6, '0')}`);
    const mock = vi.fn().mockImplementation(async (url: string) => {
      const asked = decodeURIComponent(new URL(url).searchParams.get('id') ?? '').split(',');
      return Response.json({ items: asked.filter((id) => id !== 'video000007').map((id) => ({ ...resource, id })) });
    });
    vi.stubGlobal('fetch', mock);
    const videos = await readYoutubeVideos('token', ids);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(Object.keys(videos)).toHaveLength(59);
    expect(videos.video000007).toBeUndefined();
    expect(videos.video000059.title).toBe('Original');
  });
  it('says plainly when the daily quota is used up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 })));
    await expect(readYoutubeVideos('token', ['abc'])).rejects.toThrow(QUOTA_USED_UP);
    await expect(readYoutubeVideo('token', 'abc')).rejects.toThrow(QUOTA_USED_UP);
  });
});

describe('YouTube video settings', () => {
  it('accepts YouTube watch and Shorts links, rejecting unrelated sites', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=Abc_123-xyz')).toBe('Abc_123-xyz');
    expect(youtubeVideoId('https://youtube.com/shorts/Abc_123-xyz')).toBe('Abc_123-xyz');
    expect(youtubeVideoId('https://youtu.be/Abc_123-xyz?t=3')).toBe('Abc_123-xyz');
    expect(() => youtubeVideoId('https://youtube.com.example.com/watch?v=Abc_123-xyz')).toThrow();
  });
  it('reads owner settings without guessing missing answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ items: [resource] })));
    const { settings } = await readYoutubeVideo('token', 'id');
    expect(settings).toMatchObject({ title: 'Original', madeForKids: false, synthetic: true, privacy: 'private' });
  });
  it('reports a custom thumbnail only when YouTube confirms it', async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ ...resource, contentDetails: { hasCustomThumbnail: true } }] })).mockResolvedValueOnce(Response.json({ items: [resource] }));
    vi.stubGlobal('fetch', mock);
    expect((await readYoutubeVideo('token', 'id')).settings.customThumbnail).toBe(true);
    expect((await readYoutubeVideo('token', 'id')).settings.customThumbnail).toBeNull();
  });
  it('prefers the portrait Short image, then the largest available thumbnail', async () => {
    const withThumbnails = { ...resource, snippet: { ...resource.snippet, thumbnails: { medium: { url: 'medium' }, maxres: { url: 'large' }, shortsAspectRatio: { url: 'portrait' } } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ items: [withThumbnails] })).mockResolvedValueOnce(Response.json({ items: [{ ...withThumbnails, snippet: { ...withThumbnails.snippet, thumbnails: { medium: { url: 'medium' }, maxres: { url: 'large' } } } }] })));
    expect((await readYoutubeVideo('token', 'id')).settings.thumbnail).toBe('portrait');
    expect((await readYoutubeVideo('token', 'id')).settings.thumbnail).toBe('large');
  });
  it('preserves other status properties and sends the original etag when saving', async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ items: [resource] })).mockResolvedValueOnce(Response.json({ status: resource.status }));
    vi.stubGlobal('fetch', mock);
    const baseline = { etag: 'tag', title: 'Original', description: 'Text', tags: ['tag'], language: 'en-US', privacy: 'private' as const, madeForKids: false, synthetic: true, thumbnail: null };
    await updateYoutubeVideo('token', 'id', baseline, { ...baseline, synthetic: false });
    expect(mock.mock.calls[1][1].headers['If-Match']).toBe('tag');
    expect(JSON.parse(mock.mock.calls[1][1].body).status).toMatchObject({ privacyStatus: 'private', license: 'youtube', embeddable: true, publicStatsViewable: true, containsSyntheticMedia: false, selfDeclaredMadeForKids: false });
  });
  it('refuses to overwrite a video changed in Studio', async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ ...resource, etag: 'new' }] })); vi.stubGlobal('fetch', mock);
    const baseline = { etag: 'old', title: 'Original', description: 'Text', tags: ['tag'], language: 'en-US', privacy: 'private' as const, madeForKids: false, synthetic: true, thumbnail: null };
    await expect(updateYoutubeVideo('token', 'id', baseline, { ...baseline, title: 'New' })).rejects.toThrow(/changed on YouTube/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('does not pretend that an existing answer was cleared', async () => {
    const baseline = { etag: 'tag', title: 'Original', description: 'Text', tags: ['tag'], language: 'en-US', privacy: 'private' as const, madeForKids: false, synthetic: true, thumbnail: null };
    await expect(updateYoutubeVideo('token', 'id', baseline, { ...baseline, synthetic: null })).rejects.toThrow(/instead of clearing/);
  });
});
