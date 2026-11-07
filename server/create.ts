// Creates new video folders from the "--- ... TEMPLATE" folders, plus a
// matching CapCut draft. This is the only part of the app that writes into
// Video Projects, and it only ever ADDS new folders: if the folder (or the
// CapCut draft) already exists it stops, so nothing is ever overwritten.
//
//   top        023 - Title\Longform                      (from --- LONGFORM TEMPLATE)
//   part       015 - NVC\015B - Title\Longform           (from --- LONGFORM TEMPLATE)
//   short      015 - NVC\015A - ...\Shorts\015A_S02 - Title   (from --- SHORTS TEMPLATE)
//   standalone 999 - Shorts\2026\999-2026-23 - Title     (from --- STANDALONE SHORTS TEMPLATE)
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { readProject } from './projects.js';

export type NewKind = 'top' | 'part' | 'short' | 'standalone';

export const TEMPLATES: Record<NewKind, string> = {
  top: '--- LONGFORM TEMPLATE',
  part: '--- LONGFORM TEMPLATE',
  short: '--- SHORTS TEMPLATE',
  standalone: '--- STANDALONE SHORTS TEMPLATE',
};

export const STANDALONE_GROUP = '999 - Shorts';

export function parseKind(value: unknown): NewKind {
  if (value === 'top' || value === 'part' || value === 'short' || value === 'standalone') return value;
  throw new Error('Unknown kind of folder.');
}

