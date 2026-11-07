// Small preview images, made with FFmpeg the first time they're asked for and
// kept in data/thumbs (outside Drive; safe to delete, they'll be remade).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './config.js';

const cacheDir = path.join(appDir, 'data', 'thumbs');
const MAX_AT_ONCE = 4;
const pending = new Map<string, Promise<string>>();
let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function runFfmpeg(source: string, out: string, width: number): Promise<string> {
  const tmp = `${out}.${process.pid}.tmp.jpg`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', source, '-vf', `scale=${width}:-2`, '-frames:v', '1', '-q:v', '5', tmp],
      { windowsHide: true },
    );
    let err = '';
    child.stderr.on('data', (b: Buffer) => (err += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) {
        fs.renameSync(tmp, out);
        resolve(out);
      } else {
        fs.rmSync(tmp, { force: true });
        reject(new Error(`Couldn't make a preview: ${err.trim() || `ffmpeg exit ${code}`}`));
      }
    });
  });
}

/** Returns the path of a cached JPEG preview of `source`, `width` pixels wide. */
export function thumbnail(source: string, width: number): Promise<string> {
  const st = fs.statSync(source);
  const key = crypto
    .createHash('sha1')
    .update(`${source}|${st.size}|${st.mtimeMs}|${width}`)
    .digest('hex');
  const out = path.join(cacheDir, `${key}.jpg`);
  if (fs.existsSync(out)) return Promise.resolve(out);

  let job = pending.get(key);
  if (!job) {
    fs.mkdirSync(cacheDir, { recursive: true });
    job = limited(() => runFfmpeg(source, out, width)).finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}
