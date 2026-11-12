import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { acknowledgeUpload, addPlaylists, addSubtitle, saveVideoPlaylists, startUpload, uploadsFor, validateUpload, type UploadInput } from './youtube';

vi.mock('./youtube-auth', () => ({ youtubeAccessToken: vi.fn(async () => 'fake-token'), youtubeStatus: vi.fn(() => ({ captionAccess: true })) }));
vi.mock('./youtube-language', () => ({ videoLanguage: (language?: string) => language ?? 'en-US', setVideoLanguage: vi.fn(async () => {}) }));
let tmp: string;
let original: string;
let input: UploadInput;
beforeEach(() => {
  tmp = makeTree({ 'Videos/001 - Test/Longform/Exports/test.mp4': 'fake video', 'Videos/001 - Test/Longform/Packaging/V01/cover.jpg': 'fake image', 'Videos/001 - Test/Longform/Subtitles/test.vtt': 'WEBVTT\n', 'Videos/other.mp4': 'other' });
  original = config.videoProjectsDir;
  config.videoProjectsDir = path.join(tmp, 'Videos');
  process.env.HQ_YOUTUBE_JOBS_DIR = path.join(tmp, 'jobs');
  input = { piece: '001 - Test/Longform', video: '001 - Test/Longform/Exports/test.mp4', cover: '001 - Test/Longform/Packaging/V01/cover.jpg', title: 'Test', description: 'Words', tags: ['one'], privacy: 'private', madeForKids: false, synthetic: false };
});
afterEach(() => { config.videoProjectsDir = original; delete process.env.HQ_YOUTUBE_JOBS_DIR; vi.unstubAllGlobals(); removeTree(tmp); });

