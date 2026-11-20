import { describe, expect, it } from 'vitest';
import { ownComments } from './youtube-comment';
import { sameComment } from '../web/src/videoChecks';

const thread = (channel: string, author: string, text: string) => ({ snippet: { channelId: channel, topLevelComment: { snippet: { authorChannelId: { value: author }, textOriginal: text } } } });

describe('own comment check', () => {
  it("keeps only comments written by the video's own channel", () => {
    expect(ownComments([thread('UCme', 'UCviewer', 'Great video'), thread('UCme', 'UCme', 'Have you told anyone?'), { snippet: {} }])).toEqual(['Have you told anyone?']);
    expect(ownComments([])).toEqual([]);
  });
  it('matches a posted comment to the file ignoring spacing, but not an empty file value', () => {
    expect(sameComment('Have you told anyone?\n\nGuide: x', 'have you told anyone? guide: x')).toBe(true);
    expect(sameComment('Something else', 'Have you told anyone?')).toBe(false);
    expect(sameComment('', '')).toBe(false);
  });
});
