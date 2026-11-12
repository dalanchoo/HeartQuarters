import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeResolve } from './config.js';
import { youtubeCaptionTracks } from './youtube-video.js';

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

/** "en-US" and "en" are the same language for captions: YouTube may report either. */
const sameLanguage = (a: string, b: string) => a.split('-')[0].toLowerCase() === b.split('-')[0].toLowerCase();

/** Replaces the file of a caption track already on YouTube, keeping the track itself. */
async function replaceSubtitle(token: string, captionId: string, bytes: Buffer): Promise<void> {
  const boundary = `hq-${randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id: captionId, snippet: { isDraft: false } })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const response = await fetch('https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart', {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(Buffer.concat([head, bytes, tail])),
  });
  if (!response.ok) {
    let message = `YouTube returned ${response.status}`;
    try { const body = await response.json() as { error?: { message?: string } }; message = body.error?.message ?? message; } catch { /* keep status */ }
    throw new Error(message);
  }
}

/**
 * Sends captions to a video that's already on YouTube. With no uploaded track in this language, it adds one. With one,
 * it replaces that track's file, so the video never ends up with two. With more than one, it stops: which to replace is
 * John's call, in Studio. Automatic captions YouTube made itself are left alone.
 */
export async function sendSubtitle(token: string, videoId: string, bytes: Buffer, language: string): Promise<'added' | 'replaced'> {
  const uploaded = (await youtubeCaptionTracks(token, videoId)).filter((t) => t.kind.toLowerCase() !== 'asr' && sameLanguage(t.language, language));
  if (uploaded.length > 1) throw new Error(`This video has ${uploaded.length} uploaded caption tracks in this language. Delete the extra ones in YouTube Studio, then try again.`);
  if (uploaded.length === 1) {
    await replaceSubtitle(token, uploaded[0].id, bytes);
    return 'replaced';
  }
  await uploadSubtitle(token, videoId, bytes, language);
  return 'added';
}
