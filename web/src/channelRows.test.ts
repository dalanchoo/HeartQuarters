import { expect, it } from 'vitest';
import type { ChannelVideo } from '../../server/channel-videos';
import { channelRows, formatMinutes, rowName, videoProjectsHash } from './channelRows';

const video = (id: string, kind: 'longform' | 'short', views: number | null, publishedAt: string, title = `Video ${id}`, topic: ChannelVideo['topic'] = 'unassigned', note = '', angle: ChannelVideo['angle'] = 'unassigned'): ChannelVideo => ({
  id, title, publishedAt, seconds: 60, privacy: 'public', kind, kindGuessed: false, piece: null, topic, angle, note, suggested: false,
  numbers: views === null ? null : { views, minutesWatched: 1, averageViewDuration: 1, averageViewPercentage: 1, likes: 0, subscribersGained: 0 },
});
const videos = [video('a', 'longform', 10, '2026-01-01'), video('b', 'short', 50, '2026-02-01'), video('c', 'longform', null, '2026-03-01', 'Aphantasia Story'), video('d', 'longform', 30, '2026-04-01', 'Video d', 'sdam', 'my best video', 'story')];
const all = { kind: 'all', topic: 'all', angle: 'all', text: '' } as const;

it('filters by kind and by title text', () => {
  expect(channelRows(videos, { ...all, kind: 'short' }, 'publishedAt', true).map((v) => v.id)).toEqual(['b']);
  expect(channelRows(videos, { ...all, text: ' aphantasia ' }, 'publishedAt', true).map((v) => v.id)).toEqual(['c']);
});

it('filters by topic and finds words in the note', () => {
  expect(channelRows(videos, { ...all, topic: 'sdam' }, 'publishedAt', true).map((v) => v.id)).toEqual(['d']);
  expect(channelRows(videos, { ...all, text: 'best video' }, 'publishedAt', true).map((v) => v.id)).toEqual(['d']);
});

it('filters by angle', () => {
  expect(channelRows(videos, { ...all, angle: 'story' }, 'publishedAt', true).map((v) => v.id)).toEqual(['d']);
  expect(channelRows(videos, { ...all, angle: 'wisdom' }, 'publishedAt', true)).toEqual([]);
});

it('can show only the guesses still waiting to be confirmed', () => {
  const guessed = [{ ...videos[0], suggested: true }, videos[1]];
  expect(channelRows(guessed, { ...all, unconfirmedOnly: true }, 'publishedAt', true).map((v) => v.id)).toEqual(['a']);
});

it('sorts by date and by a number, high to low or low to high', () => {
  expect(channelRows(videos, all, 'publishedAt', true).map((v) => v.id)).toEqual(['d', 'c', 'b', 'a']);
  expect(channelRows(videos, all, 'views', true).map((v) => v.id)).toEqual(['b', 'd', 'a', 'c']);
  expect(channelRows(videos, all, 'views', false).map((v) => v.id)).toEqual(['a', 'd', 'b', 'c']);
});

it('shows watch time in minutes or hours', () => {
  expect(formatMinutes(45.4)).toBe('45 min');
  expect(formatMinutes(90)).toBe('1.5 h');
});

it('links a video to its own card in Video Projects', () => {
  expect(videoProjectsHash('016 - Ocean of Sadness/Longform')).toBe('#Videos/016%20-%20Ocean%20of%20Sadness');
  expect(videoProjectsHash('015 - NVC/015A - Making Conversations Worse/Longform')).toBe('#Videos/015%20-%20NVC%2F015A%20-%20Making%20Conversations%20Worse');
  expect(videoProjectsHash("022 - Worth Telling Them/Shorts/022_S09 - You're Lucky")).toBe("#Videos/022%20-%20Worth%20Telling%20Them/022%20-%20Worth%20Telling%20Them%2FShorts%2F022_S09%20-%20You're%20Lucky");
  expect(videoProjectsHash('999 - Shorts/2026/999-2026-21 - Give Feedback')).toBe('#Videos/999%20-%20Shorts%2F2026%2F999-2026-21%20-%20Give%20Feedback');
});

it('names a video by its Video Projects folder, and finds it by that name or by its YouTube title', () => {
  expect(rowName({ piece: '022 - Worth Telling Them/Longform', title: 'x' })).toBe('022 - Worth Telling Them');
  expect(rowName({ piece: '015 - NVC/015A - Making Conversations Worse/Longform', title: 'x' })).toBe('015A - Making Conversations Worse');
  expect(rowName({ piece: '021 - Every Thought Is Cut In Half/Shorts/021_S06 - I Felt Irresponsible', title: 'x' })).toBe('021_S06 - I Felt Irresponsible');
  expect(rowName({ piece: "999 - Shorts/2026/999-2026-01 - You're the Constant", title: 'x' })).toBe("999-2026-01 - You're the Constant");
  expect(rowName({ piece: null, title: 'Only A Title' })).toBe('Only A Title');
  const linked = [{ ...video('z', 'short', 5, '2026-05-01', 'I Felt I Failed to Protect Her'), piece: '021 - Every Thought Is Cut In Half/Shorts/021_S06 - I Felt Irresponsible' }];
  expect(channelRows(linked, { ...all, text: 'irresponsible' }, 'publishedAt', true)).toHaveLength(1);
  expect(channelRows(linked, { ...all, text: 'failed to protect' }, 'publishedAt', true)).toHaveLength(1);
});
