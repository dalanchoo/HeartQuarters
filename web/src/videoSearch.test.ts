import { describe, expect, it } from 'vitest';
import { matchesProjectSearch, matchesVideoSearch } from './videoSearch';
import type { VideoOverview } from '../../server/video-overview';

const video: VideoOverview = { path: '007 - Feelings/Shorts/007_S01', projectId: '007 - Feelings', name: '007_S01 - A Story', kind: 'short', link: 'linked', localThumbnail: false, capcut: true, exported: true, metadataMissing: [], titles: ['That Might Be a Story', 'An Earlier Title'] };
describe('video search', () => {
  it('matches folder names, video names, and saved titles without regard to case', () => {
    for (const query of ['007', 'FEELINGS', 'a story', 'might be', 'earlier']) expect(matchesVideoSearch(video, query)).toBe(true);
    expect(matchesVideoSearch(video, 'unrelated')).toBe(false);
  });
  it('finds a project by title and ignores an empty query', () => {
    expect(matchesProjectSearch('005 – Ayahuasca/005C - Night Two', 'Night Two', 'ayahuasca')).toBe(true);
    expect(matchesProjectSearch('005', 'Night Two', '  ')).toBe(true);
    expect(matchesVideoSearch(video, '  ')).toBe(true);
  });
});
