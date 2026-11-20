import { describe, expect, it } from 'vitest';
import { checkYoutubeVideo } from './videoChecks';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
const video: YoutubeVideoSettings = { etag: 'x', title: 'Title', description: '0:00 Start\n1:00 Middle\n2:00 End', tags: ['tag'], language: 'en-US', privacy: 'private', madeForKids: false, synthetic: false, thumbnail: null, customThumbnail: true };
describe('YouTube checks', () => {
  it('counts a missing own comment as a problem, unless comments are off or it was not checked', () => {
    expect(checkYoutubeVideo(video, undefined, true, { posted: false }).issues).toContain('no comment posted');
    expect(checkYoutubeVideo(video, undefined, true, { posted: true, texts: ['Hi'] }).issues).not.toContain('no comment posted');
    expect(checkYoutubeVideo(video, undefined, true, { posted: false, disabled: true }).issues).not.toContain('no comment posted');
    expect(checkYoutubeVideo(video, undefined, true, null).unknown).toContain('comment posted');
    expect(checkYoutubeVideo(video, undefined, true).issues).not.toContain('no comment posted');
  });
  it('identifies empty fields and automatic-only captions', () => {
    const result = checkYoutubeVideo({ ...video, description: '', tags: [], customThumbnail: false }, [{ kind: 'ASR' }], false);
    expect(result.issues).toEqual(['description is empty', 'no tags', 'no custom thumbnail', 'only automatic captions', 'chapters may be missing']);
  });
  it('says nothing about captions when they were not checked', () => {
    expect(checkYoutubeVideo(video, undefined, false)).toEqual({ issues: [], unknown: [] });
  });
  it('does not guess unknown captions or thumbnails, or require chapters for Shorts', () => {
    const result = checkYoutubeVideo({ ...video, description: 'hello', customThumbnail: null }, null, true);
    expect(result.issues).toEqual([]); expect(result.unknown).toEqual(['custom thumbnail', 'captions']);
  });
});
