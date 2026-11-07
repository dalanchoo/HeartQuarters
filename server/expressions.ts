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
import { config } from './config.js';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CACHE_MS = 30_000;

export interface Tag {
  tag: string;
  /** Confidence 0-100, or null for "N/A". */
  confidence: number | null;
  confirmed: boolean;
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
  tags: Tag[];
}

export interface ExpressionIndex {
  rootDir: string;
  categories: ExpressionCategory[];
  photos: ExpressionPhoto[];
}

let cached: { at: number; index: ExpressionIndex } | null = null;

function parseTags(file: string): Tag[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.split(',').map((s) => s.trim()))
    .filter((parts) => parts.length >= 2 && parts[0])
    .map(([tag, conf, status]) => {
      const n = parseInt(conf, 10);
      return {
        tag,
        confidence: Number.isNaN(n) ? null : n,
        confirmed: (status ?? '').toUpperCase() === 'CONFIRMED',
      };
    });
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function build(): ExpressionIndex {
  const root = config.expressionsDir;
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
        photos.push({
          path: rel,
          name: base,
          category: relPath,
          tags: files.has(`${base}.txt`) ? parseTags(path.join(dir, `${base}.txt`)) : [],
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
    cached = { at: Date.now(), index: build() };
  }
  return cached.index;
}
