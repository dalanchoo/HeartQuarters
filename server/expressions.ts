// Reads the Expressions library (photos of John for thumbnails). It changes nothing, except that a photo's tag file
// gets one "# Motion: Yes" or "# Motion: No" line the first time the photo is listed without one.
//
// Layout it understands:
//   Expressions\Cognitive\Thinking\Pondering\
//     Pondering.txt           the category's definition
//     _Pondering.png          the category's reference image
//     Pondering_001.jpg       a photo
//     Pondering_001.txt       its tags: "Joy, 82%, UNCONFIRMED" per line
//     Pondering_001_<model>.txt   other AI guesses (ignored here)
// Folders starting with "_" (e.g. _blind_pending) are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { requireFolder } from './projects.js';
import { writeFile } from './safe-files.js';
import { parseGeneration, type GenerationRecord } from './expression-generation-record.js';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CACHE_MS = 30_000;
export const EXPRESSION_INBOX = '_Inbox';

export interface Tag {
  tag: string;
  /** Confidence 0-100, or null for "N/A". */
  confidence: number | null;
  confirmed: boolean;
  disconfirmed?: boolean;
  removed?: boolean;
  assessments?: Partial<Record<'claude' | 'codex' | 'gemini', number>>;
}

export interface ExpressionCategory {
  /** Relative path, e.g. "Cognitive/Thinking/Pondering". "" is the library root. */
  path: string;
  name: string;
  parent: string | null;
  definition: string | null;
  reference: string | null;
  /** Photos directly in this folder. */
  ownCount: number;
  /** Photos here and in every sub-category. */
  totalCount: number;
}

export interface ExpressionPhoto {
  path: string;
  name: string;
  category: string;
  /** Changes when a different file occupies this path, for browser image caches. */
  revision?: string;
  /** True when the photo's sidecar has assessment dates for all three AIs (Claude, ChatGPT, and Gemini). */
  assessedByThreeAIs?: boolean;
  /** Most recent date (YYYY-MM-DD) each AI assessed this photo, kept in the sidecar as "# Assessed: ...". */
  assessedAt?: AssessedDates;
  /** True when the image file itself contains embedded Motion Photo / MicroVideo XMP metadata. */
  motionPhoto?: boolean;
  /** John's own thumbs up or down, kept in the sidecar as "# Rating: Liked", "# Rating: Meh" or "# Rating: Disliked". */
  rating?: ExpressionRating;
  /** Attributes all three AIs agreed on that John removed (kept in the sidecar as "# Removed: ..."). */
  removedTags?: Tag[];
  /** For an AI picture HeartQuarters made: what it was asked to show (separate from what the AIs think it shows). */
  generation?: GenerationRecord;
  tags: Tag[];
}

export interface ExpressionIndex {
  rootDir: string;
  categories: ExpressionCategory[];
  photos: ExpressionPhoto[];
}

let cached: { at: number; index: ExpressionIndex } | null = null;
export function clearExpressionIndex(): void { cached = null; }
/**
 * Changes one photo in the kept library list instead of throwing the list away, for small edits (like a rating) that
 * change nothing else. Re-reading all photos from Drive takes about half a second.
 */
export function patchCachedPhoto(photoPath: string, patch: (photo: ExpressionPhoto) => ExpressionPhoto): void {
  if (!cached) return;
  const at = cached.index.photos.findIndex(photo => photo.path === photoPath);
  if (at < 0) return;
  const photos = cached.index.photos.slice(); photos[at] = patch(photos[at]);
  cached = { at: cached.at, index: { ...cached.index, photos } };
}

const MOTION_HEADER_BYTES = 65_536;
const motionBuf = Buffer.alloc(MOTION_HEADER_BYTES);