function subfolders(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/** Highest number captured by `re` among `names` (0 if none). */
function highest(names: string[], re: RegExp): number {
  return names.reduce((max, n) => Math.max(max, Number(re.exec(n)?.[1] ?? 0)), 0);
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** "015 - NVC" -> "015", "015 - NVC/015A - Making..." -> "015A" */
function numberOf(id: string): string {
  const last = id.split('/').at(-1) ?? '';
  const m = /^(\d+[A-Z]?)\s*[-–]/.exec(last);
  if (!m) throw new Error(`Can't find a number at the start of "${last}".`);
  return m[1];
}

/** The parent folder must exist and be the right kind for what's being made inside it. */
function checkParent(kind: NewKind, parentId: string) {
  if (kind === 'top' || kind === 'standalone') return;
  const parent = readProject(parentId); // validates the id and that it exists
  if (kind === 'part' && parent.kind !== 'series') throw new Error('New parts can only go inside a series.');
  if (kind === 'short' && parent.kind !== 'project' && parent.kind !== 'part') {
    throw new Error('New shorts can only go inside a video project or a part of a series.');
  }
}

/** The start of the name to suggest, e.g. "023 - ", "015B - ", "015A_S02 - ", "999-2026-23 - ". */
export function suggestPrefix(kind: NewKind, parentId = '', year = new Date().getFullYear()): string {
  const root = config.videoProjectsDir;
  checkParent(kind, parentId);
  if (kind === 'top') {
    const n = highest(subfolders(root).filter((d) => !d.startsWith('999')), /^(\d{3})\s*[-–]/);
    return `${pad(n + 1, 3)} - `;
  }
  if (kind === 'part') {
    const num = numberOf(parentId);
    const re = new RegExp(`^${num}([A-Z])\\s*[-–]`);
    const letters = subfolders(safeResolve('projects', parentId)).map((d) => re.exec(d)?.[1]).filter(Boolean);
    const last = letters.sort().at(-1);
    const next = last ? String.fromCharCode(last.charCodeAt(0) + 1) : 'A';
    if (next > 'Z') throw new Error('This series already goes up to Z.');
    return `${num}${next} - `;
  }
  if (kind === 'short') {
    const num = numberOf(parentId);
    const n = highest(subfolders(path.join(safeResolve('projects', parentId), 'Shorts')), /_S(\d+)/i);
    return `${num}_S${pad(n + 1, 2)} - `;
  }
  const n = highest(subfolders(path.join(root, STANDALONE_GROUP, String(year))), new RegExp(`^999-${year}-(\\d+)`));
  return `999-${year}-${pad(n + 1, 2)} - `;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Makes sure a typed name is a single, valid Windows folder name. Returns it trimmed. */
export function checkFolderName(name: unknown): string {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('Please type a name.');
  if (n.length > 150) throw new Error('That name is too long.');
  if (/[<>:"/\\|?*\x00-\x1f]/.test(n)) throw new Error('A folder name can\'t contain any of these: < > : " / \\ | ? *');
  if (n.endsWith('.')) throw new Error("A folder name can't end with a dot.");
  if (n === '.' || n === '..' || RESERVED.test(n)) throw new Error('Windows doesn\'t allow that folder name.');
  return n;
}

export interface CreateResult {
  /** The page to show afterwards (the new folder, or for a short the video it belongs to). */
  showId: string;
  /** The new folder, relative to Video Projects. */
  path: string;
  capcut: { created: boolean; message: string };
}

/** Makes a folder that must not exist yet (mkdir refuses an existing one, so nothing is ever overwritten). */
function makeNewFolder(dir: string) {
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`"${path.basename(dir)}" already exists. Nothing was changed.`);
    }
    throw e;
  }
}

function templateDir(kind: NewKind): string {
  const template = path.join(config.videoProjectsDir, TEMPLATES[kind]);
  if (!fs.statSync(template, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`The template folder "${TEMPLATES[kind]}" is missing from Video Projects.`);
  }
  return template;
}

/** Copies a template folder to `dest`, which must not exist yet. */
function copyTemplate(kind: NewKind, dest: string, name: string) {
  const template = templateDir(kind);
  makeNewFolder(dest);
  fs.cpSync(template, dest, { recursive: true, errorOnExist: true, force: false });
  // "XXX - Topic - Script.docx" -> "023 - Title - Script.docx"
  for (const file of fs.readdirSync(dest)) {
    if (file.startsWith('XXX - Topic')) {
      const renamed = path.join(dest, name + file.slice('XXX - Topic'.length));
      if (!fs.existsSync(renamed)) fs.renameSync(path.join(dest, file), renamed);
    }
  }
}

/**
 * Makes the new folder, then its CapCut draft. `copyDraft` (shorts only) names
 * an existing CapCut draft to duplicate, e.g. the long-form's; otherwise the
 * empty template draft is used.
 */
export async function createVideoFolder(
  kind: NewKind,
  parentId: string,
  rawName: string,
  copyDraft = '',
): Promise<CreateResult> {
  const name = checkFolderName(rawName);
  const source = copyDraft ? checkDraftName(copyDraft) : '';
  checkParent(kind, parentId);
  templateDir(kind); // check before making anything
  const year = String(new Date().getFullYear());

  let folderId: string;
  let showId: string;
  if (kind === 'top') {
    folderId = showId = name;
  } else if (kind === 'part') {
    folderId = showId = `${parentId}/${name}`;
  } else if (kind === 'short') {
    folderId = `${parentId}/Shorts/${name}`;
    showId = parentId;
  } else {
    folderId = showId = `${STANDALONE_GROUP}/${year}/${name}`;
  }

  const folder = safeResolve('projects', folderId);
  if (kind === 'top' || kind === 'part') {
    makeNewFolder(folder);
    copyTemplate(kind, path.join(folder, 'Longform'), name);
  } else {
    fs.mkdirSync(path.dirname(folder), { recursive: true }); // Shorts\ or 999 - Shorts\2026\
    copyTemplate(kind, folder, name);
  }

  return {
    showId,
    path: folderId,
    capcut: await createCapCutDraft(name, kind === 'top' || kind === 'part' ? 'longform' : 'short', source),
  };
}

/**
 * A new series: "023 - Test" holding its first part "023A - Test Part 1\Longform".
 * The part must be named like "023A - ...", or the app wouldn't see the
 * folder as a series. The CapCut draft is made for the part.
 */
export async function createSeries(rawName: string, rawPartName: string): Promise<CreateResult> {
  const name = checkFolderName(rawName);
  const partName = checkFolderName(rawPartName);
  const num = /^(\d+)\s*[-–]/.exec(name)?.[1];
  if (!num) throw new Error('The series name must start with its number, like "023 - ".');
  if (!new RegExp(`^${num}[A-Z]\\s*[-–]`).test(partName)) {
    throw new Error(`The first part's name must start like "${num}A - ", so it shows up as part of the series.`);
  }
  templateDir('part'); // check before making anything
  const dir = safeResolve('projects', name);
  makeNewFolder(dir);
  makeNewFolder(path.join(dir, partName));
  copyTemplate('part', path.join(dir, partName, 'Longform'), partName);
  const id = `${name}/${partName}`;
  return { showId: id, path: id, capcut: await createCapCutDraft(partName, 'longform') };
}

// ---- CapCut ------------------------------------------------------------------

/** Sets one JSON value in the text, leaving everything else exactly as CapCut wrote it. */
function setJsonValue(json: string, key: string, value: string | number): string {
  const re = new RegExp(`("${key}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d+)`);
  return json.replace(re, (_m, head: string) => head + JSON.stringify(value));
}

const isDraft = (dir: string) => fs.existsSync(path.join(dir, 'draft_meta_info.json'));

/** Every CapCut draft, newest first. */
export function listDrafts(): string[] {
  const dir = config.capcutDraftsDir;
  if (!dir) return [];
  return subfolders(dir)
    .filter((d) => isDraft(path.join(dir, d)))
    .map((d) => ({ d, t: fs.statSync(path.join(dir, d, 'draft_meta_info.json')).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.d);
}

/** A draft name must be one existing draft, nothing else. */
function checkDraftName(name: string): string {
  const n = checkFolderName(name);
  if (!isDraft(path.join(config.capcutDraftsDir, n))) throw new Error(`There's no CapCut draft called "${n}".`);
  return n;
}

/**
 * The drafts that probably belong to a video, best guess first. CapCut adds
 * "(1)", "(2)"... to copies, so "022 - Worth Telling Them(1)" counts too.
 */
export function draftsForVideo(parentId: string, all = listDrafts()): string[] {
  const folder = parentId.split('/').at(-1) ?? '';
  const num = numberOf(parentId);
  const plain = (d: string) => d.replace(/\s*\(\d+\)$/, '').trim();
  const same = all.filter((d) => plain(d).toLowerCase() === folder.toLowerCase());
  const similar = all.filter((d) => !same.includes(d) && new RegExp(`^${num}\\s*[-–]`).test(d));
  return [...same, ...similar];
}

/**
 * Makes a CapCut draft called `name` by copying another draft: `source` if
 * given (e.g. the long-form's draft, for a short cut from it), otherwise the
 * empty draft you made once in CapCut ("--- LONGFORM TEMPLATE" or
 * "--- SHORTS TEMPLATE"). The copy gets its own name and id. Never fails the
 * whole job: it reports what happened.
 */
export async function createCapCutDraft(
  name: string,
  which: 'longform' | 'short',
  source = '',
): Promise<CreateResult['capcut']> {
  const drafts = config.capcutDraftsDir;
  const templateName = source || config.capcutTemplates[which];
  if (!drafts) return { created: false, message: 'No CapCut drafts folder is set in config.json.' };
  const template = path.join(drafts, templateName);
  const dest = path.join(drafts, name);
  let madeDest = false;
  try {
    if (!fs.existsSync(path.join(template, 'draft_meta_info.json'))) {
      return {
        created: false,
        message: `No CapCut draft was made: first create an empty draft called "${templateName}" in CapCut (once).`,
      };
    }
    if (fs.existsSync(dest)) return { created: false, message: `A CapCut draft called "${name}" already exists. Left it alone.` };
    makeNewFolder(dest);
    madeDest = true;
    // Not cpSync: a big draft can take a while, and the app should keep responding.
    // dest was just made empty above, so nothing in it can be overwritten.
    await fs.promises.cp(template, dest, { recursive: true, force: false });
    const metaFile = path.join(dest, 'draft_meta_info.json');
    const now = Date.now() * 1000; // CapCut counts in microseconds
    let meta = fs.readFileSync(metaFile, 'utf8');
    meta = setJsonValue(meta, 'draft_name', name);
    meta = setJsonValue(meta, 'draft_fold_path', dest.split(path.sep).join('/'));
    meta = setJsonValue(meta, 'draft_root_path', drafts.split(path.sep).join('/'));
    meta = setJsonValue(meta, 'draft_id', randomUUID().toUpperCase());
    meta = setJsonValue(meta, 'tm_draft_create', now);
    meta = setJsonValue(meta, 'tm_draft_modified', now);
    const check = JSON.parse(meta);
    if (check.draft_name !== name || check.draft_fold_path !== dest.split(path.sep).join('/')) {
      throw new Error("the template's draft_meta_info.json isn't in the expected format.");
    }
    fs.writeFileSync(metaFile, meta);
    const from = source ? ` (a copy of "${source}")` : '';
    return { created: true, message: `Made the CapCut draft "${name}"${from}. Restart CapCut if it doesn't show up.` };
  } catch (e) {
    // Only ever removes the half-made copy this function just started.
    if (madeDest) fs.rmSync(dest, { recursive: true, force: true });
    return { created: false, message: `Couldn't make the CapCut draft: ${e instanceof Error ? e.message : e}` };
  }
}
