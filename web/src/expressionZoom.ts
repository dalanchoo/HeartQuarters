/** Fit the entire photo in the viewer without enlarging a small original. */
export function fitScale(width: number, height: number, viewportWidth: number, viewportHeight: number): number {
  if (!width || !height || !viewportWidth || !viewportHeight) return 1;
  return Math.min(1, viewportWidth / width, viewportHeight / height);
}

export function clampZoom(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(1, value));
}

/** Convert the multiplier relative to fit into a percentage of the original image size. */
export function originalSizePercent(fit: number, zoom: number): number {
  return fit * zoom * 100;
}
