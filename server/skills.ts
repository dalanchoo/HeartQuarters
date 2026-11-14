// The Skills page: which AI gets which skill.
//
// There is one real copy of every skill, in skillsDir (HMF_SYS\Skills):
//   HMF_Skills\<skill>\SKILL.md     John's own
//   Downloaded\<skill>\SKILL.md     other people's
// Each AI on this PC reads skills from its own folder (config.skillTargets). Turning a
// skill on for an AI puts a link there (a Windows junction) pointing at the real
// folder; turning it off removes only that link. Nothing else in the AI's folder is
// ever touched: real folders and links pointing elsewhere are shown, not changed.
//
// Antigravity (Gemini) doesn't follow links. It reads a list file instead (skills.json), whose
// entries name folders to look in, each with an optional include_only list of skill folders. For
// it, turning a skill on adds the skill's name to the entry for its group folder (HMF_Skills or
// Downloaded); turning it off takes the name out. Other entries and settings in the file are kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, isInside, safeResolve, type SkillTarget } from './config.js';

export const SKILL_GROUPS = { HMF_Skills: 'mine', Downloaded: 'downloaded' } as const;
type GroupFolder = keyof typeof SKILL_GROUPS;

/** on: our link is there. off: nothing there. other: something else has that name. */
export type LinkState = 'on' | 'off' | 'other';

export interface SkillInfo {
  /** Relative to skillsDir, e.g. "HMF_Skills/longform-edit". */
  id: string;
  group: 'mine' | 'downloaded';
  /** The folder name, which is also the link's name in each AI's folder. */
  folder: string;
  name: string;
  description: string;
  links: Record<string, LinkState>;
}

export interface TargetInfo extends SkillTarget {
  /** False when the AI isn't on this PC (its own folder, e.g. .gemini, doesn't exist). */
  installed: boolean;
  /** Skills in the AI's folder that this page doesn't manage (installed some other way). */
  others: string[];
}

export interface SkillsOverview {
  skills: SkillInfo[];
  targets: TargetInfo[];
}

/** Reads `name` and `description` from the header between the --- lines at the top of SKILL.md. */
export function readHeader(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v) as string;
      } catch {
        v = v.slice(1, -1);
      }
    } else if (v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1).replace(/''/g, "'");
    }
    out[kv[1]] = v;
  }
  return out;
}

function realPath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Is `p` a link (junction or symbolic link), rather than a real folder? */
function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function target(id: string): SkillTarget {
  const t = config.skillTargets.find((x) => x.id === id);
  if (!t) throw new Error(`No AI called "${id}" in config.json's skillTargets.`);
  return t;
}

// ---- The list file (Antigravity) ----------------------------------------------------

interface ListEntry {
  path: string;
  include_only?: string[];
  exclude?: string[];
  [other: string]: unknown;
}
interface ListFile {
  entries?: ListEntry[];
  [other: string]: unknown;
}

/** The list file's contents ({} when there's none yet), or null when it can't be read. */
function readList(file: string): ListFile | null {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const list = parsed as ListFile;
    if (list.entries !== undefined && !Array.isArray(list.entries)) return null;
    return list;
  } catch {
    return null;
  }
}

/** Do two paths name the same folder? Handles "~/", forward slashes and upper/lower case. */
function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p.replace(/^~(?=[\\/])/, os.homedir())).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

const named = (names: string[] | undefined, folder: string) => (names ?? []).some((n) => n.toLowerCase() === folder.toLowerCase());

/** Is the skill in `folder` (inside `groupDir`) turned on in the list? Names are matched exactly, not as patterns. */
function listState(list: ListFile | null, groupDir: string, folder: string): LinkState {
  if (!list) return 'other';
  const entry = list.entries?.find((e) => typeof e?.path === 'string' && sameFolder(e.path, groupDir));
  if (!entry || named(entry.exclude, folder)) return 'off';
  return !entry.include_only || named(entry.include_only, folder) ? 'on' : 'off';
}

/** The skill folders (with a SKILL.md) in one group folder. */
function skillsIn(groupDir: string): string[] {
  if (!fs.existsSync(groupDir)) return [];
  return fs
    .readdirSync(groupDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(groupDir, e.name, 'SKILL.md')))
    .map((e) => e.name);
}

/** Turns one skill on or off in a list file, keeping everything else in the file as it was. */
function setListed(t: SkillTarget & { listFile: string }, groupDir: string, folder: string, on: boolean): LinkState {
  const list = readList(t.listFile);
  if (!list) throw new Error(`${t.listFile} isn't a skills list this page can read. Left alone.`);
  const entries = list.entries ?? [];
  let entry = entries.find((e) => typeof e?.path === 'string' && sameFolder(e.path, groupDir));
  if (on) {
    if (!installed(t)) throw new Error(`${t.name} isn't installed on this PC (no ${path.dirname(t.dir)} folder).`);
    if (!entry) {
      entry = { path: groupDir.replace(/\\/g, '/'), include_only: [] };
      entries.push(entry);
    }
    if (entry.exclude) entry.exclude = entry.exclude.filter((n) => n.toLowerCase() !== folder.toLowerCase());
    if (entry.include_only && !named(entry.include_only, folder)) entry.include_only.push(folder);
  } else if (entry) {
    // No include_only means the whole folder: list the others by name, so only this one goes.
    const keep = (entry.include_only ?? skillsIn(groupDir)).filter((n) => n.toLowerCase() !== folder.toLowerCase());
    if (keep.length) entry.include_only = keep;
    else entries.splice(entries.indexOf(entry), 1);
  }
  list.entries = entries;
  fs.mkdirSync(path.dirname(t.listFile), { recursive: true });
  fs.writeFileSync(t.listFile, JSON.stringify(list, null, 2) + '\n');
  return listState(readList(t.listFile), groupDir, folder);
}

