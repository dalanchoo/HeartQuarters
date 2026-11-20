import { describe, expect, it } from 'vitest';
import { applyStagedText, canSelectIncomingCopy, clashingFields, changedPackagingFields } from './stagedPackaging';

describe('pending packaging changes', () => {
  it('lists changed, added and removed fields without treating unchanged fields as changes', () => {
    expect(changedPackagingFields('Title:\nOld\n\nTags:\nA\n\nDescription:\nKeep\n', 'Title:\nNew\n\nDescription:\nKeep\n\nPinned Comment:\nHello\n')).toEqual(['Title', 'Tags', 'Pinned Comment']);
  });
  it('reports no changes when a draft is restored', () => {
    expect(changedPackagingFields('Title:\nA\n', 'Title:\nA\n')).toEqual([]);
  });
  it('applies the draft only while the original still matches', () => {
    expect(applyStagedText('original', 'original', 'edited')).toBe('edited');
    expect(() => applyStagedText('changed elsewhere', 'original', 'edited')).toThrow(/changed outside this page/);
  });
  it('merges your edited fields into a file that changed elsewhere, and refuses only a clash', () => {
    const baseline = `Title:
Old title

Description:
Old words
`;
    const draft = `Title:
Old title

Description:
My new words
`;
    const current = `Title:
A title set elsewhere

Description:
Old words
`;
    expect(applyStagedText(current, baseline, draft)).toBe(`Title:
A title set elsewhere

Description:
My new words
`);
    expect(clashingFields(current, baseline, draft)).toEqual([]);
    const clash = `Title:
Old title

Description:
Other words
`;
    expect(clashingFields(clash, baseline, draft)).toEqual(['Description']);
    expect(() => applyStagedText(clash, baseline, draft)).toThrow(/Description also changed outside this page/);
  });
  it('prevents an incoming copy from overwriting an edit while allowing a selected copy to be cancelled', () => {
    expect(canSelectIncomingCopy(true, false)).toBe(false);
    expect(canSelectIncomingCopy(false, false)).toBe(true);
    expect(canSelectIncomingCopy(true, true)).toBe(true);
  });
});
