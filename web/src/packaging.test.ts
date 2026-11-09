// Splitting YouTube.md and similar files into fields for the Copy buttons.
import { describe, expect, it } from 'vitest';
import { inPlatformOrder, isBlankPackaging, parseFields, readAiLines, setAiLines, setFieldValue } from './packaging';

describe('setFieldValue', () => {
  const FILE = '# YouTube Info\n\nTitle:\nOld title\n\nDescription:\nHook.\n\nFull video:\nhttps://a\n\nTags:\nx, y\n\nPinned Comment:\nA question?\n';

  it('changes one field and nothing else', () => {
    expect(setFieldValue(FILE, 0, 'New title')).toBe(FILE.replace('Old title', 'New title'));
    expect(setFieldValue(FILE, 2, 'z')).toBe(FILE.replace('x, y', 'z'));
    expect(setFieldValue(FILE, 3, 'Another?')).toBe(FILE.replace('A question?', 'Another?'));
  });

  it('replaces a whole description, whatever it holds', () => {
    const changed = setFieldValue(FILE, 1, 'One.\n\nFull story:\nhttps://b');
    expect(parseFields(changed)?.[1]).toEqual({ label: 'Description', value: 'One.\n\nFull story:\nhttps://b' });
    expect(parseFields(changed)?.map((f) => f.label)).toEqual(['Title', 'Description', 'Tags', 'Pinned Comment']);
  });

  it('fills in and empties a field, keeping the fields apart', () => {
    const empty = 'Title:\n\nTags:\n';
    const filled = setFieldValue(empty, 0, 'A');
    expect(filled).toBe('Title:\nA\n\nTags:\n');
    expect(setFieldValue(filled, 0, '')).toBe(empty);
    expect(setFieldValue(empty, 1, 'b')).toBe('Title:\n\nTags:\nb\n');
  });

  it('fills in a file with only one field', () => {
    expect(setFieldValue('Description:', 0, 'A')).toBe('Description:\nA');
    expect(setFieldValue('Description:\r\n', 0, 'A\nB')).toBe('Description:\r\nA\r\nB\r\n');
  });

  it("keeps the file's Windows line endings, also for what's typed", () => {
    expect(setFieldValue('Title:\r\nOld\r\n\r\nTags:\r\nx\r\n', 0, 'One\nTwo')).toBe('Title:\r\nOne\r\nTwo\r\n\r\nTags:\r\nx\r\n');
  });

  it('refuses a field that is not there', () => {
    expect(() => setFieldValue('Title:\nA', 3, 'x')).toThrow(/Reload/);
  });
});

describe('parseFields, with one label', () => {
  it('shows a lone label as a field, so a template can be filled in', () => {
    expect(parseFields('# LinkedIn\n\nDescription:\n')).toEqual([{ label: 'Description', value: '' }]);
  });

  it("doesn't hide notes that happen to contain one label", () => {
    expect(parseFields('Some notes.\n\nIdeas:\nMore notes.')).toBeNull();
  });
});

describe('isBlankPackaging', () => {
  it('sees the templates as blank', () => {
    expect(isBlankPackaging('')).toBe(true);
    expect(isBlankPackaging('Description:\r\n')).toBe(true);
    expect(isBlankPackaging('Description:\n\nComment:\n')).toBe(true);
    expect(isBlankPackaging('# YouTube Info\n\nTitle:\n\nDescription:\n\n#tags\n\nTags:\n\nPinned Comment:')).toBe(true);
  });

  it('sees anything written as not blank', () => {
    expect(isBlankPackaging('Description:\nHello')).toBe(false);
    expect(isBlankPackaging('#sdam')).toBe(false);
    expect(isBlankPackaging('Just some notes.')).toBe(false);
  });
});

describe('inPlatformOrder', () => {
  const names = (list: string[]) => inPlatformOrder(list.map((name) => ({ name }))).map((f) => f.name);

  it("puts John's platforms in his order, with any other file after them", () => {
    expect(names(['Instagram.md', 'Notes.md', 'LinkedIn.md', 'Substack.md', 'TikTok.md', 'YouTube.md'])).toEqual([
      'YouTube.md',
      'Substack.md',
      'Instagram.md',
      'TikTok.md',
      'LinkedIn.md',
      'Notes.md',
    ]);
  });

  it('ignores capitals and version numbers in the name', () => {
    expect(names(['tiktok v02.md', 'YOUTUBE v01.md'])).toEqual(['YOUTUBE v01.md', 'tiktok v02.md']);
  });

  it('looks at the file, not the subfolder it is in', () => {
    expect(names(['Metadata/TikTok.md', 'Metadata/YouTube v01.md'])).toEqual(['Metadata/YouTube v01.md', 'Metadata/TikTok.md']);
  });
});

