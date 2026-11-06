// Loads config.json (your machine's folder paths and tool list).
// The first time the app runs, config.json is created from config.example.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Which top-level folder a relative path belongs to. */
export type RootId = 'projects' | 'tools' | 'writing';

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
  return config.videoProjectsDir;
}

export function parseRoot(value: unknown): RootId {
  return value === 'tools' || value === 'writing' ? value : 'projects';
}

/**
 * Turns a relative path into a full path, refusing anything that would
 * escape the allowed folder (e.g. "../../Windows").
 */
export function safeResolve(root: RootId, relPath: string): string {
  const base = path.resolve(rootDir(root));
  const full = path.resolve(base, relPath);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('That path is outside the allowed folder.');
  }
  return full;
}
