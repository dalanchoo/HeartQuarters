// Helpers for tests: build a small fake folder tree in a temp directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Creates a temp folder containing `files` (relative path -> contents).
 * A path ending in "/" makes an empty folder. Returns the temp folder's path.
 */
export function makeTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
  }
  return root;
}

export function removeTree(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
}