describe('parseFields', () => {
  it('splits labelled blocks into fields', () => {
    const text = [
      '# YouTube Info',
      '',
      'Title:',
      'When Should You Tell Someone You Have SDAM?',
      '',
      'Description:',
      'First paragraph.',
      '',
      'Free guide for people who have discovered they have SDAM, with details on Zoom:',
      'https://www.heartmindfusion.com/sdam-guide',
      '',
      'Pinned Comment:',
      'What helped you?',
    ].join('\r\n');
    expect(parseFields(text)).toEqual([
      { label: 'Title', value: 'When Should You Tell Someone You Have SDAM?' },
      {
        label: 'Description',
        value:
          'First paragraph.\n\nFree guide for people who have discovered they have SDAM, with details on Zoom:\nhttps://www.heartmindfusion.com/sdam-guide',
      },
      { label: 'Pinned Comment', value: 'What helped you?' },
    ]);
  });

  it('keeps empty fields', () => {
    expect(parseFields('Title:\n\nTags:\na, b')).toEqual([
      { label: 'Title', value: '' },
      { label: 'Tags', value: 'a, b' },
    ]);
  });

  it('returns null for files not in this format', () => {
    expect(parseFields('# Instagram\n\nJust some notes.')).toBeNull();
    expect(parseFields('')).toBeNull();
  });
});

describe('parseFields, inside a description', () => {
  it('keeps lines that look like labels as part of the description', () => {
    const fields = parseFields('Title:\nA\n\nDescription:\nHook.\n\nFull video:\nhttps://a\n\nRegister here:\nhttps://b\n\nTags:\nx\n\nPinned comment:\ny');
    expect(fields).toEqual([
      { label: 'Title', value: 'A' },
      { label: 'Description', value: 'Hook.\n\nFull video:\nhttps://a\n\nRegister here:\nhttps://b' },
      { label: 'Tags', value: 'x' },
      { label: 'Pinned comment', value: 'y' },
    ]);
  });
});

describe('the AI lines', () => {
  const FILE = 'Title:\nA\n\nDescription:\nHook.\n\nFull video:\nhttps://a\n\n#sdam #shorts\n\nTags:\nThe music is AI-generated.\n';
  const WITH = (lines: string) => `Title:\nA\n\nDescription:\nHook.\n\nFull video:\nhttps://a\n\n${lines}\n\n#sdam #shorts\n\nTags:\nThe music is AI-generated.\n`;
  const MUSIC = 'The music is AI-generated.';
  const VISUALS = 'Some visuals are AI-generated or AI-enhanced.';

  it('reads them only from the description', () => {
    expect(readAiLines(FILE)).toEqual({ visuals: false, music: false });
    expect(readAiLines(WITH(MUSIC))).toEqual({ visuals: false, music: true });
    expect(readAiLines(WITH('Some visuals and music are AI-generated or AI-enhanced.'))).toEqual({ visuals: true, music: true });
    expect(readAiLines('Title:\nA\n\nTags:\nb')).toBeNull();
  });

  it('adds a line above the hashtags and takes it out again', () => {
    const added = setAiLines(FILE, { visuals: false, music: true });
    expect(added).toBe(WITH(MUSIC));
    expect(setAiLines(added, { visuals: false, music: false })).toBe(FILE);
  });

  it('keeps both lines together, visuals first, wherever they already are', () => {
    expect(setAiLines(WITH(MUSIC), { visuals: true, music: true })).toBe(WITH(`${VISUALS}\n${MUSIC}`));
    expect(setAiLines(WITH(`${VISUALS}\n${MUSIC}`), { visuals: true, music: false })).toBe(WITH(VISUALS));
  });

  it('splits the old combined line when one box is unchecked', () => {
    expect(setAiLines(WITH('Some visuals and music are AI-generated or AI-enhanced.'), { visuals: false, music: true })).toBe(WITH(MUSIC));
  });

  it('puts the line last when there are no hashtags, and at the end of a file', () => {
    expect(setAiLines('Description:\nHook.\n\nTags:\nx', { visuals: true, music: false })).toBe(`Description:\nHook.\n\n${VISUALS}\n\nTags:\nx`);
    expect(setAiLines('Title:\nA\nDescription:\nHook.', { visuals: false, music: true })).toBe(`Title:\nA\nDescription:\nHook.\n\n${MUSIC}`);
  });

  it('fills in an empty template', () => {
    expect(setAiLines('Title:\n\nDescription:\n\n#tags\n\nTags:\n', { visuals: false, music: true })).toBe(`Title:\n\nDescription:\n${MUSIC}\n\n#tags\n\nTags:\n`);
  });

  it("keeps the file's Windows line endings", () => {
    const added = setAiLines(FILE.replace(/\n/g, '\r\n'), { visuals: false, music: true });
    expect(added).toBe(WITH(MUSIC).replace(/\n/g, '\r\n'));
  });

  it('changes nothing when nothing changed, or when there is no description', () => {
    expect(setAiLines(FILE, { visuals: false, music: false })).toBe(FILE);
    expect(setAiLines('Title:\nA\n\nTags:\nb', { visuals: true, music: true })).toBe('Title:\nA\n\nTags:\nb');
  });
});
