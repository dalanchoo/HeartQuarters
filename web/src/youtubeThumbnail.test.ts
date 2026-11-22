import { expect, it } from 'vitest';
import { sameThumbnail } from './youtubeThumbnail';

const base = 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg';

it('treats two reads of an unchanged thumbnail as the same, even though the engine adds a different number each time', () => {
  expect(sameThumbnail(`${base}?hq=1795320000000`, `${base}?hq=1795320005555`)).toBe(true);
  expect(sameThumbnail(`${base}?sqp=x&hq=1`, `${base}?sqp=x&hq=2`)).toBe(true);
});

it('notices a different picture or a different size', () => {
  expect(sameThumbnail(`${base}?hq=1`, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg?hq=1')).toBe(false);
  expect(sameThumbnail(`${base}?sqp=x&hq=1`, `${base}?sqp=y&hq=1`)).toBe(false);
  expect(sameThumbnail(`${base}?hq=1`, 'https://i.ytimg.com/vi/other/maxresdefault.jpg?hq=1')).toBe(false);
});

it('handles a video with no thumbnail on either read, or on only one', () => {
  expect(sameThumbnail(null, null)).toBe(true);
  expect(sameThumbnail(undefined, null)).toBe(true);
  expect(sameThumbnail(null, `${base}?hq=1`)).toBe(false);
});
