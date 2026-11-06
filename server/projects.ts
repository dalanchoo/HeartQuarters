// Reads the Video Projects folder and describes each project.
// It only reads: nothing here creates, moves or deletes files.
//
// Folder layout it understands (see Video Projects\--- LONGFORM TEMPLATE):
//   022 - Worth Telling Them\
//     Longform\Packaging\V01\YouTube.md, Covers\*.png
//     Longform\Exports\*.mp4
//     Shorts\<short>\Packaging\V01\..., Exports\...
//     Reels\<reel>\...
// Series projects (e.g. 005 - Ayahuasca) hold one folder per video: 005A - ..., 005B - ...
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DOC_EXTS = new Set(['.md', '.txt']);
const PROJECT_RE = /^(\d+)\s*-\s*(.+)$/; // "022 - Worth Telling Them"
const SERIES_RE = /^\d+[A-Z]\s*[-–]/; // "005A - Night One"

export interface FileRef {
  name: string;
  /** Relative to the Video Projects folder, with forward slashes. */
  path: string;
  size: number;
}

export interface Piece {
  kind: 'longform' | 'short' | 'reel';
  name: string;
  path: string;
  packagingVersion: string | null;
  docs: FileRef[];
  covers: FileRef[];
  exports: FileRef[];
}

export interface Video {
  name: string;
  path: string;
  pieces: Piece[];
}

export interface ProjectSummary {
  id: string;
  number: string;
  title: string;
  longformExported: boolean;
  shortCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  path: string;
  videos: Video[];
}

function rel(full: string): string {
  return path.relative(config.videoProjectsDir, full).split(path.sep).join('/');
}

function subfolders(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function filesIn(dir: string, exts: Set<string>): FileRef[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && exts.has(path.extname(d.name).toLowerCase()))
      .map((d) => {
        const full = path.join(dir, d.name);
        return { name: d.name, path: rel(full), size: fs.statSync(full).size };
      });
  } catch {
    return [];
  }
}

function readPiece(dir: string, kind: Piece['kind'], name: string): Piece {
  const packagingRoot = path.join(dir, 'Packaging');
  const versions = subfolders(packagingRoot).filter((v) => /^V\d+/i.test(v));
  const latest = versions.at(-1) ?? null;
  const packagingDir = latest ? path.join(packagingRoot, latest) : null;
  return {
    kind,
    name,
    path: rel(dir),
    packagingVersion: latest,
    docs: packagingDir ? filesIn(packagingDir, DOC_EXTS) : [],
    covers: packagingDir ? filesIn(path.join(packagingDir, 'Covers'), IMAGE_EXTS) : [],
    exports: filesIn(path.join(dir, 'Exports'), VIDEO_EXTS),
  };
}

function readVideo(dir: string, name: string): Video {
  const pieces: Piece[] = [];
  const children = subfolders(dir);
  if (children.includes('Longform')) {
    pieces.push(readPiece(path.join(dir, 'Longform'), 'longform', 'Longform'));
  } else if (children.includes('Packaging') || children.includes('Exports')) {
    // Older layout: longform folders sit directly in the project folder.
    pieces.push(readPiece(dir, 'longform', 'Longform'));
  }
  for (const [folder, kind] of [['Shorts', 'short'], ['Reels', 'reel']] as const) {
    for (const child of subfolders(path.join(dir, folder))) {
      pieces.push(readPiece(path.join(dir, folder, child), kind, child));
    }
  }
  return { name, path: rel(dir), pieces };
}

export function readProject(id: string): ProjectDetail {
  const match = PROJECT_RE.exec(id);
  if (!match || /[\\/]/.test(id)) throw new Error('Not a project folder name.');
  const dir = path.join(config.videoProjectsDir, id);
  if (!fs.existsSync(dir)) throw new Error('Project not found.');

  const series = subfolders(dir).filter((d) => SERIES_RE.test(d));
  const videos = series.length
    ? series.map((s) => readVideo(path.join(dir, s), s))
    : [readVideo(dir, id)];
  const pieces = videos.flatMap((v) => v.pieces);

  return {
    id,
    number: match[1],
    title: match[2],
    path: rel(dir),
    videos,
    longformExported: pieces.some((p) => p.kind === 'longform' && p.exports.length > 0),
    shortCount: pieces.filter((p) => p.kind === 'short').length,
  };
}

export function listProjects(): ProjectSummary[] {
  return subfolders(config.videoProjectsDir)
    .filter((name) => PROJECT_RE.test(name))
    .map((name) => {
      const { videos: _videos, path: _path, ...summary } = readProject(name);
      return summary;
    });
}
