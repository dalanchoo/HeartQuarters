import { describe, expect, it } from 'vitest';
import { dragEdge, moveRow, nextShortId, parseTime, rangeOfWords, showTime, trimWindow, wordAt, wordInClip } from './shortsTime';

const words = [
  { start: 0, end: 1, word: 'I' },
  { start: 1, end: 2, word: 'kept' },
  { start: 2, end: 3, word: 'going' },
];

describe('wordInClip', () => {
  const said = (start: number, end: number) =>
    words.filter((w) => wordInClip(w, start, end)).map((w) => w.word).join(' ');

  it('finds the words of the clip', () => {
    expect(said(1, 3)).toBe('kept going');
    expect(said(10, 20)).toBe('');
  });

  it('counts a word cut by the edge only on the side holding most of it', () => {
    expect(said(0, 1.4)).toBe('I');
    expect(said(0, 1.6)).toBe('I kept');
  });
});

describe('wordAt', () => {
  const spoken = [
    { start: 1, end: 2, word: 'one' },
    { start: 2.1, end: 3, word: 'two' },
    { start: 10, end: 11, word: 'three' },
  ];

  it('finds the word being said', () => {
    expect(wordAt(spoken, 1.5)).toBe(0);
    expect(wordAt(spoken, 2.5)).toBe(1);
    expect(wordAt(spoken, 10)).toBe(2);
  });

  it('holds a word across a tiny gap, but not through a pause', () => {
    expect(wordAt(spoken, 2.05)).toBe(0);
    expect(wordAt(spoken, 5)).toBe(-1);
  });

  it('finds nothing before the first word or in an empty list', () => {
    expect(wordAt(spoken, 0.5)).toBe(-1);
    expect(wordAt([], 5)).toBe(-1);
  });
});

describe('rangeOfWords', () => {
  it('runs from the start of the first word to the end of the last, either way round', () => {
    expect(rangeOfWords(words, 1, 2)).toEqual({ start: 1, end: 3 });
    expect(rangeOfWords(words, 2, 1)).toEqual({ start: 1, end: 3 });
    expect(rangeOfWords(words, 0, 0)).toEqual({ start: 0, end: 1 });
  });
});

describe('dragEdge', () => {
  const spaced = [
    { start: 10, end: 11, word: 'one' },
    { start: 20, end: 21, word: 'two' },
  ];
  const clip = { start: 10, end: 21 };

  it('snaps to the matching edge of a nearby word', () => {
    expect(dragEdge('start', 19.8, clip, 100, spaced).start).toBe(20);
    expect(dragEdge('end', 11.2, clip, 100, spaced).end).toBe(11);
  });

  it('stays where it was dropped when no word is near, or none are given', () => {
    expect(dragEdge('start', 15, clip, 100, spaced).start).toBe(15);
    expect(dragEdge('start', 19.8, clip, 100, null).start).toBe(19.8);
  });

  it('only moves the edge being dragged', () => {
    expect(dragEdge('start', 15, clip, 100, null).end).toBe(21);
    expect(dragEdge('end', 30, clip, 100, null).start).toBe(10);
  });

  it('cannot cross the other handle or leave the video', () => {
    expect(dragEdge('start', 50, clip, 100, null).start).toBe(20);
    expect(dragEdge('end', 2, clip, 100, null).end).toBe(11);
    expect(dragEdge('start', -5, clip, 100, null).start).toBe(0);
    expect(dragEdge('end', 500, clip, 100, null).end).toBe(100);
  });
});

describe('trimWindow', () => {
  it('shows the clip with room either side, inside the video', () => {
    expect(trimWindow(100, 145, 1000)).toEqual({ from: 70, to: 175 });
    expect(trimWindow(10, 40, 50)).toEqual({ from: 0, to: 50 });
  });

  it('gives a long clip more room', () => {
    expect(trimWindow(100, 300, 1000)).toEqual({ from: 0, to: 400 });
  });

  it('stays put while the clip fits, and moves when a handle nears its edge', () => {
    const shown = { from: 70, to: 175 };
    expect(trimWindow(90, 150, 1000, shown)).toBe(shown);
    expect(trimWindow(72, 150, 1000, shown)).not.toBe(shown);
    expect(trimWindow(90, 172, 1000, shown)).not.toBe(shown);
  });

  it('does not move for nearing the very start or end of the video', () => {
    const shown = { from: 0, to: 50 };
    expect(trimWindow(1, 49, 50, shown)).toBe(shown);
  });
});

describe('moveRow', () => {
  const a = { id: 'S01', start: 10 };
  const b = { id: 'S02', start: 50 };
  const c = { id: 'S03', start: 30 };

  it('moves the row and keeps the video order', () => {
    expect(moveRow([a, b], [c], 'S02')).toEqual({ from: [a], to: [c, b] });
    expect(moveRow([c], [a, b], 'S03')).toEqual({ from: [], to: [a, c, b] });
  });

  it('leaves both lists alone if the row is not there', () => {
    expect(moveRow([a], [b], 'S09')).toEqual({ from: [a], to: [b] });
  });
});

describe('showTime', () => {
  it('shows minutes and seconds', () => {
    expect(showTime(83.4)).toBe('1:23.4');
    expect(showTime(5)).toBe('0:05.0');
    expect(showTime(59.96)).toBe('1:00.0');
  });
});

describe('parseTime', () => {
  it('reads what John types', () => {
    expect(parseTime('1:23.4')).toBeCloseTo(83.4);
    expect(parseTime('1:23')).toBe(83);
    expect(parseTime(' 83.5 ')).toBe(83.5);
    expect(parseTime(showTime(612.3))).toBeCloseTo(612.3);
  });

  it('refuses what is not a time', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('soon')).toBeNull();
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('1:2:3')).toBeNull();
  });
});

describe('nextShortId', () => {
  it('continues after the highest number', () => {
    expect(nextShortId([])).toBe('S01');
    expect(nextShortId(['S01', 'S07'])).toBe('S08');
  });
});
