import { describe, expect, it } from 'vitest';
import { comparisonSelection, localCopyTarget, YOUTUBE_SELECTION as yt } from './comparisonSelection';

describe('packaging comparison selections', () => {
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
