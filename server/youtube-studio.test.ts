import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { edgePath, studioArgs, studioUrl } from './youtube-studio';

describe('opening YouTube Studio', () => {
  it('builds only Studio URLs and rejects invalid video IDs', () => {
    expect(studioUrl(null)).toBe('https://studio.youtube.com/');
    expect(studioUrl('Abc_123-xyz')).toBe('https://studio.youtube.com/video/Abc_123-xyz/edit');
    expect(() => studioUrl('../other')).toThrow();
    expect(() => studioUrl('https://example.com')).toThrow();
  });
  it('finds Edge in the usual Windows install folders or reports it missing', () => {
    const expected = path.join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    expect(edgePath({ PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' }, (p) => p === expected)).toBe(expected);
    expect(() => edgePath({}, () => false)).toThrow(/could not be found/);
  });
  it('opens Studio in its own persistent Edge profile', () => {
    expect(studioArgs('Abc_123-xyz', { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' })).toEqual([
      `--user-data-dir=${path.join('C:\\Users\\Test\\AppData\\Local', 'HeartQuarters', 'YouTube Studio Edge')}`,
      'https://studio.youtube.com/video/Abc_123-xyz/edit',
    ]);
  });
});
