import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromePath, studioUrl } from './youtube-studio';

describe('opening YouTube Studio', () => {
  it('builds only Studio URLs and rejects invalid video IDs', () => {
    expect(studioUrl(null)).toBe('https://studio.youtube.com/');
    expect(studioUrl('Abc_123-xyz')).toBe('https://studio.youtube.com/video/Abc_123-xyz/edit');
    expect(() => studioUrl('../other')).toThrow();
    expect(() => studioUrl('https://example.com')).toThrow();
  });
  it('finds Chrome in the usual Windows install folders or reports it missing', () => {
    const expected = path.join('C:\\Users\\Test\\AppData\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(chromePath({ PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }, (p) => p === expected)).toBe(expected);
    expect(() => chromePath({}, () => false)).toThrow(/could not be found/);
  });
});
