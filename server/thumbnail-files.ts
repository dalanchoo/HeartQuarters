import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { safeResolve } from './config.js';
import { versionFolder } from './packaging-version.js';

const MAX_IMAGE = 2_000_000;
/** Inside a packaging version: the finished thumbnail, with Source/ for the Photoshop file and the art. */
export const THUMBNAIL_FOLDER = 'Thumbnail';

/**
 * A packaging version holds one thumbnail: Thumbnail/Thumbnail.png (or .jpg), with the Photoshop file and the art it
 * was made from in Thumbnail/Source. A second thumbnail belongs in a new version, so an existing one is never replaced.
 */
export function savePackagingThumbnail(piece: string, version: string, data: Buffer): { path: string } {
  versionFolder(piece, version);
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_IMAGE) throw new Error('Choose an image up to 2 MB.');
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!png && !jpeg) throw new Error('Choose a PNG or JPEG image.');
  const folder = safeResolve('projects', path.join(version, THUMBNAIL_FOLDER));
  fs.mkdirSync(folder, { recursive: true });
  const folderStat = fs.lstatSync(folder);
  if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw new Error('The Thumbnail folder must be a real folder, not a shortcut.');
  const existing = fs.readdirSync(folder).find((f) => /^Thumbnail\.(png|jpe?g)$/i.test(f));
  if (existing) throw new Error(`This version already has ${existing}. For a different thumbnail, make a new version; nothing was replaced.`);
  const file = safeResolve('projects', path.join(version, THUMBNAIL_FOLDER, png ? 'Thumbnail.png' : 'Thumbnail.jpg'));
  try { fs.writeFileSync(file, data, { flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This version already has a thumbnail; nothing was replaced.'); throw e; }
  return { path: path.relative(safeResolve('projects', ''), file).split(path.sep).join('/') };
}

/** Copy a finished image between versions of the same piece, never replacing an existing thumbnail. */
export function copyVersionThumbnail(piece: string, source: string, target: string, expected?: { size: number; modified: number }, sourceExpected?: { size: number; modified: number }): { path: string } {
  const fromVersion = versionFolder(piece, source); const toVersion = versionFolder(piece, target);
  if (fromVersion.toLowerCase() === toVersion.toLowerCase()) throw new Error('Choose a different source version.');
  const fromFolder = safeResolve('projects', path.join(source, THUMBNAIL_FOLDER));
  if (!fs.lstatSync(fromFolder).isDirectory() || fs.lstatSync(fromFolder).isSymbolicLink()) throw new Error('The source thumbnail folder must be a real folder.');
  const names = fs.readdirSync(fromFolder).filter(name => /^Thumbnail\.(png|jpe?g)$/i.test(name));
  if (names.length !== 1) throw new Error('The source version must have exactly one thumbnail.');
  const image = safeResolve('projects', path.join(source, THUMBNAIL_FOLDER, names[0]));
  const sourceStat = fs.lstatSync(image);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('The source thumbnail must be a real file.');
  if (sourceExpected && (sourceStat.size !== sourceExpected.size || Math.round(sourceStat.mtimeMs) !== sourceExpected.modified)) throw new Error('The source thumbnail changed. Reload before copying.');
  const toFolder = safeResolve('projects', path.join(target, THUMBNAIL_FOLDER));
  fs.mkdirSync(toFolder, { recursive: true });
  if (!fs.lstatSync(toFolder).isDirectory() || fs.lstatSync(toFolder).isSymbolicLink()) throw new Error('The destination thumbnail folder must be a real folder.');
  const oldNames = fs.readdirSync(toFolder).filter(name => /^Thumbnail\.(png|jpe?g)$/i.test(name));
  if (oldNames.length > 1) throw new Error('This version has multiple thumbnails; nothing was replaced.');
  const filename = `Thumbnail${path.extname(names[0]).toLowerCase()}`;
  const dest = safeResolve('projects', path.join(target, THUMBNAIL_FOLDER, filename));
  if (!oldNames.length) {
    if (expected) throw new Error('The destination thumbnail changed. Reload before copying.');
    fs.copyFileSync(image, dest, fs.constants.COPYFILE_EXCL);
  } else {
    if (!expected) throw new Error('This version already has a thumbnail; nothing was replaced.');
    const old = safeResolve('projects', path.join(target, THUMBNAIL_FOLDER, oldNames[0])); const stat = fs.lstatSync(old);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size || Math.round(stat.mtimeMs) !== expected.modified) throw new Error('The destination thumbnail changed. Reload before copying.');
    const backupDir = safeResolve('projects', path.join(target, THUMBNAIL_FOLDER, 'Backups')); fs.mkdirSync(backupDir, { recursive: true });
    if (!fs.lstatSync(backupDir).isDirectory() || fs.lstatSync(backupDir).isSymbolicLink()) throw new Error('The backup folder must be a real folder.');
    const backup = path.join(backupDir, `Replaced ${randomUUID()} - ${oldNames[0]}`);
    const temp = path.join(toFolder, `Copy-${randomUUID()}.tmp`);
    fs.copyFileSync(image, temp, fs.constants.COPYFILE_EXCL);
    let moved = false;
    try { fs.renameSync(old, backup); moved = true; fs.copyFileSync(temp, dest, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (moved) { try { if (fs.existsSync(old)) throw new Error('destination occupied'); fs.renameSync(backup, old); } catch { throw new Error(`Copy failed and the previous thumbnail could not be restored. It is saved at ${backup}.`); } } throw error; }
    finally { try { fs.unlinkSync(temp); } catch { /* no temporary file remains on success */ } }
  }
  return { path: path.relative(safeResolve('projects', ''), dest).split(path.sep).join('/') };
}

export function decodeThumbnail(value: unknown): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_IMAGE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid image data. Choose a PNG or JPEG up to 2 MB.');
  return Buffer.from(value, 'base64');
}

function youtubeImageUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'i.ytimg.com' || parsed.port || parsed.username || parsed.password) throw new Error('YouTube returned an unsupported thumbnail address.');
  return parsed;
}

/**
 * The largest thumbnail YouTube really serves. It sometimes lists sizes (such as qhd) that answer "not found" with a
 * small grey placeholder, so each is checked, largest first. Checking images costs no quota.
 * YouTube's image servers keep an old copy for up to 2 hours after a new thumbnail is set, at the same address, so a
 * changing number is added to it: the image is then always the current one.
 */
export async function firstWorkingThumbnail(urls: string[], now = Date.now()): Promise<string | null> {
  for (const url of urls) {
    try {
      const fresh = youtubeImageUrl(url);
      fresh.searchParams.set('hq', String(now));
      const res = await fetch(fresh, { method: 'HEAD', redirect: 'error' });
      if (res.ok) return fresh.toString();
    } catch { /* try the next size */ }
  }
  return null;
}

/** Fetch only a YouTube image URL returned by YouTube, without following redirects. */
export async function fetchYoutubeThumbnail(url: string, signal?: AbortSignal): Promise<Buffer> {
  const parsed = youtubeImageUrl(url);
  const res = await fetch(parsed, { redirect: 'error', ...(signal ? { signal } : {}) });
  if (!res.ok || !res.body) throw new Error('Could not download the thumbnail from YouTube.');
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_IMAGE) throw new Error('The YouTube image is larger than 2 MB.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
