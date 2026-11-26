import { describe, expect, it } from 'vitest';
import { ideaLabels, looksLikeLink } from './IdeasPage';
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

describe('idea link autosave', () => {
  it('waits until a typed address looks like a link', () => {
    expect(looksLikeLink('https://example.com')).toBe(true);
    expect(looksLikeLink('  #Videos/001%20-%20Video ')).toBe(true);
    expect(looksLikeLink('https://')).toBe(false);
    expect(looksLikeLink('#Videos/')).toBe(false);
    expect(looksLikeLink('example.com')).toBe(false);
    expect(looksLikeLink('')).toBe(false);
  });
});

describe('idea row labels', () => {
  const base = { notes: '', references: [], attachments: [] };
  it('leaves out values nobody has chosen yet', () => {
    expect(ideaLabels({ ...base, category: 'unassigned', format: 'undecided', status: 'thinking' })).toBe('');
    expect(ideaLabels({ ...base, category: 'sdam', format: 'undecided', status: 'thinking', notes: 'x' })).toBe('SDAM · Has Notes');
    expect(ideaLabels({ ...base, category: 'unassigned', format: 'longform', status: 'brainstorming', references: [{ id: 'a', url: 'u', note: '' }] }))
      .toBe('Longform · Brainstorming · 1 Link');
  });
});