describe('YouTube uploads', () => {
  it('accepts only this piece’s export and packaging image', () => {
    expect(validateUpload(input).size).toBe(10);
    expect(() => validateUpload({ ...input, video: 'other.mp4' })).toThrow(/Exports/);
    expect(() => validateUpload({ ...input, cover: 'other.mp4' })).toThrow(/cover/);
    expect(() => validateUpload({ ...input, video: '../../outside.mp4' })).toThrow();
  });
  it('requires valid metadata and explicit audience settings', () => {
    expect(() => validateUpload({ ...input, title: '' })).toThrow(/title/);
    expect(() => validateUpload({ ...input, madeForKids: undefined as unknown as boolean })).toThrow(/audience/);
    expect(() => validateUpload({ ...input, privacy: 'anything' as UploadInput['privacy'] })).toThrow(/visibility/);
  });
  it('uploads the original bytes and records the returned video ID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const job = uploadsFor(input.piece)[0];
    expect(job.status).toBe('done'); expect(job.videoId).toBe('youtube-id');
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body).status).toMatchObject({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
    expect(Buffer.from(fetchMock.mock.calls[1][1].body).toString()).toBe('fake video');
    expect(fs.readFileSync(path.join(tmp, 'Videos', input.video), 'utf8')).toBe('fake video');
  });
  it('records an uncertain result if the connection fails during upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } })).mockRejectedValueOnce(new Error('connection lost')));
    startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(uploadsFor(input.piece)[0].status).toBe('unknown');
    expect(() => startUpload(input)).toThrow(/YouTube Studio/);
    acknowledgeUpload(input.piece, uploadsFor(input.piece)[0].id);
    expect(uploadsFor(input.piece)[0].status).toBe('checked');
  });
  it('sends selected subtitles after the video, without changing the source file', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ id: 'caption-id' }));
    vi.stubGlobal('fetch', fetchMock);
    const subtitle = '001 - Test/Longform/Subtitles/test.vtt';
    startUpload({ ...input, subtitle });
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(uploadsFor(input.piece)[0].subtitleStatus).toBe('sent');
    expect(fetchMock.mock.calls[3][0]).toContain('/captions?');
    expect(Buffer.from(fetchMock.mock.calls[3][1].body).toString()).toContain('WEBVTT');
    expect(fs.readFileSync(path.join(tmp, 'Videos', subtitle), 'utf8')).toBe('WEBVTT\n');
  });
  it('adds captions to a completed upload without uploading its video again', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ id: 'caption-id' }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    mock.mockResolvedValueOnce(Response.json({ items: [] })).mockResolvedValueOnce(Response.json({ id: 'caption-id' }));
    await addSubtitle(input.piece, job.id, '001 - Test/Longform/Subtitles/test.vtt');
    expect(uploadsFor(input.piece)[0]).toMatchObject({ subtitleStatus: 'sent', subtitleAction: 'added', subtitleFile: '001 - Test/Longform/Subtitles/test.vtt' });
    expect(mock).toHaveBeenCalledTimes(5);
    expect(mock.mock.calls[4][1].method).toBe('POST');
  });
  it('replaces the captions it finds instead of adding a second track, and leaves automatic captions alone', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'auto-track', snippet: { language: 'en', trackKind: 'asr' } }, { id: 'mine', snippet: { language: 'en', trackKind: 'standard' } }, { id: 'french', snippet: { language: 'fr', trackKind: 'standard' } }] }))
      .mockResolvedValueOnce(Response.json({ id: 'mine' }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await addSubtitle(input.piece, job.id, '001 - Test/Longform/Subtitles/test.vtt', 'en-US');
    expect(uploadsFor(input.piece)[0]).toMatchObject({ subtitleStatus: 'sent', subtitleAction: 'replaced' });
    const [url, init] = mock.mock.calls[4];
    expect(url).toContain('/upload/youtube/v3/captions?');
    expect(init.method).toBe('PUT');
    const body = Buffer.from(init.body).toString();
    expect(body).toContain('"id":"mine"');
    expect(body).toContain('WEBVTT');
    expect(mock).toHaveBeenCalledTimes(5);
  });
  it('stops if more than one uploaded track would need replacing, sending nothing', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'a', snippet: { language: 'en-US', trackKind: 'standard' } }, { id: 'b', snippet: { language: 'en', trackKind: 'standard' } }] }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await addSubtitle(input.piece, job.id, '001 - Test/Longform/Subtitles/test.vtt');
    expect(uploadsFor(input.piece)[0]).toMatchObject({ subtitleStatus: 'error' });
    expect(uploadsFor(input.piece)[0].subtitleError).toMatch(/2 uploaded caption tracks.*Studio/);
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it('reports subtitle failure separately from the completed video upload', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error('caption connection lost'));
    vi.stubGlobal('fetch', mock);
    startUpload({ ...input, subtitle: '001 - Test/Longform/Subtitles/test.vtt' });
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(uploadsFor(input.piece)[0]).toMatchObject({ status: 'done', videoId: 'youtube-id', subtitleStatus: 'error', subtitleError: 'caption connection lost' });
  });
  it('adds an existing upload to selected playlists without uploading the video again', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'playlist', snippet: { title: 'My playlist' } }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ id: 'added' }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await addPlaylists(input.piece, job.id, ['playlist']);
    expect(uploadsFor(input.piece)[0].playlistResults).toEqual([{ id: 'playlist', status: 'added' }]);
    expect(mock).toHaveBeenCalledTimes(6);
  });
  it('saves additions and removals without changing other playlist entries', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'keep', snippet: { title: 'Keep' } }, { id: 'remove', snippet: { title: 'Remove' } }, { id: 'add', snippet: { title: 'Add' } }] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'keep-item' }] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'remove-item' }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ id: 'new-item' }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'new-item' }] }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await saveVideoPlaylists(input.piece, job.id, ['keep', 'remove'], ['keep', 'add'])).toEqual({ errors: [] });
    const deletions = mock.mock.calls.filter((call) => call[1]?.method === 'DELETE');
    expect(deletions).toHaveLength(1);
    expect(deletions[0][0]).toContain('id=remove-item');
    const insert = mock.mock.calls.find((call) => call[1]?.method === 'POST' && String(call[0]).includes('playlistItems'));
    expect(JSON.parse(insert![1].body).snippet.playlistId).toBe('add');
  });
  it('stops if a playlist changed in Studio since it was loaded', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'one', snippet: { title: 'One' } }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(saveVideoPlaylists(input.piece, job.id, ['one'], [])).rejects.toThrow(/changed in YouTube Studio/);
    expect(mock.mock.calls.some((call) => call[1]?.method === 'DELETE')).toBe(false);
  });
  it('waits for YouTube to show a removal before reporting success', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } }))
      .mockResolvedValueOnce(Response.json({ id: 'youtube-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'one', snippet: { title: 'One' } }] }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'entry' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: 'entry' }] }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal('fetch', mock);
    const job = startUpload(input);
    for (let i = 0; i < 100 && uploadsFor(input.piece)[0]?.status === 'uploading'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await saveVideoPlaylists(input.piece, job.id, ['one'], [])).toEqual({ errors: [] });
    expect(mock).toHaveBeenCalledTimes(8);
  });
});
