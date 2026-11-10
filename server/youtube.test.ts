import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { acknowledgeUpload, addSubtitle, startUpload, uploadsFor, validateUpload, type UploadInput } from './youtube';

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
    await addSubtitle(input.piece, job.id, '001 - Test/Longform/Subtitles/test.vtt');
    expect(uploadsFor(input.piece)[0].subtitleStatus).toBe('sent');
    expect(mock).toHaveBeenCalledTimes(4);
    await expect(addSubtitle(input.piece, job.id, '001 - Test/Longform/Subtitles/test.vtt')).rejects.toThrow(/already/);
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
});
