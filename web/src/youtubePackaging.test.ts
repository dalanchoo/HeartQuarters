import { describe, expect, it } from 'vitest';
import { localBoolean, localPlaylistIds, localValue, setLocalValue } from './youtubePackaging';

describe('local YouTube metadata', () => {
  const original = '# YouTube\r\n\r\nTitle:\r\nOld\r\n\r\nDescription:\r\nHello\r\nFull video:\r\nhttps://example.com\r\n\r\nPinned Comment:\r\nKeep this\r\n';
  it('changes one field and preserves the rest including line endings', () => {
    const updated = setLocalValue(original, 'Title', 'New');
    expect(updated).toContain('Title:\r\nNew\r\n'); expect(updated).toContain('Pinned Comment:\r\nKeep this');
    expect(updated).toContain('Full video:\r\nhttps://example.com');
  });
  it('adds YouTube settings without absorbing them into the description', () => {
    const updated = setLocalValue(original, 'Made for kids', 'No');
    expect(localValue(updated, 'Made for kids')).toBe('No');
    expect(localValue(updated, 'Description')).toBe('Hello\nFull video:\nhttps://example.com');
  });
  it('keeps each new setting separate when saving them together', () => {
    const withLanguage = setLocalValue(original, 'Video language', 'en-US');
    const withVisibility = setLocalValue(withLanguage, 'Visibility', 'private');
    const result = setLocalValue(withVisibility, 'Playlists', 'Shorts [abc-123]');
    expect(localValue(result, 'Video language')).toBe('en-US');
    expect(localValue(result, 'Visibility')).toBe('private');
    expect(localValue(result, 'Playlists')).toBe('Shorts [abc-123]');
  });
  it('checks playlist IDs and yes/no answers', () => {
    expect(localPlaylistIds('Shorts [abc-123]', [{ id: 'abc-123', title: 'Renamed' }])).toEqual(['abc-123']);
    expect(() => localPlaylistIds('Unknown', [])).toThrow();
    expect(localBoolean('No')).toBe(false); expect(() => localBoolean('maybe')).toThrow();
  });
  it('refuses ambiguous duplicate fields', () => {
    expect(() => setLocalValue('Title:\nA\n\nTitle:\nB\n', 'Title', 'C')).toThrow(/more than one/);
  });
});
