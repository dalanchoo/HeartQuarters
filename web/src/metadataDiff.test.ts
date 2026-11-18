import { describe, expect, it } from 'vitest';
import { copyValuesMatch, metadataDiff } from './metadataDiff';
describe('metadata comparison', () => {
  it('detects matching copy values while distinguishing absent fields', () => {
    expect(copyValuesMatch('Title', 'Same', 'Same')).toBe(true);
    expect(copyValuesMatch('Title', '', '')).toBe(true);
    expect(copyValuesMatch('Title', null, '')).toBe(false);
    expect(copyValuesMatch('Title', 'One', 'Two')).toBe(false);
    expect(copyValuesMatch('Tags', 'Memory, SDAM', 'sdam, Memory')).toBe(true);
  });
  it('treats the same tags in a different order as the same', () => {
    const result = metadataDiff('Tags', 'Memory, SDAM, Heart Mind', 'heart mind, Memory, SDAM');
    expect(result.same).toBe(true); expect(result.reordered).toBe(true);
    expect(result.left.some((p) => p.changed)).toBe(false);
  });
  it('highlights tags found only on one side', () => {
    const result = metadataDiff('Tags', 'Memory, SDAM', 'Memory, Heart');
    expect(result.same).toBe(false); expect(result.left.find((p) => p.text === 'SDAM')?.changed).toBe(true);
    expect(result.right.find((p) => p.text === 'Heart')?.changed).toBe(true);
  });
  it('highlights changed words while preserving both original strings', () => {
    const result = metadataDiff('Description', 'A red car.\nNext line.', 'A blue car.\nNext line.');
    expect(result.left.map((p) => p.text).join('')).toBe('A red car.\nNext line.');
    expect(result.right.map((p) => p.text).join('')).toBe('A blue car.\nNext line.');
    expect(result.left.some((p) => p.changed && p.text.includes('red'))).toBe(true);
    expect(result.right.some((p) => p.changed && p.text.includes('blue'))).toBe(true);
  });
  it('highlights capitalization edits even for tag text in an edited draft', () => {
    const result = metadataDiff('Edited text', 'Memory, SDAM', 'memory, SDAM');
    expect(result.same).toBe(false);
    expect(result.left.some(part => part.changed && part.text.includes('Memory'))).toBe(true);
    expect(result.right.some(part => part.changed && part.text.includes('memory'))).toBe(true);
  });
  it('highlights changes in local-only fields as well', () => {
    const result = metadataDiff('Thumbnail idea', 'A quiet forest', 'A sunny forest');
    expect(result.left.some(p => p.changed && p.text.includes('quiet'))).toBe(true);
    expect(result.right.some(p => p.changed && p.text.includes('sunny'))).toBe(true);
  });
  it('highlights only a few words added to the top of a long description', () => {
    const long = 'I tried ayahuasca hoping something would change. '.repeat(200);
    const result = metadataDiff('Description', long, `XXXXXXX ${long}`);
    expect(result.limited).toBe(false);
    expect(result.right.filter(p => p.changed).map(p => p.text.trim())).toEqual(['XXXXXXX']);
    expect(result.left.every(p => !p.changed)).toBe(true);
    expect(result.right.map(p => p.text).join('')).toBe(`XXXXXXX ${long}`);
    expect(result.left.map(p => p.text).join('')).toBe(long);
  });
  it('bounds work for unusually large comparisons', () => {
    const result = metadataDiff('Description', 'one '.repeat(1000), 'two '.repeat(1000));
    expect(result.limited).toBe(true);
  });
});
