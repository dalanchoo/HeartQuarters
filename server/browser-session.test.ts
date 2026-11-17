import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldOpenBrowser } from './browser-session';
import { makeTree, removeTree } from './testing';

describe('opening the app on startup', () => {
  it('opens once per watcher launch even when the parent process ID changes', () => {
    const dir = makeTree({});
    try {
      const first = '11111111-1111-4111-8111-111111111111'; const second = '22222222-2222-4222-8222-222222222222';
      expect(shouldOpenBrowser(false, dir, first, 1)).toBe(false);
      expect(shouldOpenBrowser(true, dir, first, 1)).toBe(true);
      expect(shouldOpenBrowser(true, dir, first, 2)).toBe(false);
      expect(shouldOpenBrowser(true, dir, second, 2)).toBe(true);
      expect(shouldOpenBrowser(true, dir, first, 3)).toBe(false);
    } finally { removeTree(dir); }
  });
});
