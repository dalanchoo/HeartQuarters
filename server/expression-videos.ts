// Manages AI-generated expression videos in Expressions\_GeneratedVideos so John can drop them in,
// scrub frame-by-frame to capture snapshots into _Inbox, rename them, or move them to Trash.
import fs from 'node:fs';
import path from 'node:path';
import { config, isInside, safeResolve } from './config.js';
import { readable, writable } from './safe-files.js';

export const GENERATED_VIDEOS_FOLDER = '_GeneratedVideos';
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

export interface GeneratedVideo {
  name: string;
  /** Relative to expressionsDir, e.g. "_GeneratedVideos/clip.mp4". */
  path: string;
  size: number;
  modified: number;
}

export function ensureGeneratedVideosDir(): string {
  const dir = safeResolve('expressions', GENERATED_VIDEOS_FOLDER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error('The generated videos folder must be a real folder.');
  }
  return dir;
}

function cleanVideoName(raw: unknown): { stem: string; ext: string } {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Choose a video file name.');
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const ext = path.extname(base).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) throw new Error('Only MP4, MOV, and WebM videos are supported.');
  const stem = path
    .basename(base, ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  const safeStem = !stem || stem === '.' || stem === '..' || RESERVED.test(stem) ? 'Video' : stem;
  return { stem: safeStem, ext };
}

function checkedVideoFile(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\\')) {
    throw new Error('Choose a video from the list.');
  }
  const dir = ensureGeneratedVideosDir();
  const full = safeResolve('expressions', `${GENERATED_VIDEOS_FOLDER}/${name}`);
  if (path.dirname(full).toLowerCase() !== path.resolve(dir).toLowerCase()) {
    throw new Error('Invalid video name.');
  }
  if (!VIDEO_EXTS.has(path.extname(full).toLowerCase())) {
    throw new Error('Only MP4, MOV, and WebM videos are supported.');
  }
  const stat = fs.lstatSync(full, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('That video file was not found.');
  }
  return full;
}

export function listGeneratedVideos(): GeneratedVideo[] {
  const dir = safeResolve('expressions', GENERATED_VIDEOS_FOLDER);
  if (!fs.existsSync(dir)) return [];
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error('The generated videos folder must be a real folder.');
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.isSymbolicLink() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const full = path.join(dir, e.name);
      const stat = fs.statSync(full);
      return {
        name: e.name,
        path: `${GENERATED_VIDEOS_FOLDER}/${e.name}`,
        size: stat.size,
        modified: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

export function saveGeneratedVideo(rawName: unknown, bytes: Buffer): GeneratedVideo {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('The uploaded video is empty.');
  if (bytes.length > MAX_VIDEO_BYTES) throw new Error('Videos must be 250 MB or smaller.');
  const dir = ensureGeneratedVideosDir();
  const { stem, ext } = cleanVideoName(rawName);
  const existing = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n++})${ext}`;
  }
  const target = safeResolve('expressions', `${GENERATED_VIDEOS_FOLDER}/${candidate}`);
  writable(target, 'expressions');
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  const stat = fs.statSync(target);
  return { name: candidate, path: `${GENERATED_VIDEOS_FOLDER}/${candidate}`, size: stat.size, modified: stat.mtimeMs };
}

export function renameGeneratedVideo(oldName: unknown, newRawName: unknown): GeneratedVideo {
  const from = checkedVideoFile(oldName);
  const oldExt = path.extname(from).toLowerCase();
  const raw = typeof newRawName === 'string' ? newRawName.trim() : '';
  if (!raw) throw new Error('Type a new name for the video.');
  const withExt = VIDEO_EXTS.has(path.extname(raw).toLowerCase()) ? raw : `${raw}${oldExt}`;
  const { stem, ext } = cleanVideoName(withExt);
  const nextName = `${stem}${ext}`;
  const to = safeResolve('expressions', `${GENERATED_VIDEOS_FOLDER}/${nextName}`);
  if (from.toLowerCase() !== to.toLowerCase() && fs.existsSync(to)) {
    throw new Error(`"${nextName}" already exists.`);
  }
  writable(from, 'expressions');
  writable(to, 'expressions');
  fs.renameSync(from, to);
  const stat = fs.statSync(to);
  return { name: nextName, path: `${GENERATED_VIDEOS_FOLDER}/${nextName}`, size: stat.size, modified: stat.mtimeMs };
}

export function trashGeneratedVideo(name: unknown): { trashPath: string } {
  const from = checkedVideoFile(name);
  writable(from, 'expressions');
  const library = path.resolve(config.expressionsDir);
  const trash = path.resolve(config.trashDir);
  if (!config.trashDir || isInside(library, trash) || isInside(trash, library)) {
    throw new Error('The trash folder must be outside the expression library.');
  }
  fs.mkdirSync(trash, { recursive: true });
  const holder = fs.mkdtempSync(path.join(trash, 'Expression Videos '));
  const dest = path.join(holder, path.basename(from));
  fs.renameSync(from, dest);
  return { trashPath: holder };
}

export function generatedVideoFile(name: unknown): string {
  return readable(checkedVideoFile(name), 'expressions');
}
