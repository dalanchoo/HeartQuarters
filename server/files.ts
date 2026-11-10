// Saving a file all at once: written next to it under a new name first, then swapped in. A crash can't leave half a
// file, and the temporary name is new every time, so it can never be an existing file that gets overwritten.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

export function writeFileSafely(file: string, data: string) {
  const tmp = `${file}.${randomUUID().slice(0, 8)}.hq-tmp`;
  // "wx" refuses to write if a file by that name already exists, however unlikely.
  fs.writeFileSync(tmp, data, { flag: 'wx' });
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true }); // only ever the file made just above
    throw e;
  }
}
