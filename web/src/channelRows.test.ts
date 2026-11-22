import { expect, it } from 'vitest';
import type { ChannelVideo } from '../../server/channel-videos';
import { channelRows, formatMinutes } from './channelRows';

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
