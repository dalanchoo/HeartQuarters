import { describe, expect, it } from 'vitest';
import { looksLikeLink } from './IdeasPage';
import { hasPendingEdits, setPendingEdit } from './unsavedEdits';

describe('unsaved edits', () => {
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
