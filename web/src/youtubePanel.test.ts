import { describe, expect, it } from 'vitest';
import { existingYoutubeJob, shouldLinkLongform, preferredYoutubeJob, rememberYoutubeJob, youtubeVideoUrl } from './youtubePanel';
import type { UploadJob } from '../../server/youtube';
const job = (status: UploadJob['status'], videoId?: string): UploadJob => ({ id: '1', piece: 'piece', video: 'video', status, videoId, sent: 0, total: 1 });
describe('opening YouTube settings', () => {
  it('uses an existing upload before attempting a saved long-form link', () => {
    const items = [job('done', 'abc')];
    expect(existingYoutubeJob(items)?.videoId).toBe('abc');
    expect(shouldLinkLongform(items, true, 'project')).toBe(false);
  });
  it('looks for a saved long-form link only when connected and no upload exists', () => {
    expect(shouldLinkLongform([], true, 'project')).toBe(true);
    expect(shouldLinkLongform([], false, 'project')).toBe(false);
    expect(shouldLinkLongform([], true)).toBe(false);
  });
  it('restores the selected video and gives an active upload priority', () => {
    const old = { ...job('done', 'old'), id: 'old-job' }; const chosen = { ...job('done', 'chosen'), id: 'chosen-job' };
    expect(existingYoutubeJob([old, chosen], 'chosen-job')).toBe(chosen);
    const active = { ...job('uploading'), id: 'active' };
    expect(existingYoutubeJob([old, chosen, active], 'chosen-job')).toBe(active);
    expect(existingYoutubeJob([old], 'missing')).toBe(old);
  });
  it('remembers a selection without failing if browser storage is unavailable', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    rememberYoutubeJob(storage, 'a', 'job');
    expect(preferredYoutubeJob(storage, 'a')).toBe('job');
    expect(preferredYoutubeJob(storage, 'b')).toBeNull();
    expect(preferredYoutubeJob({ getItem: () => { throw new Error(); } }, 'a')).toBeNull();
    expect(() => rememberYoutubeJob({ setItem: () => { throw new Error(); } }, 'a', 'job')).not.toThrow();
  });
  it('shows a recognizable video link for Shorts and longforms', () => {
    expect(youtubeVideoUrl('abc', true)).toBe('https://youtube.com/shorts/abc');
    expect(youtubeVideoUrl('abc', false)).toBe('https://www.youtube.com/watch?v=abc');
  });
});
