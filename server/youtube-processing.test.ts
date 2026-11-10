import { describe, expect, it } from 'vitest';
import { isShortPiece, waitForShortProcessing } from './youtube-processing';

describe('waiting for a Short', () => {
  it('recognizes both kinds of Short without treating longforms as Shorts', () => {
    expect(isShortPiece('022 - Example/Shorts/022_S01')).toBe(true);
    expect(isShortPiece('999 - Shorts/2026/999-2026-01')).toBe(true);
    expect(isShortPiece('022 - Example/Longform')).toBe(false);
  });
  it('waits until processing succeeds', async () => {
    const states = ['processing', 'processing', 'succeeded']; let pauses = 0;
    await waitForShortProcessing(async () => states.shift()!, async () => { pauses++; }, 4);
    expect(pauses).toBe(2);
  });
  it('stops on failure or a timeout', async () => {
    await expect(waitForShortProcessing(async () => 'failed', async () => {}, 2)).rejects.toThrow(/failed/);
    await expect(waitForShortProcessing(async () => 'processing', async () => {}, 2)).rejects.toThrow(/still processing/);
  });
});
