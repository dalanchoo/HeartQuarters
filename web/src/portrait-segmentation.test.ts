import { describe, expect, it } from 'vitest';
import { subjectBounds } from './portrait-segmentation';
describe('subject crop', () => {
  it('finds visible pixels and adds padding', () => {
    const data = new Uint8ClampedArray(20 * 20 * 4); data[(5 * 20 + 6) * 4 + 3] = 255; data[(12 * 20 + 14) * 4 + 3] = 64;
    expect(subjectBounds(data, 20, 20)).toEqual({ x: 5, y: 4, width: 11, height: 10 });
  });
  it('ignores faint noise and reports an empty selection', () => {
    const data = new Uint8ClampedArray(16); data[3] = 10;
    expect(() => subjectBounds(data, 2, 2)).toThrow(/No subject/);
  });
});
