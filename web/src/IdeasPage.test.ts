import { describe, expect, it } from 'vitest';
import { ideaLabels, linkLabel, linkTitle } from './IdeasPage';
import { hasPendingEdits, setPendingEdit } from './unsavedEdits';

describe('unsaved edits (unsavedEdits.ts)', () => {
  it('counts an edit as pending until it is saved or dropped', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    expect(hasPendingEdits()).toBe(false);
    setPendingEdit(a, true);
    setPendingEdit(b, true);
    setPendingEdit(a, false);
    expect(hasPendingEdits()).toBe(true);
    setPendingEdit(b, false);
    expect(hasPendingEdits()).toBe(false);
  });
});

describe('idea link labels', () => {
  it('shows the note, or else a readable address', () => {
    expect(linkLabel({ url: 'https://example.com/a', note: ' Chapter 2 ' })).toBe('Chapter 2');
    expect(linkLabel({ url: 'https://example.com/a', note: '' })).toBe('https://example.com/a');
    expect(linkLabel({ url: '#Videos/001%20-%20About%20Me', note: '' })).toBe('001 - About Me');
    expect(linkLabel({ url: '#Videos/002%20-%20X/002%20-%20X%2FShorts%2FS01', note: '' })).toBe('002 - X/Shorts/S01');
  });

  it('shows actual video titles in tooltips for shorts and longforms, and keeps external URLs', () => {
    const videos = [
      { piece: '003 - SDAM/Longform', title: 'What It Is Like Having SDAM' },
      { piece: "022 - Worth Telling Them/Shorts/022_S09 - You're Lucky", title: "You're Lucky You Don't Remember" },
    ];
    expect(linkTitle({ url: '#Videos/003%20-%20SDAM', note: '003 - SDAM' }, videos))
      .toBe('What It Is Like Having SDAM');
    expect(linkTitle({ url: "#Videos/022%20-%20Worth%20Telling%20Them/022%20-%20Worth%20Telling%20Them%2FShorts%2F022_S09%20-%20You're%20Lucky", note: '022_S09' }, videos))
      .toBe("You're Lucky You Don't Remember");
    expect(linkTitle({ url: '#Videos/003%20-%20SDAM', note: '003 - SDAM' })).toBeUndefined();
    expect(linkTitle({ url: 'https://heartmindfusion.substack.com/p/test', note: 'Article' }, videos))
      .toBe('https://heartmindfusion.substack.com/p/test');
  });
});

describe('idea row labels', () => {
  const base = { notes: '', references: [], attachments: [] };
  it('leaves out values nobody has chosen yet', () => {
    expect(ideaLabels({ ...base, category: 'unassigned', format: 'undecided', status: 'raw' })).toBe('');
    expect(ideaLabels({ ...base, category: 'sdam', format: 'undecided', status: 'raw', notes: 'x' })).toBe('SDAM · Has Notes');
    expect(ideaLabels({ ...base, category: 'unassigned', format: 'undecided', status: 'processed' })).toBe('Processed');
    expect(ideaLabels({ ...base, category: 'unassigned', format: 'longform', status: 'brainstorming', references: [{ id: 'a', url: 'u', note: '' }] }))
      .toBe('Longform · Brainstorming · 1 Link');
  });
});
