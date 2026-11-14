// Reads the Video Projects folder and describes each project.
// It only reads: nothing here creates, moves or deletes files.
//
// Folder layout it understands (see Video Projects\--- LONGFORM TEMPLATE):
//   022 - Worth Telling Them\
//     Longform\Packaging\V01\YouTube.md, Notes.md, Thumbnail\Thumbnail.png (Thumbnail\Source\ for the art)
//     Longform\Exports\*.mp4
//     Shorts\<short>\Packaging\V01\..., Exports\...
//     Reels\<reel>\...
// Series projects (e.g. 005 - Ayahuasca) hold one folder per video: 005A - ..., 005B - ...
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DOC_EXTS = new Set(['.md', '.txt']);
/** Each packaging version's notes: what it tried, where it came from. Shown in its own box, not as a platform's file. */
export const NOTES_FILE = 'Notes.md';
const PROJECT_RE = /^(\d+)\s*[-–]\s*(.+)$/; // "022 - Worth Telling Them" (hyphen or en-dash)
const SERIES_RE = /^\d+[A-Z]\s*[-–]/; // "005A - Night One"

export interface FileRef {
  name: string;
  /** Relative to the Video Projects folder, with forward slashes. */
  path: string;
  size: number;
}

export interface PackagingVersion {
  /** Folder name: "Legacy", "V01", "V05_Shock", ... */
  name: string;
  path: string;
  /** Text files anywhere in the version (e.g. YouTube.md, Metadata/YouTube v01.md), except its Notes.md. */
  docs: FileRef[];
  /** John's notes about this version (Notes.md in the version folder), or null if it has none yet. */
  notes: FileRef | null;
  /** Images anywhere in the version, except Source folders. */
  covers: FileRef[];
}

/** One AI conversation in Packaging\Drafts (e.g. "ChatGPT 02"): its images in order, and what was asked. */
export interface DraftConversation {
  name: string;
  path: string;
  /** Oldest first: 01.png, 02.png, ... */
  images: FileRef[];
  /** Requests.md: the first request and each change request after it. */
  requests: FileRef | null;
}

/** Packaging\Drafts: the brainstorming before a version is made. Not a version itself. */
export interface Drafts {
  path: string;
  /** Brief.md: the brief and the AIs' reviews. */
  brief: FileRef | null;
  conversations: DraftConversation[];
}

/** The scratchpad folder for thumbnail and title drafts, inside Packaging. */
export const DRAFTS_FOLDER = 'Drafts';

export interface Piece {
  kind: 'longform' | 'short' | 'reel';
  name: string;
  path: string;
  /** Name of the newest version, or null if there's no packaging. */
  packagingVersion: string | null;
  /** Oldest first: Legacy, then V01, V02, ... */
  versions: PackagingVersion[];
  /** Packaging\Drafts, or null when there's none yet. */
  drafts: Drafts | null;
  exports: FileRef[];
}

export interface Video {
  name: string;
  path: string;
  pieces: Piece[];
}

/**
 * project = an ordinary video project ("022 - Worth Telling Them")
 * series  = a project made of parts ("005 - Ayahuasca" -> 005A, 005B, ...)
 * part    = one part of a series
 * group   = a folder of folders ("999 - Shorts", "2026")
 * short   = a standalone short inside a group
 */
export type NodeKind = 'project' | 'series' | 'part' | 'group' | 'short';

export interface ProjectNode {
  /** Relative path, e.g. "005 - Ayahuasca/005B - Night One". */
  id: string;
  number: string | null;
  title: string;
  kind: NodeKind;
  /** This video itself is exported (the long-form, or the standalone short). */
  exported: boolean;
  longformExported: boolean;
  shortCount: number;
  children: ProjectNode[];
}

