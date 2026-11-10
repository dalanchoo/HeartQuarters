import { describe, expect, it } from 'vitest';
import { existingYoutubeJob, shouldLinkLongform } from './youtubePanel';
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
});
