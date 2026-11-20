// Reads the Expressions library (photos of John for thumbnails). Read-only.
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

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CACHE_MS = 30_000;
export const EXPRESSION_INBOX = '_Inbox';

export interface Tag {
  tag: string;
  /** Confidence 0-100, or null for "N/A". */
  confidence: number | null;
  confirmed: boolean;
  disconfirmed?: boolean;
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
  /** True when the photo's sidecar has a three-AI assessment marker or per-model scores. */
  assessedByThreeAIs?: boolean;
  /** True when the image file itself contains embedded Motion Photo / MicroVideo XMP metadata. */
  motionPhoto?: boolean;
  tags: Tag[];
}

export interface ExpressionIndex {
  rootDir: string;
  categories: ExpressionCategory[];
  photos: ExpressionPhoto[];
}

let cached: { at: number; index: ExpressionIndex } | null = null;
export function clearExpressionIndex(): void { cached = null; }

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

function readSidecar(file: string): { tags: Tag[]; assessedByThreeAIs: boolean } {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const tags = parseTags(text);
    const assessedByThreeAIs =
      /(?:^|\n)#\s*AssessedWithAllThreeAIs\b/i.test(text) ||
      tags.some((t) => !!t.assessments && Object.keys(t.assessments).length > 0);
    return { tags, assessedByThreeAIs };
  } catch {
    return { tags: [], assessedByThreeAIs: false };
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
    const sidecarInfo = sameBase.length === 1 && sidecar?.isFile() && !sidecar.isSymbolicLink() ? readSidecar(safeResolve('expressions', `${EXPRESSION_INBOX}/${sidecar.name}`)) : { tags: [], assessedByThreeAIs: false };
    return { path: `${EXPRESSION_INBOX}/${e.name}`, name: base, category: EXPRESSION_INBOX, revision: `${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`, ...(sidecarInfo.assessedByThreeAIs ? { assessedByThreeAIs: true } : {}), ...(hasMotionPhotoHeader(full) ? { motionPhoto: true } : {}), tags: sidecarInfo.tags };
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

export function buildExpressionIndex(): ExpressionIndex {
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
        const full = path.join(dir, file);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        const sidecarInfo = files.has(`${base}.txt`) ? readSidecar(path.join(dir, `${base}.txt`)) : { tags: [], assessedByThreeAIs: false };
        photos.push({
          path: rel,
          revision: `${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`,
          name: base,
          category: relPath,
          ...(sidecarInfo.assessedByThreeAIs ? { assessedByThreeAIs: true } : {}),
          ...(hasMotionPhotoHeader(full) ? { motionPhoto: true } : {}),
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

/** The whole library, re-read at most every 30 seconds. */
export function expressionIndex(): ExpressionIndex {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), index: buildExpressionIndex() };
  }
  return cached.index;
}
