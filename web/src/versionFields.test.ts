import { describe, expect, it } from 'vitest';
import { comparisonLabels, copyVersionFields } from './versionFields';
describe('copying packaging fields', () => {
  it('copies selected multiline fields while preserving other values', () => {
    const target = 'Title:\nKeep\n\nDescription:\nOld\n\nTags:\nA\n';
    const source = 'Title:\nOther\n\nDescription:\nFirst\n\nSecond\n\nTags:\nB\n';
    const result = copyVersionFields(target, source, ['Description']);
    expect(result).toContain('Title:\nKeep'); expect(result).toContain('First\n\nSecond'); expect(result).toContain('Tags:\nA');
  });
  it('rejects duplicate or missing source fields', () => {
    expect(() => copyVersionFields('Title:\nA\n', 'Title:\nB\n', ['Description'])).toThrow();
  });
});

describe('comparing packaging versions', () => {
  it('includes fields present in only one version without duplicating matching names', () => {
    expect(comparisonLabels('Title:\nOne\n\nTags:\nA\n', 'TITLE:\nTwo\n\nDescription:\nText\n')).toEqual(['Title', 'Tags', 'Description']);
  });
});
