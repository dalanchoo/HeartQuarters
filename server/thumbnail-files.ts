import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { checkFolderName } from './create.js';
import { versionFolder } from './packaging-version.js';

const MAX_IMAGE = 2_000_000;

/** Add a new image without replacing an existing packaging file. */
export function savePackagingThumbnail(piece: string, version: string, proposedName: unknown, data: Buffer): { path: string } {
  versionFolder(piece, version);
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_IMAGE) throw new Error('Choose an image up to 2 MB.');
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!png && !jpeg) throw new Error('Choose a PNG or JPEG image.');
  const name = checkFolderName(proposedName);
  if (!((png && /\.png$/i.test(name)) || (jpeg && /\.jpe?g$/i.test(name)))) throw new Error('The filename must match the image format (.png or .jpg).');
  const folder = safeResolve('projects', path.join(version, 'Covers'));
  fs.mkdirSync(folder, { recursive: true });
  const file = safeResolve('projects', path.join(version, 'Covers', name));
  try { fs.writeFileSync(file, data, { flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A thumbnail with that name already exists. Choose another name; nothing was overwritten.'); throw e; }
  return { path: path.relative(safeResolve('projects', ''), file).split(path.sep).join('/') };
}

export function decodeThumbnail(value: unknown): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_IMAGE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid image data. Choose a PNG or JPEG up to 2 MB.');
  return Buffer.from(value, 'base64');
}

/** Fetch only a YouTube image URL returned by YouTube, without following redirects. */
export async function fetchYoutubeThumbnail(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'i.ytimg.com' || parsed.port || parsed.username || parsed.password) throw new Error('YouTube returned an unsupported thumbnail address.');
  const res = await fetch(parsed, { redirect: 'error' });
  if (!res.ok || !res.body) throw new Error('Could not download the thumbnail from YouTube.');
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_IMAGE) throw new Error('The YouTube image is larger than 2 MB.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