/** Detects Google/Android Motion Photo (or MicroVideo) XMP metadata in the image header. */
export function hasMotionPhotoHeader(file: string): boolean {
  if (!/\.(jpe?g|webp)$/i.test(file)) return false;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const read = fs.readSync(fd, motionBuf, 0, MOTION_HEADER_BYTES, 0);
      const head = motionBuf.subarray(0, read).toString('latin1');
      return /GCamera:(?:MotionPhoto|MicroVideo)=["']1["']|Semantic=["']MotionPhoto["']/i.test(head);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export const THREE_AI_ASSESSED_MARKER = '# AssessedWithAllThreeAIs';
export type AssessedDates = Partial<Record<'claude' | 'codex' | 'gemini', string>>;
export const ASSESSED_LINE = /^#\s*Assessed:\s*(.+)$/i;
export const REMOVED_LINE = /^#\s*Removed:\s*(.+)$/i;

/** True when all three AIs independently scored this attribute at or above the 75% threshold. */
export function allThreeAIsAgreed(tag: Pick<Tag, 'assessments'>): boolean {
  const a = tag.assessments;
  return !!a && a.claude !== undefined && a.codex !== undefined && a.gemini !== undefined &&
    a.claude >= 75 && a.codex >= 75 && a.gemini >= 75;
}

/** Reads "# Removed: <tag line>" lines from a sidecar so removed 3-AI attributes stay highlighted and remembered. */
export function parseRemovedTags(text: string): Tag[] {
  const removed: Tag[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = REMOVED_LINE.exec(line.trim());
    if (!match) continue;
    for (const tag of parseTags(match[1])) removed.push({ ...tag, removed: true });
  }
  return removed;
}

/** Reads "# Assessed: claude=YYYY-MM-DD, codex=YYYY-MM-DD, gemini=YYYY-MM-DD" lines from a sidecar. */
export function parseAssessedDates(text: string): AssessedDates | undefined {
  const dates: AssessedDates = {};
  for (const line of text.split(/\r?\n/)) {
    const match = ASSESSED_LINE.exec(line.trim());
    if (!match) continue;
    for (const part of match[1].split(',')) {
      const m = /^(claude|codex|gemini)=(\d{4}-\d{2}-\d{2})$/i.exec(part.trim());
      if (m) dates[m[1].toLowerCase() as keyof AssessedDates] = m[2];
    }
  }
  return Object.keys(dates).length ? dates : undefined;
}

export type ExpressionRating = 'liked' | 'meh' | 'disliked';
/** The rating line starts with "#", so tag readers (and the AI assessment) leave it alone. */
/** Whether the photo is a Google/Android Motion Photo, kept in the sidecar as "# Motion: Yes" or "# Motion: No". */
export const MOTION_LINE = /^#\s*Motion:\s*(Yes|No)\s*$/i;
export function parseMotion(text: string): boolean | undefined {
  let motion: boolean | undefined;
  for (const line of text.split(/\r?\n/)) { const match = MOTION_LINE.exec(line.trim()); if (match) motion = match[1].toLowerCase() === 'yes'; }
  return motion;
}
/** The sidecar text with its Motion line set (added, or replaced if one is there). Nothing else changes. */
export function withMotionLine(text: string, motion: boolean): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const kept = text.split(/(?<=\n)/).filter(line => line && !MOTION_LINE.test(line.trim())).join('');
  return kept + (kept && !kept.endsWith('\n') ? newline : '') + `# Motion: ${motion ? 'Yes' : 'No'}${newline}`;
}
/**
 * Is this photo a Motion Photo? The sidecar's Motion line answers it. Without one, the photo's own header is read
 * (slow on the D: disk) and the answer is written into the sidecar, so it is only ever worked out once. Only an
 * existing sidecar is written; a failed write is not an error, the answer is still right for now.
 */
export function motionOf(photoFile: string, sidecarFile: string | null, saved: boolean | undefined): boolean {
  if (saved !== undefined) return saved;
  if (!/\.(jpe?g|webp)$/i.test(photoFile)) return false;
  const motion = hasMotionPhotoHeader(photoFile);
  if (!sidecarFile) return motion;
  try {
    if (!fs.lstatSync(sidecarFile).isFile()) return motion;
    writeFile(sidecarFile, withMotionLine(fs.readFileSync(sidecarFile, 'utf8'), motion), undefined, 'expressions');
  } catch { /* the sidecar couldn't be written this time */ }
  return motion;
}
export const RATING_LINE = /^#\s*Rating:\s*(Liked|Meh|Disliked)\s*$/i;

/** The last rating line in a sidecar wins; none means not rated. */
export function parseRating(text: string): ExpressionRating | undefined {
  let rating: ExpressionRating | undefined;
  for (const line of text.split(/\r?\n/)) { const match = RATING_LINE.exec(line.trim()); if (match) rating = match[1].toLowerCase() as ExpressionRating; }
  return rating;
}

type SidecarInfo = { tags: Tag[]; removedTags?: Tag[]; assessedByThreeAIs: boolean; assessedAt?: AssessedDates; rating?: ExpressionRating; motion?: boolean; generation?: GenerationRecord };
const NO_SIDECAR: SidecarInfo = { tags: [], assessedByThreeAIs: false };

function readSidecar(file: string): SidecarInfo {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const tags = parseTags(text);
    const removedTags = parseRemovedTags(text);
    const assessedAt = parseAssessedDates(text);
    const assessedByThreeAIs = Boolean(assessedAt?.claude && assessedAt?.codex && assessedAt?.gemini);
    const rating = parseRating(text);
    const motion = parseMotion(text);
    const generation = parseGeneration(text);
    return { tags, ...(removedTags.length ? { removedTags } : {}), assessedByThreeAIs, ...(assessedAt ? { assessedAt } : {}), ...(rating ? { rating } : {}), ...(motion !== undefined ? { motion } : {}), ...(generation ? { generation } : {}) };
  } catch {
    return NO_SIDECAR;
  }
}

