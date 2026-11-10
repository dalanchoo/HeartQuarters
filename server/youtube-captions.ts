import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeResolve } from './config.js';

const MAX_SIZE = 10 * 1024 * 1024;
const EXT = /\.(vtt|srt|sbv)$/i;

/** Only timed caption files immediately inside this piece's Subtitles folder. */
export function subtitleFiles(piece: string): { name: string; path: string }[] {
  if (!piece) throw new Error('Choose a video.');
  const folder = safeResolve('projects', path.join(piece, 'Subtitles'));
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  return entries.filter((e) => e.isFile() && EXT.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((e) => ({ name: e.name, path: path.join(piece, 'Subtitles', e.name).split(path.sep).join('/') }));
}

export function readSubtitle(piece: string, relative: string): Buffer {
  if (!subtitleFiles(piece).some((f) => f.path === relative)) throw new Error('Choose a subtitle file from this video’s Subtitles folder.');
  const full = safeResolve('projects', relative);
  const size = fs.statSync(full).size;
  if (!size || size > MAX_SIZE) throw new Error('The subtitle file is empty or larger than 10 MB.');
  return fs.readFileSync(full);
}

/** Upload a timed English track. YouTube processes it after accepting it. */
export async function uploadSubtitle(token: string, videoId: string, bytes: Buffer, language = 'en-US'): Promise<void> {
  const boundary = `hq-${randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ snippet: { videoId, language, name: 'HeartQuarters subtitles' } })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const response = await fetch('https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(Buffer.concat([head, bytes, tail])),
  });
  if (!response.ok) {
    let message = `YouTube returned ${response.status}`;
    try { const body = await response.json() as { error?: { message?: string } }; message = body.error?.message ?? message; } catch { /* keep status */ }
    throw new Error(message);
  }
}
