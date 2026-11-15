import { describe, expect, it } from 'vitest';
import { clampZoom, fitScale } from './expressionZoom';

describe('expression photo zoom', () => {
  it('fits wide and tall photos without enlarging small ones', () => {
    expect(fitScale(2000, 1000, 800, 600)).toBe(0.4);
    expect(fitScale(1000, 2000, 800, 600)).toBe(0.3);
    expect(fitScale(100, 100, 800, 600)).toBe(1);
  });
  it('keeps the zoom within the slider limits', () => {
    expect(clampZoom(0.5, 4)).toBe(1);
    expect(clampZoom(5, 4)).toBe(4);
    expect(clampZoom(2, 4)).toBe(2);
  });
});