/** An AI counts as installed when its own folder (the one holding "skills") exists. */
function installed(t: SkillTarget): boolean {
  return fs.existsSync(path.dirname(t.dir));
}

/** The skill folder for an id like "HMF_Skills/longform-edit", checked to be a real skill. */
function skillFolder(id: string): { full: string; folder: string } {
  const parts = id.split(/[\\/]/);
  if (parts.length !== 2 || !(parts[0] in SKILL_GROUPS) || !/^[A-Za-z0-9._-]+$/.test(parts[1]) || parts[1].startsWith('.')) {
    throw new Error(`"${id}" isn't a skill.`);
  }
  const full = safeResolve('skills', id);
  if (!fs.existsSync(path.join(full, 'SKILL.md'))) throw new Error(`"${id}" has no SKILL.md.`);
  return { full, folder: parts[1] };
}

/** What's at <AI folder>\<folder>: our link to `skillDir`, nothing, or something else. */
function state(t: SkillTarget, folder: string, skillDir: string): LinkState {
  const at = path.join(t.dir, folder);
  if (!fs.existsSync(at) && !isLink(at)) return 'off';
  const real = realPath(at);
  const want = realPath(skillDir);
  return isLink(at) && real && want && real.toLowerCase() === want.toLowerCase() ? 'on' : 'other';
}

export function listSkills(): SkillsOverview {
  const skills: SkillInfo[] = [];
  const lists = new Map(config.skillTargets.filter((t) => t.listFile).map((t) => [t.id, readList(t.listFile!)]));
  for (const groupFolder of Object.keys(SKILL_GROUPS) as GroupFolder[]) {
    const dir = path.join(config.skillsDir, groupFolder);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const md = path.join(full, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      const head = readHeader(fs.readFileSync(md, 'utf8'));
      const links: Record<string, LinkState> = {};
      for (const t of config.skillTargets) links[t.id] = t.listFile ? listState(lists.get(t.id) ?? null, dir, e.name) : state(t, e.name, full);
      skills.push({
        id: `${groupFolder}/${e.name}`,
        group: SKILL_GROUPS[groupFolder],
        folder: e.name,
        name: head.name ?? e.name,
        description: head.description ?? '',
        links,
      });
    }
  }
  const managed = new Set(skills.map((s) => s.folder.toLowerCase()));
  const groupDirs = Object.keys(SKILL_GROUPS).map((g) => path.join(config.skillsDir, g));
  const targets: TargetInfo[] = config.skillTargets.map((t) => {
    if (t.listFile) {
      // Folders in the list besides ours (skills added some other way).
      const others = (lists.get(t.id)?.entries ?? [])
        .filter((e) => typeof e?.path === 'string' && !groupDirs.some((g) => sameFolder(e.path, g)))
        .map((e) => e.path);
      return { ...t, installed: installed(t), others };
    }
    const others = fs.existsSync(t.dir)
      ? fs
          .readdirSync(t.dir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.') && !managed.has(e.name.toLowerCase()))
          .map((e) => e.name)
      : [];
    return { ...t, installed: installed(t), others };
  });
  return { skills, targets };
}

/**
 * The folder to show for an AI's skills: its skills folder, or the AI's own folder if "skills" isn't
 * there yet. Only the folders listed in config.json can come out of this, never a path from the page.
 */
export function targetFolder(targetId: string): string {
  const t = target(targetId);
  if (fs.existsSync(t.dir)) return t.dir;
  if (installed(t)) return path.dirname(t.dir);
  throw new Error(`${t.name} isn't installed on this PC (no ${path.dirname(t.dir)} folder).`);
}

/** Turns one skill on or off for one AI by creating or removing its link. */
export function setSkillLink(skillId: string, targetId: string, on: boolean): LinkState {
  const t = target(targetId);
  const { full, folder } = skillFolder(skillId);
  if (t.listFile) return setListed({ ...t, listFile: t.listFile }, path.dirname(full), folder, on);
  const at = path.join(t.dir, folder);
  const now = state(t, folder, full);

  if (now === 'other') {
    throw new Error(`${t.name}'s skills folder already has something called "${folder}" that isn't this skill's link. Left alone.`);
  }
  if (on) {
    if (now === 'on') return 'on';
    if (!installed(t)) throw new Error(`${t.name} isn't installed on this PC (no ${path.dirname(t.dir)} folder).`);
    fs.mkdirSync(t.dir, { recursive: true });
    fs.symlinkSync(full, at, 'junction');
    return state(t, folder, full);
  }
  if (now === 'off') return 'off';
  // Only ever remove a link that points into the skills folder, never a real folder.
  const real = realPath(at);
  const skillsReal = realPath(config.skillsDir);
  if (!isLink(at) || !real || !skillsReal || !isInside(skillsReal, real)) {
    throw new Error(`"${at}" isn't a link to a skill here. Left alone.`);
  }
  try {
    fs.unlinkSync(at); // removes the link itself
  } catch {
    fs.rmdirSync(at); // Windows junctions: removes the link, never what it points to
  }
  return state(t, folder, full);
}
