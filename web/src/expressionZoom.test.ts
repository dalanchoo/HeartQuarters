import { describe, expect, it } from 'vitest';
import { clampZoom, fitScale, originalSizePercent, snapOriginalSize, zoomAfterResize } from './expressionZoom';

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
  it('keeps the original-size zoom when the viewing area changes, unless fitting needs more space', () => {
    expect(zoomAfterResize(0.2, 3.4, 0.4)).toBeCloseTo(1.7);
    expect(zoomAfterResize(0.4, 1.7, 0.2)).toBeCloseTo(3.4);
    expect(zoomAfterResize(0.2, 1, 0.4)).toBe(1);
    expect(zoomAfterResize(0.2, 1.5, 0.4)).toBe(1);
  });
  it('reports zoom relative to the original photo rather than the fitted size', () => {
    const fit = fitScale(4000, 2000, 500, 500);
    expect(originalSizePercent(fit, 1)).toBe(12.5);
    expect(originalSizePercent(fit, 8)).toBe(100);
    expect(originalSizePercent(fit, 16)).toBe(200);
  });
  it('snaps close values to 100% but still allows zooming past it', () => {
    expect(snapOriginalSize(96)).toBe(100);
    expect(snapOriginalSize(103)).toBe(100);
    expect(snapOriginalSize(95)).toBe(95);
    expect(snapOriginalSize(105)).toBe(105);
  });
});
