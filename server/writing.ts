// Reads the Writing folder (Substack drafts) and saves each piece's Substack Link.txt.
//
// Layout it understands:
//   Writing\My Journey\2022-02 – Kinbaku\
//     Drafts\*.docx               the drafts
//     Substack Metadata\*.png     the post's preview image
//     Substack Link.txt           the published Substack URL (one line)
//     anything else               photos / videos used in the piece
//   Writing\My Reflections\<piece>\...
//   Writing\My Wisdom\<piece>\...
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { config, safeResolve } from './config.js';
import { requireFolder, type FileRef } from './projects.js';
import { readText, readable, writeFile } from './safe-files.js';

export const SUBSTACK_LINK_FILE = 'Substack Link.txt';

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
  substackUrl: string | null;
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

function describe(section: string, folder: string, existingFiles?: string[]): WritingSummary {
  const m = DATED_RE.exec(folder);
  const files = existingFiles ?? allFiles(path.join(config.writingDir, section, folder));
  const drafts = files.filter((f) =>
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
  requireFolder(config.writingDir, 'Writing');
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

function writingFolderDir(id: string): { section: string; folder: string; dir: string } {
  const [section, ...rest] = id.split('/');
  const folder = rest.join('/');
  if (!SECTIONS.includes(section) || !folder || folder.includes('/') || folder.includes('\\') || folder === '.' || folder === '..') {
    throw new Error('Not a writing folder.');
  }
  const dir = safeResolve('writing', id);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Writing folder not found.');
  return { section, folder, dir };
}

/** Checks that a user-entered Substack link is a safe http/https URL. */
export function parseSubstackUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Enter a Substack link.');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid Substack link (starting with https://).');
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || !parsed.hostname) {
    throw new Error('Enter a valid Substack link (starting with https://).');
  }
  return parsed.toString();
}

function readSubstackLink(dir: string): string | null {
  const file = path.join(dir, SUBSTACK_LINK_FILE);
  try {
    return parseSubstackUrl(readText(file, 'writing'));
  } catch {
    return null;
  }
}

/** Saves the Substack post URL to Substack Link.txt in the piece's Drive folder. */
export function saveSubstackLink(id: string, rawUrl: string): { substackUrl: string } {
  const { dir } = writingFolderDir(id);
  const url = parseSubstackUrl(rawUrl);
  writeFile(path.join(dir, SUBSTACK_LINK_FILE), `${url}\n`, undefined, 'writing');
  return { substackUrl: url };
}

export function readWriting(id: string): WritingDetail {
  const { section, folder, dir } = writingFolderDir(id);

  const files = allFiles(dir);
  const ext = (f: string) => path.extname(f).toLowerCase();
  const inMetadata = (f: string) => path.relative(dir, f).split(path.sep)[0].toLowerCase() === 'substack metadata';
  const byName = (a: FileRef, b: FileRef) => a.name.localeCompare(b.name, undefined, { numeric: true });

  const googleDocs = files
    .filter((f) => ext(f) === '.gdoc')
    .flatMap((f) => {
      try {
        const { doc_id } = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (typeof doc_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(doc_id)) return [];
        return [{
          name: path.basename(f, '.gdoc'),
          url: `https://docs.google.com/document/d/${doc_id}/edit`,
        }];
      } catch {
        return [];
      }
    });

  return {
    ...describe(section, folder, files),
    substackUrl: readSubstackLink(dir),
    drafts: files.filter((f) => ext(f) === '.docx').map((f) => toRef(f, dir)).sort(byName),
    googleDocs,
    previews: files.filter((f) => IMAGE_EXTS.has(ext(f)) && inMetadata(f)).map((f) => toRef(f, dir)).sort(byName),
    images: files.filter((f) => IMAGE_EXTS.has(ext(f)) && !inMetadata(f)).map((f) => toRef(f, dir)).sort(byName),
    videos: files.filter((f) => VIDEO_EXTS.has(ext(f))).map((f) => toRef(f, dir)).sort(byName),
  };
}

/** Converts a Word draft to HTML for reading in the app. */
export async function draftHtml(relPath: string): Promise<string> {
  const full = readable(safeResolve('writing', relPath), 'writing');
  if (path.extname(full).toLowerCase() !== '.docx') throw new Error('Not a Word document.');
  const result = await mammoth.convertToHtml({ path: full });
  return result.value;
}

/** Extracts plain text from a Word draft for AI context. */
export async function draftText(relPath: string): Promise<string> {
  const full = readable(safeResolve('writing', relPath), 'writing');
  if (path.extname(full).toLowerCase() !== '.docx') throw new Error('Not a Word document.');
  const result = await mammoth.extractRawText({ path: full });
  return result.value.trim();
}

const normalizeDraftName = (s: string) => s.toLowerCase().replace(/[-–\s]+/g, ' ').trim();

/** Plain text of the main .docx draft (matching the folder name, or the first .docx) for a Substack piece. */
export async function substackDraftText(id: string): Promise<string | null> {
  const detail = readWriting(id);
  if (!detail.drafts.length) return null;
  const folder = normalizeDraftName(id.split('/').pop() ?? '');
  const title = normalizeDraftName(detail.title);
  const byName = (d: FileRef) => {
    const base = normalizeDraftName(path.basename(d.name, path.extname(d.name)));
    return base === folder || base === title;
  };
  const chosen = detail.drafts.find(byName) ?? detail.drafts[0];
  const text = await draftText(chosen.path);
  return text || null;
}
