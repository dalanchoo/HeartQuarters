export type Point = { x: number; y: number };
/** Bounds of a normalized outline with optional padding, clipped to the original image. */
export function outlineBounds(points: Point[], width: number, height: number, padding = 0.06) {
  if (points.length < 3 || width <= 0 || height <= 0) throw new Error('Draw an outline around the portrait first.');
  const xs = points.map(p => Math.min(1, Math.max(0, p.x)) * width);
  const ys = points.map(p => Math.min(1, Math.max(0, p.y)) * height);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  if (right - left < 2 || bottom - top < 2) throw new Error('Draw a larger outline around the portrait.');
  const margin = Math.max(right - left, bottom - top) * padding;
  const x = Math.max(0, Math.floor(left - margin)), y = Math.max(0, Math.floor(top - margin));
  return { x, y, width: Math.min(width, Math.ceil(right + margin)) - x, height: Math.min(height, Math.ceil(bottom + margin)) - y };
}
