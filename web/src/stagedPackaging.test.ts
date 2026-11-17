import { describe, expect, it } from 'vitest';
import { applyStagedText, changedPackagingFields } from './stagedPackaging';

describe('pending packaging changes', () => {
  it('lists changed, added and removed fields without treating unchanged fields as changes', () => {
    expect(changedPackagingFields('Title:\nOld\n\nTags:\nA\n\nDescription:\nKeep\n', 'Title:\nNew\n\nDescription:\nKeep\n\nPinned Comment:\nHello\n')).toEqual(['Title', 'Tags', 'Pinned Comment']);
  });
  it('reports no changes when a draft is restored', () => {
    expect(changedPackagingFields('Title:\nA\n', 'Title:\nA\n')).toEqual([]);
  });
  it('applies the draft only while the original still matches', () => {
    expect(applyStagedText('original', 'original', 'edited')).toBe('edited');
    expect(() => applyStagedText('changed elsewhere', 'original', 'edited')).toThrow(/changed since/);
  });
});
