import { describe, expect, it } from 'vitest';
import { findAiWritingTells, isProseFieldLabel } from './aiWritingCheck';

describe('findAiWritingTells', () => {
  it('returns empty for plain, natural first-person writing', () => {
    const sample =
      "I took magic mushrooms with a friend, and this turned into a real example of the placebo effect. I didn't believe it existed, but I tried anyway.";
    expect(findAiWritingTells(sample)).toEqual([]);
  });

  it('flags formulaic contrasts, AI clichés, em-dashes, and hype words', () => {
    const sample =
      "It's not about memory — it's about connection. Let's delve into this transformative journey. This changed everything!";
    const tells = findAiWritingTells(sample);
    expect(tells.map((t) => t.match.toLowerCase())).toEqual(
      expect.arrayContaining(["not about memory — it's about", '—', 'delve', 'transformative', 'this changed everything']),
    );
  });

  it('checks prose fields like Title, Description, and Pinned Comment, and skips Tags and settings', () => {
    expect(isProseFieldLabel('Description')).toBe(true);
    expect(isProseFieldLabel('Pinned Comment')).toBe(true);
    expect(isProseFieldLabel('Title')).toBe(true);
    expect(isProseFieldLabel('Tags')).toBe(false);
    expect(isProseFieldLabel('Hashtags')).toBe(false);
    expect(isProseFieldLabel('Video language')).toBe(false);
  });
});
