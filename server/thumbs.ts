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

/**
 * After FFmpeg: moves the finished preview into place, or cleans up and explains. Any file error (a full disk, a locked
 * file) is thrown here, so the caller can turn it into a refused preview instead of an error that stops HeartQuarters.
 */
export function finishPreview(code: number | null, tmp: string, out: string, err: string): string {
  if (code === 0 && fs.existsSync(tmp)) {
    try {
      fs.renameSync(tmp, out);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`Couldn't save the preview: ${e instanceof Error ? e.message : String(e)}`);
    }
    return out;
  }
  fs.rmSync(tmp, { force: true });
  throw new Error(`Couldn't make a preview: ${err.trim() || `ffmpeg exit ${code}`}`);
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
    // Inside a callback, an uncaught error would stop the whole server, so every failure becomes a rejection.
    child.on('close', (code) => {
      try {
        resolve(finishPreview(code, tmp, out, err));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/** Returns the path of a cached JPEG preview of `source`, `width` pixels wide. */
export function thumbnail(source: string, width: number): Promise<string> {
  const st = fs.statSync(source);
  const key = crypto
    .createHash('sha1')
    .update(`${source}|${st.size}|${st.mtimeMs}|${st.ctimeMs}|${width}`)
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
