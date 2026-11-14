import { describe, expect, it } from 'vitest';
import { alteredContentValue, comparisonState, localBoolean, localValue, setLocalValue, splitHashtags, SYNC_FIELDS, youtubeValues } from './youtubePackaging';

describe('hashtags kept in their own field (older files)', () => {
  const OLD = 'Title:\nT\n\nDescription:\nAbout the video.\n\nHashtags:\n#ayahuasca #mensmentalhealth\n\nTags:\na, b\n';
  it("adds them to the end of the description, the way YouTube has it", () => {
    expect(localValue(OLD, 'Description')).toBe('About the video.\n\n#ayahuasca #mensmentalhealth');
    expect(localValue('Description:\nAbout.\n\n#x #y\n\nHashtags:\n#x #y\n', 'Description')).toBe('About.\n\n#x #y'); // not twice
  });
  it("puts YouTube's closing hashtags back in the Hashtags field when saving to the file", () => {
    const saved = setLocalValue(OLD, 'Description', 'A new description.\n\n#ayahuasca #psychedelichealing');
    expect(saved).toContain('Description:\nA new description.\n\nHashtags:\n#ayahuasca #psychedelichealing\n\nTags:');
  });
  it('only takes a last paragraph that is nothing but hashtags', () => {
    expect(splitHashtags('Text.\n\n#a #b_c #ü1')).toEqual({ description: 'Text.', hashtags: '#a #b_c #ü1' });
    expect(splitHashtags('Text.\n\nSee #a here')).toEqual({ description: 'Text.\n\nSee #a here', hashtags: null });
    expect(splitHashtags('#a #b')).toEqual({ description: '#a #b', hashtags: null });
  });
});

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
    const withAltered = setLocalValue(withLanguage, 'Altered content', 'No');
    const result = setLocalValue(withAltered, 'Made for kids', 'No');
    expect(localValue(result, 'Video language')).toBe('en-US');
    expect(localValue(result, 'Altered content')).toBe('No');
    expect(localValue(result, 'Made for kids')).toBe('No');
  });
  it('checks yes/no answers', () => {
    expect(localBoolean('No')).toBe(false); expect(() => localBoolean('maybe')).toThrow();
  });
  it("doesn't keep Visibility or Playlists in the file, or compare them", () => {
    expect(SYNC_FIELDS).not.toContain('Visibility');
    expect(SYNC_FIELDS).not.toContain('Playlists');
    // Only the fields youtubeValues reads; the rest of a video's settings don't matter here.
    const video = { title: 'T', description: 'D', tags: [], language: 'en-US', privacy: 'public', madeForKids: false, synthetic: null } as unknown as Parameters<typeof youtubeValues>[0];
    expect(Object.keys(youtubeValues(video))).toEqual(['Title', 'Description', 'Tags', 'Video language', 'Made for kids', 'Altered content']);
  });
  it('writes the Altered content answer that was sent, and nothing when none was chosen', () => {
    expect(alteredContentValue(true)).toBe('Yes');
    expect(alteredContentValue(false)).toBe('No');
    expect(alteredContentValue(null)).toBeNull();
  });
  it("doesn't call a value YouTube never reports a difference", () => {
    expect(comparisonState('No', null, undefined, '')).toBe("YouTube doesn't report this");
    expect(comparisonState(null, null, undefined, '')).toBe('Not provided');
    expect(comparisonState('a', 'a', true, '')).toBe('Same');
    expect(comparisonState('a', 'b', false, '')).toBe('Different');
    expect(comparisonState(null, 'b', undefined, '')).toBe('Different');
    expect(comparisonState('a', 'a', true, 'two fields')).toBe('Needs attention');
  });
  it('refuses ambiguous duplicate fields', () => {
    expect(() => setLocalValue('Title:\nA\n\nTitle:\nB\n', 'Title', 'C')).toThrow(/more than one/);
  });
});
