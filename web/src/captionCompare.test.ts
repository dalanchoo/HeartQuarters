import { describe, expect, it } from 'vitest';
import { captionText, compareCaptions, parseCues } from './captionCompare';

const OURS = '1\n00:00:00,040 --> 00:00:00,860\nSometimes I\'ll\n\n2\n00:00:00,860 --> 00:00:01,560\nmeet somebody\n';
// YouTube sends the same captions back with Windows line endings and its own spacing.
const YOUTUBE_SAME = '1\r\n00:00:00,040 --> 00:00:00,860\r\nSometimes I\'ll\r\n\r\n2\r\n00:00:00,860 --> 00:00:01,560\r\nmeet somebody\r\n\r\n';
// Studio's editor: the same words in one long two-line block.
const STUDIO = '1\n00:00:00,160 --> 00:00:08,000\nSometimes I\'ll \nmeet somebody\n';

describe('comparing captions', () => {
  it('reads the cues of an .srt', () => {
    expect(parseCues(OURS)).toEqual([{ start: 0.04, end: 0.86, text: "Sometimes I'll" }, { start: 0.86, end: 1.56, text: 'meet somebody' }]);
    expect(captionText(STUDIO)).toBe("Sometimes I'll meet somebody");
  });
  it('calls the same captions the same, whatever the line endings', () => {
    expect(compareCaptions(OURS, YOUTUBE_SAME)).toMatchObject({ same: true, wordsSame: true, timingSame: true });
  });
  it('tells the same words with different timing apart', () => {
    expect(compareCaptions(OURS, STUDIO)).toMatchObject({ same: false, wordsSame: true, timingSame: false });
  });
  it('highlights changed words', () => {
    const result = compareCaptions(OURS, OURS.replace('somebody', 'someone'));
    expect(result).toMatchObject({ same: false, wordsSame: false });
    expect(result.right.filter((p) => p.changed).map((p) => p.text)).toEqual(['someone']);
  });
});
