import { describe, expect, it } from 'vitest';
import { cleanYoutubeLinks } from './cleanYoutubeLinks';

describe('cleaning pasted YouTube links', () => {
  it('removes sharing information from Shorts and shortened video links', () => {
    expect(cleanYoutubeLinks('https://youtube.com/shorts/U91ncAvQ2po?feature=share')).toBe('https://youtube.com/shorts/U91ncAvQ2po');
    expect(cleanYoutubeLinks('https://youtu.be/cvw49t7w73g?si=ABC')).toBe('https://youtu.be/cvw49t7w73g');
  });
  it('keeps video IDs, start times, playlists, fragments, and other parameters', () => {
    expect(cleanYoutubeLinks('https://www.youtube.com/watch?v=cvw49t7w73g&feature=share&t=90&list=PL123&si=abc#t=90')).toBe('https://www.youtube.com/watch?v=cvw49t7w73g&t=90&list=PL123#t=90');
    expect(cleanYoutubeLinks('https://youtu.be/cvw49t7w73g?feature=related&start=3')).toBe('https://youtu.be/cvw49t7w73g?feature=related&start=3');
    expect(cleanYoutubeLinks('https://youtube.com/playlist?list=PL123&si=abc')).toBe('https://youtube.com/playlist?list=PL123');
  });
  it('cleans links within text and keeps surrounding punctuation', () => {
    expect(cleanYoutubeLinks('See (https://youtube.com/shorts/U91ncAvQ2po?feature=share), thanks.')).toBe('See (https://youtube.com/shorts/U91ncAvQ2po), thanks.');
    expect(cleanYoutubeLinks('[Watch](https://youtu.be/cvw49t7w73g?si=abc).')).toBe('[Watch](https://youtu.be/cvw49t7w73g).');
  });
  it('does not alter other sites, unrecognized YouTube links, or invalid URLs', () => {
    for (const text of ['https://example.com/?feature=share&si=1', 'https://youtube.com.example.com/watch?v=cvw49t7w73g&si=a', 'https://youtube.com/playlist?si=a', 'http://youtube.com/shorts/U91ncAvQ2po?feature=share', 'https://youtube.com/shorts/bad?si=a']) expect(cleanYoutubeLinks(text)).toBe(text);
  });
});