/** Reads tag lines like "Joy, 82%, UNCONFIRMED" or "Warmth, N/A, CONFIRMED". */
export function parseTags(text: string): Tag[] {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) => line.replace(/^([^,:]+):\s*/, '$1, ').split(',').map((s) => s.trim()))
    .filter((parts) => parts.length >= 2 && parts[0])
    .map(([tag, conf, status, ...sources]) => {
      const n = parseInt(conf, 10);
      const assessments: NonNullable<Tag['assessments']> = {};
      for (const source of sources) {
        const match = /^(claude|codex|gemini)=(\d{1,3})%$/i.exec(source);
        if (match && Number(match[2]) <= 100) assessments[match[1].toLowerCase() as keyof typeof assessments] = Number(match[2]);
      }
      return { tag, confidence: Number.isNaN(n) ? null : n, confirmed: (status ?? '').toUpperCase() === 'CONFIRMED', ...((status ?? '').toUpperCase() === 'DISCONFIRMED' ? { disconfirmed: true } : {}), ...(Object.keys(assessments).length ? { assessments } : {}) };
    });
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Photos waiting to be classified stay separate from the library index. */
export function inboxExpressionPhotos(): ExpressionPhoto[] {
  const dir = safeResolve('expressions', EXPRESSION_INBOX);
  if (!fs.existsSync(dir)) return [];
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw new Error('The expression inbox must be a real folder.');
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const images = entries.filter(e => e.isFile() && !e.isSymbolicLink() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()));
  return images.map(e => {
    const base = path.basename(e.name, path.extname(e.name));
    const sameBase = images.filter(other => path.basename(other.name, path.extname(other.name)).toLowerCase() === base.toLowerCase());
    const sidecar = entries.find(other => other.name.toLowerCase() === `${base}.txt`.toLowerCase());
    const full = safeResolve('expressions', `${EXPRESSION_INBOX}/${e.name}`); const stat = fs.statSync(full);
    const sidecarInfo = sameBase.length === 1 && sidecar?.isFile() && !sidecar.isSymbolicLink() ? readSidecar(safeResolve('expressions', `${EXPRESSION_INBOX}/${sidecar.name}`)) : NO_SIDECAR;
    return { path: `${EXPRESSION_INBOX}/${e.name}`, name: base, category: EXPRESSION_INBOX, revision: `${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`, ...(sidecarInfo.assessedByThreeAIs ? { assessedByThreeAIs: true } : {}), ...(sidecarInfo.assessedAt ? { assessedAt: sidecarInfo.assessedAt } : {}), ...(sidecarInfo.removedTags ? { removedTags: sidecarInfo.removedTags } : {}), ...(motionOf(full, sameBase.length === 1 && sidecar?.isFile() && !sidecar.isSymbolicLink() ? safeResolve('expressions', `${EXPRESSION_INBOX}/${sidecar.name}`) : null, sidecarInfo.motion) ? { motionPhoto: true } : {}), ...(sidecarInfo.rating ? { rating: sidecarInfo.rating } : {}), ...(sidecarInfo.generation ? { generation: sidecarInfo.generation } : {}), tags: sidecarInfo.tags };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function findExpressionPhoto(index: ExpressionIndex, photoPath: string): ExpressionPhoto | undefined {
  const library = index.photos.find(photo => photo.path === photoPath);
  if (library || !photoPath.startsWith(`${EXPRESSION_INBOX}/`)) return library;
  const photos = inboxExpressionPhotos(); const photo = photos.find(item => item.path === photoPath);
  return photo && photos.filter(item => item.name.toLowerCase() === photo.name.toLowerCase()).length === 1 ? photo : undefined;
}

/**
 * Whether one photo is in the library, looked up directly instead of scanning the whole library (code review #8):
 * the same rules as the library list (an image in a category folder, no folder or file starting with "_"), and the
 * inbox's own rules for a photo in the inbox.
 */
export function isExpressionPhoto(photoPath: string): boolean {
  if (typeof photoPath !== 'string' || !photoPath || photoPath.includes('\\')) return false;
  if (photoPath.startsWith(`${EXPRESSION_INBOX}/`)) return !!findExpressionPhoto({ rootDir: '', categories: [], photos: [] }, photoPath);
  const parts = photoPath.split('/');
  if (parts.length < 2 || parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('_'))) return false;
  if (!IMAGE_EXTS.has(path.extname(photoPath).toLowerCase())) return false;
  try {
    const stat = fs.lstatSync(safeResolve('expressions', photoPath));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * With `withPhotos` off, only the folders are read (no photo details, sidecars or file headers), which is fast.
 * Each category still gets its photo counts, by counting the image files.
 */
export function buildExpressionIndex(withPhotos = true): ExpressionIndex {
  const root = config.expressionsDir;
  requireFolder(root, 'Expressions');
  const categories: ExpressionCategory[] = [];
  const photos: ExpressionPhoto[] = [];

  const walk = (dir: string, relPath: string, parent: string | null): number => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    const name = relPath ? path.basename(dir) : 'All expressions';
    const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    const category: ExpressionCategory = {
      path: relPath,
      name,
      parent,
      definition: relPath ? readText(path.join(dir, `${name}.txt`)) : null,
      reference: null,
      ownCount: 0,
      totalCount: 0,
    };
    categories.push(category);

    for (const file of [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      const rel = relPath ? `${relPath}/${file}` : file;
      const base = file.slice(0, -ext.length);
      if (base === `_${name}`) {
        category.reference = rel;
      } else if (!file.startsWith('_') && relPath) {
        if (!withPhotos) { category.ownCount++; continue; }
        const full = path.join(dir, file);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        const sidecarInfo = files.has(`${base}.txt`) ? readSidecar(path.join(dir, `${base}.txt`)) : NO_SIDECAR;
        photos.push({
          path: rel,
          revision: `${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`,
          name: base,
          category: relPath,
          ...(sidecarInfo.assessedByThreeAIs ? { assessedByThreeAIs: true } : {}),
          ...(sidecarInfo.assessedAt ? { assessedAt: sidecarInfo.assessedAt } : {}),
          ...(sidecarInfo.removedTags ? { removedTags: sidecarInfo.removedTags } : {}),
          ...(motionOf(full, files.has(`${base}.txt`) ? path.join(dir, `${base}.txt`) : null, sidecarInfo.motion) ? { motionPhoto: true } : {}),
          ...(sidecarInfo.rating ? { rating: sidecarInfo.rating } : {}),
          ...(sidecarInfo.generation ? { generation: sidecarInfo.generation } : {}),
          tags: sidecarInfo.tags,
        });
        category.ownCount++;
      }
    }

    let total = category.ownCount;
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('_')) {
        const childRel = relPath ? `${relPath}/${e.name}` : e.name;
        total += walk(path.join(dir, e.name), childRel, relPath);
      }
    }
    category.totalCount = total;
    return total;
  };

  walk(root, '', null);
  categories.sort((a, b) => a.path.localeCompare(b.path));
  return { rootDir: root, categories, photos };
}

/** The categories and their counts, without the photos: quick enough to show the left list and the filters at once. */
export function expressionCategories(): ExpressionIndex {
  return buildExpressionIndex(false);
}

/** The whole library, re-read at most every 30 seconds. */
export function expressionIndex(): ExpressionIndex {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), index: buildExpressionIndex() };
  }
  return cached.index;
}
