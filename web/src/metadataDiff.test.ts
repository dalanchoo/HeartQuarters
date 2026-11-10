import { describe, expect, it } from 'vitest';
import { metadataDiff } from './metadataDiff';
describe('metadata comparison', () => {
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
  it('bounds work for unusually large comparisons', () => {
    const result = metadataDiff('Description', 'one '.repeat(1000), 'two '.repeat(1000));
    expect(result.limited).toBe(true);
  });
});
