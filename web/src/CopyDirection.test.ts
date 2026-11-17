import { describe, expect, it } from 'vitest';
import { localCopyDirection, youtubeCopyDirection } from './CopyDirection';

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
});
