/** Fit the entire photo in the viewer without enlarging a small original. */
export function fitScale(width: number, height: number, viewportWidth: number, viewportHeight: number): number {
  if (!width || !height || !viewportWidth || !viewportHeight) return 1;
  return Math.min(1, viewportWidth / width, viewportHeight / height);
}

export function clampZoom(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(1, value));
}

/** Keep a zoomed photo at its original-size percentage when its viewing area changes. */
export function zoomAfterResize(oldFit: number, oldZoom: number, newFit: number): number {
  if (oldZoom <= 1) return 1;
  return clampZoom(oldFit * oldZoom / newFit, 2 / newFit);
}

/** Convert the multiplier relative to fit into a percentage of the original image size. */
export function originalSizePercent(fit: number, zoom: number): number {
  return fit * zoom * 100;
}

/** Make original size easy to select without preventing movement past it. */
export function snapOriginalSize(percent: number): number {
  return Math.abs(percent - 100) <= 4 ? 100 : percent;
}
