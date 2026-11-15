import { safeResolve } from './config.js';

/** Project-owned copies continue working when the library photo is removed. */
export function resolveExpressionPhoto(photo: string): string {
  return photo.startsWith('project:') ? safeResolve('projects', photo.slice(8)) : safeResolve('expressions', photo);
}
