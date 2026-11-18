import { describe, expect, it } from 'vitest';
import { availableComparisonChoices, choiceOrder, comparisonSelection, DRAFT_SELECTION as draft, localCopyTarget, orderedChoices, rightChoices, YOUTUBE_SELECTION as yt } from './comparisonSelection';

describe('packaging comparison selections', () => {
  it('preserves both choices when the current or unlocked version changes', () => {
    const chosen = { left: 'v3', right: 'v5' };
    expect(availableComparisonChoices(chosen, 'v4', ['v3', 'v4', 'v5'])).toEqual(chosen);
    expect(availableComparisonChoices(chosen, 'v5', ['v3', 'v4', 'v5'])).toEqual(chosen);
  });
  it('falls back only when a selected version is unavailable', () => {
    expect(availableComparisonChoices({ left: 'v3', right: 'v5' }, 'v4', ['v4', 'v5'])).toEqual({ left: 'v4', right: 'v5' });
    expect(availableComparisonChoices({ left: yt, right: 'v3' }, 'v4', ['v4'])).toEqual({ left: yt, right: yt });
    expect(availableComparisonChoices({ left: 'v4', right: '' }, 'v4', ['v4'])).toEqual({ left: 'v4', right: '' });
  });
  it('compares the chosen version with YouTube in either order', () => {
    expect(comparisonSelection('v1', yt, 'v2')).toEqual({ youtube: true, localPath: 'v1', display: 'diff', reverse: false });
    expect(comparisonSelection(yt, 'v1', 'v2')).toEqual({ youtube: true, localPath: 'v1', display: 'diff', reverse: true });
  });
  it('views a single local version or YouTube', () => {
    expect(comparisonSelection('v1', '', 'v2').display).toBe('local');
    expect(comparisonSelection(yt, '', 'v2')).toEqual({ youtube: true, localPath: 'v2', display: 'youtube', reverse: false });
  });
  it('keeps two local versions out of the YouTube view', () => {
    expect(comparisonSelection('v1', 'v2', 'v2').youtube).toBe(false);
  });
});

describe('local version copy target', () => {
  it('copies into the unlocked version on either side, including an older version', () => {
    expect(localCopyTarget('v5', 'v4', 'v4')).toEqual({ source: 'v5', target: 'v4' });
    expect(localCopyTarget('v4', 'v5', 'v4')).toEqual({ source: 'v5', target: 'v4' });
  });
  it('does not select a locked or absent version as the target', () => {
    expect(localCopyTarget('v5', 'v4', null)).toBeNull();
    expect(localCopyTarget('v5', 'v4', 'v3')).toBeNull();
    expect(localCopyTarget('v4', 'v4', 'v4')).toBeNull();
  });
});

describe('Draft first, YouTube last, the left always earlier', () => {
  const order = choiceOrder(['v1', 'v2', 'v5'], true);
  it('puts Draft first and YouTube last', () => {
    expect(order).toEqual([draft, 'v1', 'v2', 'v5', yt]);
    expect(choiceOrder(['v1'], false)).toEqual(['v1', yt]);
  });
  it('offers only later choices on the right, and never YouTube beside Draft', () => {
    expect(rightChoices('v2', order)).toEqual(['v5', yt]);
    expect(rightChoices(draft, order)).toEqual(['v1', 'v2', 'v5']);
    expect(rightChoices(yt, order)).toEqual([]);
  });
  it('fixes a right choice that is not later than the left', () => {
    expect(orderedChoices({ left: 'v5', right: 'v2' }, 'v5', order)).toEqual({ left: 'v5', right: yt });
    expect(orderedChoices({ left: draft, right: yt }, 'v5', order)).toEqual({ left: draft, right: 'v1' });
    expect(orderedChoices({ left: yt, right: 'v1' }, 'v5', order)).toEqual({ left: yt, right: '' });
    expect(orderedChoices({ left: 'v2', right: 'v5' }, 'v5', order)).toEqual({ left: 'v2', right: 'v5' });
    expect(orderedChoices({ left: 'v2', right: '' }, 'v5', order)).toEqual({ left: 'v2', right: '' });
  });
  it('falls back when Draft or a version is gone', () => {
    expect(orderedChoices({ left: draft, right: 'v1' }, 'v5', choiceOrder(['v1', 'v5'], false))).toEqual({ left: 'v5', right: yt });
  });
});
