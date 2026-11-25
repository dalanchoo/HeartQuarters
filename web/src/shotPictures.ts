/** The picture `by` steps from `current` in a look's list (newest first), going round at either end. */
export function stepPicture(list: string[], current: string, by: number): string {
  const at = Math.max(0, list.indexOf(current));
  return list[(at + by + list.length) % list.length];
}
