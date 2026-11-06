// Reads the Writing folder (Substack drafts). Read-only.
//
// Layout it understands:
//   Writing\My Journey\2022-02 – Kinbaku\
//     Drafts\*.docx               the drafts
//     Substack Metadata\*.png     the post's preview image
//     anything else               photos / videos used in the piece
//   Writing\My Reflections\<piece>\...
//   Writing\My Wisdom\<piece>\...
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { config, safeResolve } from './config.js';
import type { FileRef } from './projects.js';

const SECTIONS = ['My Journey', 'My Reflections', 'My Wisdom'];
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);
const DATED_RE = /^(\d{4}-\d{2}(?:-\d{2})?)\s*[-–]\s*(.+)$/; // "2022-02 – Kinbaku"

export interface WritingSummary {
  /** Relative path, e.g. "My Journey/2022-02 – Kinbaku". */
  id: string;
  section: string;
  title: string;
  date: string | null;
  draftCount: number;
}

export interface WritingDetail extends WritingSummary {
  drafts: FileRef[];
  googleDocs: { name: string; url: string }[];
  previews: FileRef[];
  images: FileRef[];
  videos: FileRef[];
}

function rel(full: string): string {
  return path.relative(config.writingDir, full).split(path.sep).join('/');
}

function allFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return allFiles(full);
    return e.isFile() && !e.name.startsWith('~$') ? [full] : []; // ~$ = Word lock files
  });
}

function toRef(full: string, base: string): FileRef {
  return {
    name: path.relative(base, full).split(path.sep).join('/'),
    path: rel(full),
    size: fs.statSync(full).size,
  };
}

function describe(section: string, folder: string): WritingSummary {
  const m = DATED_RE.exec(folder);
  const drafts = allFiles(path.join(config.writingDir, section, folder)).filter((f) =>
    ['.docx', '.gdoc'].includes(path.extname(f).toLowerCase()),
  );
  return {
    id: `${section}/${folder}`,
    section,
    title: m ? m[2] : folder.replace(/^@\s*/, ''),
    date: m ? m[1] : null,
    draftCount: drafts.length,
  };
}

export function listWriting(): { section: string; pieces: WritingSummary[] }[] {
  return SECTIONS.map((section) => {
    let folders: string[] = [];
    try {
      folders = fs
        .readdirSync(path.join(config.writingDir, section), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      /* section folder missing */
    }
    const pieces = folders.map((f) => describe(section, f));
    // Overview folders ("@ ...") first, then dated pieces newest first, then A–Z.
    pieces.sort((a, b) => {
      const ao = a.id.includes('/@'), bo = b.id.includes('/@');
      if (ao !== bo) return ao ? -1 : 1;
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return a.title.localeCompare(b.title);
    });
    return { section, pieces };
  });
}

export function readWriting(id: string): WritingDetail {
  const [section, ...rest] = id.split('/');
  const folder = rest.join('/');
  if (!SECTIONS.includes(section) || !folder || folder.includes('/')) {
    throw new Error('Not a writing folder.');
  }
  const dir = safeResolve('writing', id);
  if (!fs.existsSync(dir)) throw new Error('Writing folder not found.');

  const files = allFiles(dir);
  const ext = (f: string) => path.extname(f).toLowerCase();
  const inMetadata = (f: string) => path.relative(dir, f).toLowerCase().startsWith('substack metadata');
  const byName = (a: FileRef, b: FileRef) => a.name.localeCompare(b.name, undefined, { numeric: true });

  const googleDocs = files
    .filter((f) => ext(f) === '.gdoc')
    .flatMap((f) => {
      try {
        const { doc_id } = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!doc_id) return [];
        return [{
          name: path.basename(f, '.gdoc'),
          url: `https://docs.google.com/document/d/${doc_id}/edit`,
        }];
      } catch {
        return [];
      }
    });

  return {
    ...describe(section, folder),
    drafts: files.filter((f) => ext(f) === '.docx').map((f) => toRef(f, dir)).sort(byName),
    googleDocs,
    previews: files.filter((f) => IMAGE_EXTS.has(ext(f)) && inMetadata(f)).map((f) => toRef(f, dir)).sort(byName),
    images: files.filter((f) => IMAGE_EXTS.has(ext(f)) && !inMetadata(f)).map((f) => toRef(f, dir)).sort(byName),
    videos: files.filter((f) => VIDEO_EXTS.has(ext(f))).map((f) => toRef(f, dir)).sort(byName),
  };
}

/** Converts a Word draft to HTML for reading in the app. */
export async function draftHtml(relPath: string): Promise<string> {
  const full = safeResolve('writing', relPath);
  if (path.extname(full).toLowerCase() !== '.docx') throw new Error('Not a Word document.');
  const result = await mammoth.convertToHtml({ path: full });
  return result.value;
}
