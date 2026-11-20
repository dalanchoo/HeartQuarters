import { describe, expect, it } from 'vitest';
import { applySuggestion, findAiTellSpans, wordDiff, findAiWritingTells, isProseFieldLabel } from './aiWritingCheck';

describe('findAiWritingTells', () => {
  it('returns empty for plain, natural first-person writing with varied sentence length', () => {
    const sample =
      "I took magic mushrooms with a friend, and this turned into a real example of the placebo effect and healing through friendship. My friend told me, on psilocybin, that he had a psychic parasite in his back feeding off his self-doubt. I didn't believe it existed. Still, I dug my fingers into his back anyway and pretended to pull it out. He fell to his knees and threw up.";
    expect(findAiWritingTells(sample)).toEqual([]);
  });

  it('flags formulaic contrasts, AI clichés, em-dashes, moralizing closers, and hype words', () => {
    const sample =
      "It's not about memory — it's about connection. It's not that it was hard; it was easy. Let's delve into this transformative journey. Because ultimately, healing is a reminder that we are human. This changed everything!";
    const tells = findAiWritingTells(sample);
    expect(tells.map((t) => t.match.toLowerCase())).toEqual(
      expect.arrayContaining([
        "not about memory — it's about",
        "it's not that it was hard; it was",
        '—',
        'delve',
        'transformative',
        'ultimately, healing',
        'is a reminder that',
        'this changed everything',
      ]),
    );
  });

  it('flags flat sentence rhythm (low burstiness) when 5 consecutive sentences have almost identical word counts', () => {
    const flat = [
      'I walked into the quiet room and looked around at all the people sitting there.',
      'Everyone seemed to be waiting for something important to happen before the night began.',
      'The facilitator sat at the front and spoke softly about what we might experience.',
      'I noticed my chest tightening as I thought about why I had come here today.',
      'Nobody said a word as the lights dimmed and the first song started playing.',
    ].join(' ');
    const tells = findAiWritingTells(flat);
    expect(tells.some((t) => t.reason.includes('low burstiness'))).toBe(true);
  });

  it('returns exact character spans for inline highlighting while ignoring URLs and hashtags', () => {
    const sample = 'Read https://example.com/delve — then delve into the story #transformative';
    const spans = findAiTellSpans(sample);
    expect(spans).toEqual([
      {
        start: sample.indexOf('—'),
        end: sample.indexOf('—') + 1,
        match: '—',
        reason: 'Em-dash (—) is a frequent AI punctuation tell',
      },
      {
        start: sample.lastIndexOf('delve'),
        end: sample.lastIndexOf('delve') + 5,
        match: 'delve',
        reason: 'Common AI cliché or filler phrase',
      },
    ]);
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

describe('applySuggestion', () => {
  it('replaces the whole sentence once, taking the rewrite literally', () => {
    expect(applySuggestion('One. Two two. Three.', 'Two two.', 'It costs $1.')).toBe('One. It costs $1. Three.');
  });
  it('returns null when the sentence is no longer in the text', () => {
    expect(applySuggestion('One.', 'Two.', 'x')).toBeNull();
  });
});

describe('wordDiff', () => {
  it('marks removed and added words and keeps the rest', () => {
    const parts = wordDiff('There is not too much there.', "There wasn't much to do there.");
    expect(parts.find((p) => p.kind === 'removed')?.text).toContain('not');
    expect(parts.find((p) => p.kind === 'added')?.text).toContain("wasn't");
    expect(parts[0]).toEqual({ text: 'There ', kind: 'same' });
    expect(parts.filter((p) => p.kind !== 'removed').map((p) => p.text).join('')).toBe("There wasn't much to do there.");
    expect(parts.filter((p) => p.kind !== 'added').map((p) => p.text).join('')).toBe('There is not too much there.');
  });
});
