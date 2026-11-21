import { describe, expect, it } from 'vitest';
import { clampSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './SidebarResizer';

describe('left column width', () => {
  it('stays between the narrowest and widest allowed', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(355.4)).toBe(355);
  });
  it('leaves room for the main panel in a small window', () => {
    expect(clampSidebarWidth(600, 800)).toBe(440);
    expect(clampSidebarWidth(600, 400)).toBe(SIDEBAR_MIN);
  });
  it('uses the standard width for a value that is not a number', () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT);
  });
});
