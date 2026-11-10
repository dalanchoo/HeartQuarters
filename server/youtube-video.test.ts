import { afterEach, describe, expect, it, vi } from 'vitest';
import { readYoutubeVideo, updateYoutubeVideo, youtubeVideoId } from './youtube-video';
afterEach(() => vi.unstubAllGlobals());
const resource = { etag: 'tag', snippet: { title: 'Original', description: 'Text', categoryId: '22', tags: ['tag'], defaultAudioLanguage: 'en-US' }, status: { privacyStatus: 'private', license: 'youtube', embeddable: true, publicStatsViewable: true, selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
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
