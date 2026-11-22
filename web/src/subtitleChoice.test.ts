import { describe, expect, it } from 'vitest';
import { defaultSubtitle } from './subtitleChoice';
describe('subtitle choice for an upload', () => {
  it('selects a sole file', () => {
    expect(defaultSubtitle([{ name: 'A.srt', path: 'a' }])).toBe('a');
    expect(defaultSubtitle([{ name: 'A.vtt', path: 'v' }])).toBe('v');
  });
  it('prefers the .srt over a .vtt of the same name, whichever order they are listed in', () => {
    expect(defaultSubtitle([{ name: 'A.srt', path: 'a' }, { name: 'A.vtt', path: 'v' }])).toBe('a');
    expect(defaultSubtitle([{ name: 'A.vtt', path: 'v' }, { name: 'A.srt', path: 'a' }])).toBe('a');
  });
  it('falls back to a .vtt, then an .sbv, when there is no .srt', () => {
    expect(defaultSubtitle([{ name: 'A.sbv', path: 's' }, { name: 'A.vtt', path: 'v' }])).toBe('v');
  });
  it('does not guess between differently named subtitle files', () => {
    expect(defaultSubtitle([{ name: 'A.vtt', path: 'a' }, { name: 'B.vtt', path: 'b' }])).toBe('');
    expect(defaultSubtitle([{ name: 'A.srt', path: 'a' }, { name: 'B.srt', path: 'b' }])).toBe('');
  });
});
