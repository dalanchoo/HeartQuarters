import { describe, expect, it } from 'vitest';
import { defaultSubtitle } from './subtitleChoice';
describe('subtitle choice for an upload', () => {
  it('selects a sole file or a VTT alongside alternate formats of the same name', () => {
    expect(defaultSubtitle([{ name: 'A.srt', path: 'a' }])).toBe('a');
    expect(defaultSubtitle([{ name: 'A.srt', path: 'a' }, { name: 'A.vtt', path: 'v' }])).toBe('v');
  });
  it('does not guess between differently named subtitle files', () => {
    expect(defaultSubtitle([{ name: 'A.vtt', path: 'a' }, { name: 'B.vtt', path: 'b' }])).toBe('');
  });
});
