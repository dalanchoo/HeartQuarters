// Loads config.json (your machine's folder paths and tool list).
// The first time the app runs, config.json is created from config.example.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Which top-level folder a relative path belongs to. */
export type RootId = 'projects' | 'tools' | 'writing' | 'expressions';

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  /** Script file name, relative to toolsDir. */
  script: string;
}

export interface GuideDef {
  name: string;
  root: RootId;
  path: string;
}

export interface Config {
  port: number;
  videoProjectsDir: string;
  toolsDir: string;
  writingDir: string;
  expressionsDir: string;
  python: string;
  guides: GuideDef[];
  tools: ToolDef[];
}

function loadConfig(): Config {
  const examplePath = path.join(appDir, 'config.example.json');
  const local = path.join(appDir, 'config.json');
  if (!fs.existsSync(local)) fs.copyFileSync(examplePath, local);
  // Settings added in newer versions fall back to config.example.json,
  // so an older config.json keeps working.
  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8')) as Config;
  return { ...example, ...(JSON.parse(fs.readFileSync(local, 'utf8')) as Partial<Config>) };
}

export const config = loadConfig();

export function rootDir(root: RootId): string {
  if (root === 'tools') return config.toolsDir;
  if (root === 'writing') return config.writingDir;
  if (root === 'expressions') return config.expressionsDir;
  return config.videoProjectsDir;
}

export function parseRoot(value: unknown): RootId {
  return value === 'tools' || value === 'writing' || value === 'expressions' ? value : 'projects';
}

/** True if `child` is `parent` or somewhere inside it (ignoring upper/lower case, as Windows does). */
export function isInside(parent: string, child: string): boolean {
  const p = parent.toLowerCase();
  const c = child.toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function realPath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null; // doesn't exist (yet)
  }
}

/** Real location of `p`; if it doesn't exist yet, of its nearest existing parent folder. */
function realPathOfNearest(p: string): string | null {
  const rest: string[] = [];
  let current = p;
  for (;;) {
    const real = realPath(current);
    if (real) return path.join(real, ...rest.reverse());
    const parent = path.dirname(current);
    if (parent === current) return null;
    rest.push(path.basename(current));
    current = parent;
  }
}

/**
 * Turns a relative path into a full path, refusing anything that would
 * escape the allowed folder: "../../Windows", "C:\Windows", or a Windows
 * shortcut-folder (junction / symbolic link) inside the folder that points
 * somewhere else.
 */
export function safeResolve(root: RootId, relPath: string): string {
  const outside = new Error('That path is outside the allowed folder.');
  const base = path.resolve(rootDir(root));
  const full = path.resolve(base, relPath);
  if (!isInside(base, full)) throw outside;

  // Check where the path really ends up after following any links.
  const realBase = realPath(base);
  const realFull = realPathOfNearest(full);
  if (realBase && realFull && !isInside(realBase, realFull)) throw outside;
  return full;
}