export interface ProjectDetail extends ProjectNode {
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

/**
 * Like filesIn, but also looks in subfolders (skipping "Source" folders, which
 * hold Photoshop files and layers). Names are relative to `base`,
 * e.g. "Thumbnail/Thumbnail.png".
 */
function filesDeep(dir: string, exts: Set<string>, base = dir): FileRef[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FileRef[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.toLowerCase() !== 'source') out.push(...filesDeep(full, exts, base));
    } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
      const name = path.relative(base, full).split(path.sep).join('/');
      out.push({ name, path: rel(full), size: fs.statSync(full).size });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Sort order for version folders: Legacy first, then by number. */
function versionOrder(name: string): number {
  if (name.toLowerCase() === 'legacy') return -1;
  return Number(/^V(\d+)/i.exec(name)?.[1] ?? 9999);
}

function readPiece(dir: string, kind: Piece['kind'], name: string): Piece {
  const packagingRoot = path.join(dir, 'Packaging');
  const versions = subfolders(packagingRoot)
    .filter((v) => /^V\d+/i.test(v) || v.toLowerCase() === 'legacy')
    .sort((a, b) => versionOrder(a) - versionOrder(b))
    .map((v): PackagingVersion => {
      const vDir = path.join(packagingRoot, v);
      const docs = filesDeep(vDir, DOC_EXTS);
      const isNotes = (f: FileRef) => f.name.toLowerCase() === NOTES_FILE.toLowerCase();
      return {
        name: v,
        path: rel(vDir),
        docs: docs.filter((f) => !isNotes(f)),
        notes: docs.find(isNotes) ?? null,
        covers: filesDeep(vDir, IMAGE_EXTS),
      };
    });
  return {
    kind,
    name,
    path: rel(dir),
    packagingVersion: versions.at(-1)?.name ?? null,
    versions,
    drafts: readDrafts(packagingRoot),
    exports: filesIn(path.join(dir, 'Exports'), VIDEO_EXTS),
  };
}

/** Packaging\Drafts: Brief.md, and one folder per AI conversation with its images and Requests.md. */
function readDrafts(packagingRoot: string): Drafts | null {
  const name = subfolders(packagingRoot).find((f) => f.toLowerCase() === DRAFTS_FOLDER.toLowerCase());
  if (!name) return null;
  const dir = path.join(packagingRoot, name);
  const named = (files: FileRef[], want: string) => files.find((f) => f.name.toLowerCase() === want) ?? null;
  const conversations = subfolders(dir).map((c): DraftConversation => {
    const cDir = path.join(dir, c);
    return {
      name: c,
      path: rel(cDir),
      images: filesIn(cDir, IMAGE_EXTS).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      requests: named(filesIn(cDir, DOC_EXTS), 'requests.md'),
    };
  });
  return { path: rel(dir), brief: named(filesIn(dir, DOC_EXTS), 'brief.md'), conversations };
}

/**
 * Reads one video's folder. `looseKind` says what a folder with Packaging/
 * Exports directly inside it is: an old-style long-form, or a standalone short.
 */
function readVideo(dir: string, name: string, looseKind: 'longform' | 'short' = 'longform'): Video {
  const pieces: Piece[] = [];
  const children = subfolders(dir);
  if (children.includes('Longform')) {
    pieces.push(readPiece(path.join(dir, 'Longform'), 'longform', 'Longform'));
  } else if (children.includes('Packaging') || children.includes('Exports')) {
    pieces.push(readPiece(dir, looseKind, looseKind === 'short' ? name : 'Longform'));
  }
  for (const [folder, kind] of [['Shorts', 'short'], ['Reels', 'reel']] as const) {
    for (const child of subfolders(path.join(dir, folder))) {
      pieces.push(readPiece(path.join(dir, folder, child), kind, child));
    }
  }
  return { name, path: rel(dir), pieces };
}

const VIDEO_FOLDERS = ['Longform', 'Shorts', 'Reels', 'Packaging', 'Exports'];

/** "005A - Night One" -> 005A / Night One; "999-2026-18 - Cafe" -> 999-2026-18 / Cafe; "2026" -> 2026 */
function splitName(folder: string): { number: string | null; title: string } {
  const m = /^(\d\S*)\s+[-–]\s+(.+)$/.exec(folder) ?? PROJECT_RE.exec(folder);
  return m ? { number: m[1], title: m[2] } : { number: null, title: folder };
}

function stats(videos: Video[]) {
  const pieces = videos.flatMap((v) => v.pieces);
  return {
    longformExported: pieces.some((p) => p.kind === 'longform' && p.exports.length > 0),
    shortCount: pieces.filter((p) => p.kind === 'short').length,
  };
}

/** Where a folder sits: a top-level project, a part of a series, or inside a group like 999 - Shorts. */
type Role = 'top' | 'part' | 'inGroup';

function readNode(dir: string, role: Role): { node: ProjectNode; videos: Video[] } {
  const folder = path.basename(dir);
  const base = { id: rel(dir), ...splitName(folder) };
  const subs = subfolders(dir);

  const leaf = (kind: NodeKind, video: Video) => {
    const s = stats([video]);
    const exported = kind === 'short' ? video.pieces.some((p) => p.exports.length > 0) : s.longformExported;
    return { node: { ...base, kind, ...s, exported, children: [] }, videos: [video] };
  };
  const branch = (kind: NodeKind, children: { node: ProjectNode; videos: Video[] }[]) => {
    const videos = children.flatMap((c) => c.videos);
    const node = { ...base, kind, ...stats(videos), exported: false, children: children.map((c) => c.node) };
    return { node, videos };
  };

  if (role === 'part') return leaf('part', readVideo(dir, folder));

  // A series: "005 - Ayahuasca" holding "005A - ...", "005B - ...".
  const parts = role === 'top' ? subs.filter((d) => SERIES_RE.test(d)) : [];
  if (parts.length) return branch('series', parts.map((p) => readNode(path.join(dir, p), 'part')));

  // An ordinary video folder, or a standalone short inside a group.
  if (subs.length === 0 || subs.some((d) => VIDEO_FOLDERS.includes(d))) {
    return role === 'inGroup' ? leaf('short', readVideo(dir, folder, 'short')) : leaf('project', readVideo(dir, folder));
  }

  // A folder of folders: "999 - Shorts" holding "2026" holding standalone shorts.
  return branch('group', subs.map((d) => readNode(path.join(dir, d), 'inGroup')));
}

/**
 * Reads any folder in the project tree by its relative path, e.g.
 * "022 - Worth Telling Them", "005 - Ayahuasca/005B - Night One" or
 * "999 - Shorts/2026/999-2026-18 - SDAM Cafe Borrone".
 */
export function readProject(id: string): ProjectDetail {
  const segments = id.split('/');
  if (!PROJECT_RE.test(segments[0]) || segments.some((s) => !s || s === '.' || s === '..' || s.includes('\\'))) {
    throw new Error('Not a project folder.');
  }
  const dir = safeResolve('projects', id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Project not found.');

  const role: Role =
    segments.length === 1 ? 'top' : segments.length === 2 && SERIES_RE.test(segments[1]) ? 'part' : 'inGroup';
  const { node, videos } = readNode(dir, role);
  return { ...node, path: rel(dir), videos };
}

/**
 * Throws a clear message if a whole library folder can't be read (e.g. Google
 * Drive isn't running), instead of quietly showing an empty list.
 */
export function requireFolder(dir: string, label: string) {
  try {
    if (fs.statSync(dir).isDirectory()) return;
  } catch {
    /* fall through */
  }
  throw new Error(`Can't read the ${label} folder (${dir}). Is Google Drive running?`);
}

/** Every top-level project, with series parts and grouped shorts as children. */
export function listProjects(): ProjectNode[] {
  requireFolder(config.videoProjectsDir, 'Video Projects');
  return subfolders(config.videoProjectsDir)
    .filter((name) => PROJECT_RE.test(name))
    .map((name) => readNode(path.join(config.videoProjectsDir, name), 'top').node);
}

/** Read the same video tree for the status overview, once for the whole sidebar. */
export function listProjectVideos(): { projectId: string; video: Video }[] {
  requireFolder(config.videoProjectsDir, 'Video Projects');
  return subfolders(config.videoProjectsDir).filter((name) => PROJECT_RE.test(name)).flatMap((name) => {
    const { videos } = readNode(path.join(config.videoProjectsDir, name), 'top');
    return videos.map((video) => ({ projectId: video.path, video }));
  });
}
