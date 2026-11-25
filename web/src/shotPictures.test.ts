import { describe, expect, it } from 'vitest';
import { stepPicture } from './shotPictures';

describe("stepping through a look's pictures", () => {
  const list = ['reference-003.png', 'reference-002.png', 'reference-001.png'];
  it('goes to the next and previous picture, round at either end', () => {
    expect(stepPicture(list, 'reference-003.png', 1)).toBe('reference-002.png');
    expect(stepPicture(list, 'reference-001.png', 1)).toBe('reference-003.png');
    expect(stepPicture(list, 'reference-003.png', -1)).toBe('reference-001.png');
  });
  it('starts from the newest when the current picture is gone', () => {
    expect(stepPicture(list, 'deleted.png', 1)).toBe('reference-002.png');
  });
});
