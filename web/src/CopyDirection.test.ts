import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CopyDirectionControls, localCopyDirection, youtubeCopyDirection } from './CopyDirection';

describe('copy direction indicator', () => {
  it('points toward YouTube or the local version on either side', () => {
    expect(youtubeCopyDirection(false, true, false)).toBe('left-to-right');
    expect(youtubeCopyDirection(false, false, true)).toBe('right-to-left');
    expect(youtubeCopyDirection(true, true, false)).toBe('right-to-left');
    expect(youtubeCopyDirection(true, false, true)).toBe('left-to-right');
    expect(youtubeCopyDirection(false, false, false)).toBeNull();
  });
  it('points toward the unlocked local version and clears when deselected', () => {
    expect(localCopyDirection(true, true)).toBe('left-to-right');
    expect(localCopyDirection(true, false)).toBe('right-to-left');
    expect(localCopyDirection(false, true)).toBeNull();
  });
  it('offers an explicit No Copy radio choice and marks the chosen direction', () => {
    const html = renderToStaticMarkup(createElement(CopyDirectionControls, { left: 'V03', right: 'V05', selected: 'left-to-right', canCopyRight: true, canCopyLeft: false, copyRight: () => {}, copyLeft: () => {} }));
    expect(html).toContain('No Copy');
    expect(html).toMatch(/type="radio"[^>]*checked=""\/> V03 → V05/);
    expect(html).toMatch(/type="radio"[^>]*disabled=""[^>]*\/> V03 ← V05/);
  });
  it('hides a direction when its destination is locked', () => {
    const html = renderToStaticMarkup(createElement(CopyDirectionControls, { left: 'V03', right: 'V05', selected: null, canCopyRight: true, canCopyLeft: false, showCopyLeft: false, copyRight: () => {}, copyLeft: () => {} }));
    expect(html).toContain('V03 → V05');
    expect(html).not.toContain('V03 ← V05');
  });
});
