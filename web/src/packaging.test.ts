// Splitting YouTube.md and similar files into fields for the Copy buttons.
import { describe, expect, it } from 'vitest';
import { parseFields } from './packaging';

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
