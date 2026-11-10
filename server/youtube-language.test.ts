import { afterEach, describe, expect, it, vi } from 'vitest';
import { setVideoLanguage, videoLanguage } from './youtube-language';
afterEach(() => vi.unstubAllGlobals());
describe('YouTube video language', () => {
  it('defaults to US English and rejects unsupported values', () => {
    expect(videoLanguage(undefined)).toBe('en-US');
    expect(videoLanguage('en-GB')).toBe('en-GB');
    expect(() => videoLanguage('anything')).toThrow();
  });
  it('preserves existing editable metadata when updating the language', async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ etag: 'etag', snippet: { title: 'Title', description: 'Description', categoryId: '22', tags: ['tag'], defaultLanguage: 'en', localized: { title: 'read only' } } }] })).mockResolvedValueOnce(Response.json({ snippet: { defaultAudioLanguage: 'en-US' } }));
    vi.stubGlobal('fetch', mock);
    await setVideoLanguage('token', 'video-id', 'en-US');
    const update = mock.mock.calls[1][1];
    expect(update.headers['If-Match']).toBe('etag');
    expect(JSON.parse(update.body).snippet).toEqual({ title: 'Title', description: 'Description', categoryId: '22', tags: ['tag'], defaultLanguage: 'en', defaultAudioLanguage: 'en-US' });
  });
  it('does not claim success if YouTube does not confirm the spoken language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ items: [{ etag: 'etag', snippet: { title: 'Title', categoryId: '22' } }] })).mockResolvedValueOnce(Response.json({ snippet: {} })));
    await expect(setVideoLanguage('token', 'id', 'en-US')).rejects.toThrow(/did not confirm/);
  });
});
