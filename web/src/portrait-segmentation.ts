/** Bounds of the visible foreground, with a little breathing room. */
export function subjectBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 32) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] >= threshold) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < left || bottom < top) throw new Error('No subject was found. Try a different photo or adjust the outline.');
  const padding = Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.06);
  const x = Math.max(0, left - padding), y = Math.max(0, top - padding);
  return { x, y, width: Math.min(width, right + 1 + padding) - x, height: Math.min(height, bottom + 1 + padding) - y };
}
