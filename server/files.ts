// Saving a file all at once: written next to it under a new name first, then swapped in. A crash can't leave half a
// file, and the temporary name is new every time, so it can never be an existing file that gets overwritten.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const RETRY_CODES = new Set(['EPERM', 'EBUSY']);
const RENAME_DELAYS_MS = [25, 50, 100, 150];

function pauseSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function writeFileSafely(file: string, data: string) {
  const tmp = `${file}.${randomUUID().slice(0, 8)}.hq-tmp`;
  // "wx" refuses to write if a file by that name already exists, however unlikely.
  fs.writeFileSync(tmp, data, { flag: 'wx' });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? '';
        if (!RETRY_CODES.has(code) || attempt >= RENAME_DELAYS_MS.length) throw e;
        pauseSync(RENAME_DELAYS_MS[attempt]);
      }
    }
  } catch (e) {
    fs.rmSync(tmp, { force: true }); // only ever the file made just above
    throw e;
  }
}
