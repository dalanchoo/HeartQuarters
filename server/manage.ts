// Renaming and deleting video folders, together with their CapCut drafts.
//
// Delete never really deletes: it MOVES the folder (and the chosen drafts)
// into the trash folder (config.trashDir), so anything can be put back by
// moving it out again. Emptying that folder is up to you.
//
// Rename also fixes the links inside CapCut drafts: CapCut stores full paths
// like "D:/Google Drive/HeartMind/Video Projects/022 - X/Longform/Raw/a.mp4",
// which would break when "022 - X" is renamed.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { writeFileSafely } from './files.js';
import { STANDALONE_GROUP, checkDraftName, checkFolderName, listDrafts, plainDraftName } from './create.js';

const PROJECT_RE = /^\d+\s*[-–]/; // "022 - ..."
const SERIES_RE = /^\d+[A-Z]\s*[-–]/; // "005B - ..."

/** Can be swapped in tests. */
export const system = {
  isCapCutRunning(): boolean {
    try {
      const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq CapCut.exe', '/NH'], { encoding: 'utf8' });
      return /capcut\.exe/i.test(out);
    } catch {
      return false;
    }
  },
  /** Starts CapCut, or brings it forward if it's already open. It has no way to be told which project to open. */
  startCapCut() {
    spawn(config.capcutExe, [], { detached: true, stdio: 'ignore' }).unref();
  },
};

/**
 * "Open CapCut": checks the project exists and starts CapCut. CapCut can't be told which project to open: it has no
 * documented way, and --draft_path= (in its program files) only shows the home screen. So the page copies the name too.
 */
export function openInCapCut(draft: unknown): string {
  const name = checkDraftName(String(draft ?? ''));
  if (!fs.existsSync(config.capcutExe)) throw new Error(`CapCut isn't at "${config.capcutExe}". Set capcutExe in config.json.`);
  system.startCapCut();
  return name;
}

/**
 * Only real video folders can be renamed or deleted: a project or series,
 * a part, a short or reel, or a standalone short. Never the templates,
 * "999 - Shorts" itself, its year folders, or anything inside a video.
 */
export function checkManageable(id: string): string[] {
  const s = id.split('/');
  const bad = () => new Error("That folder can't be renamed or deleted from here.");
  if (s.some((x) => !x || x === '.' || x === '..' || x.includes('\\'))) throw bad();
  const isTop = (x: string) => PROJECT_RE.test(x) && x !== STANDALONE_GROUP;
  const isVideo = (p: string[]) => (p.length === 1 && isTop(p[0])) || (p.length === 2 && isTop(p[0]) && SERIES_RE.test(p[1]));
  const ok =
    isVideo(s) ||
    (s.length >= 3 && ['Shorts', 'Reels'].includes(s.at(-2)!) && isVideo(s.slice(0, -2))) ||
    (s.length === 3 && s[0] === STANDALONE_GROUP && /^\d{4}$/.test(s[1]));
  if (!ok) throw bad();
  const full = safeResolve('projects', id);
  if (!fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()) throw new Error('That folder no longer exists.');
  return s;
}

/** Names of every video inside a folder: itself, its parts, and their shorts and reels. */
function videoNames(dir: string): string[] {
  const names = [path.basename(dir)];
  const subs = (d: string) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const addPieces = (d: string) => {
    for (const group of ['Shorts', 'Reels']) names.push(...subs(path.join(d, group)));
  };
  addPieces(dir);
  for (const part of subs(dir).filter((d) => SERIES_RE.test(d))) {
    names.push(part);
    addPieces(path.join(dir, part));
  }
  return names;
}

/** The CapCut drafts that belong to the videos in a folder (matching names, ignoring CapCut's "(1)"). */
function draftsFor(names: string[]): string[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return listDrafts().filter((d) => wanted.has(plainDraftName(d).toLowerCase()) && !d.startsWith('---'));
}

export interface ManageInfo {
  name: string;
  files: number;
  bytes: number;
  /** Drafts named after this folder (for rename). */
  ownDrafts: string[];
  /** Drafts of this folder and every video inside it (for delete). */
  allDrafts: string[];
  capcutRunning: boolean;
  trashDir: string;
}

export function manageInfo(id: string): ManageInfo {
  checkManageable(id);
  const dir = safeResolve('projects', id);
  let files = 0;
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    files++;
    bytes += fs.statSync(path.join(e.parentPath, e.name)).size;
  }
  const name = path.basename(dir);
  return {
    name,
    files,
    bytes,
    ownDrafts: draftsFor([name]),
    allDrafts: draftsFor(videoNames(dir)),
    capcutRunning: system.isCapCutRunning(),
    trashDir: config.trashDir,
  };
}

/** Drafts the user ticked must be ones we offered (never any other draft). */
function checkDrafts(chosen: unknown, offered: string[]): string[] {
  const list = Array.isArray(chosen) ? chosen.map(String) : [];
  for (const d of list) {
    checkDraftName(d);
    if (!offered.includes(d)) throw new Error(`"${d}" isn't one of this folder's CapCut drafts.`);
  }
  return list;
}

function requireCapCutClosed() {
  if (system.isCapCutRunning()) {
    throw new Error('Close CapCut first, then try again. (If CapCut is open, it can save its old copy of a draft and wipe out the change.) Nothing was changed.');
  }
}

/** Where a folder's page lives after a change: its parent video, or the list. */
function parentPage(segments: string[]): string {
  if (segments.length >= 3 && ['Shorts', 'Reels'].includes(segments.at(-2)!)) return segments.slice(0, -2).join('/');
  if (segments.length === 2) return segments[0];
  return '';
}

const forwardSlashes = (p: string) => p.split(path.sep).join('/');

/** Updates one draft's text files. Throws if any of them can't be read or written. */
function relinkDraft(dir: string, from: string, to: string) {
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !/\.(json|bak|tmp)$/i.test(e.name)) continue;
    const file = path.join(e.parentPath, e.name);
    if (fs.statSync(file).size > 200_000_000) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(from)) continue;
    writeFileSafely(file, text.split(from).join(to));
  }
}

/**
 * Replaces "<Video Projects>/<old>/" with "<Video Projects>/<new>/" in the text files of every CapCut draft that
 * refers to the old folder. A draft that can't be read or updated is skipped and named, and the rest are still done:
 * by now the folder has already been renamed, so stopping would leave the others pointing at the old name.
 */
function relinkDrafts(oldId: string, newId: string): { updated: number; failed: string[] } {
  const base = forwardSlashes(config.videoProjectsDir);
  const from = `${base}/${oldId}/`;
  const to = `${base}/${newId}/`;
  let updated = 0;
  const failed: string[] = [];
  for (const d of listDrafts()) {
    const dir = path.join(config.capcutDraftsDir, d);
    try {
      // Every draft lists the files it uses in draft_meta_info.json: a quick way to skip the others.
      if (!fs.readFileSync(path.join(dir, 'draft_meta_info.json'), 'utf8').includes(from)) continue;
      relinkDraft(dir, from, to);
      updated++;
    } catch (e) {
      failed.push(`"${d}" (${e instanceof Error ? e.message.split('\n')[0] : e})`);
    }
  }
  return { updated, failed };
}

/** Renames a draft folder and updates its own name and path inside draft_meta_info.json. */
function renameDraft(oldDraft: string, newDraft: string) {
  const from = path.join(config.capcutDraftsDir, oldDraft);
  const to = path.join(config.capcutDraftsDir, newDraft);
  if (fs.existsSync(to)) throw new Error(`A CapCut draft called "${newDraft}" already exists.`);
  fs.renameSync(from, to);
  const metaFile = path.join(to, 'draft_meta_info.json');
  const meta = fs
    .readFileSync(metaFile, 'utf8')
    .replace(/("draft_name"\s*:\s*)"(?:[^"\\]|\\.)*"/, (_m, h: string) => h + JSON.stringify(newDraft))
    .replace(/("draft_fold_path"\s*:\s*)"(?:[^"\\]|\\.)*"/, (_m, h: string) => h + JSON.stringify(forwardSlashes(to)));
  writeFileSafely(metaFile, meta);
}

export interface ManageResult {
  /** Page to show afterwards ('' = the list). */
  showId: string;
  message: string;
}

/**
 * Renames a video folder. Ticked drafts named after it get the new name too
 * (keeping CapCut's "(2)" etc.), and links inside every draft that uses files
 * from the folder are updated.
 */
export function renameFolder(id: string, rawNewName: string, drafts: unknown): ManageResult {
  const segments = checkManageable(id);
  const oldName = segments.at(-1)!;
  const newName = checkFolderName(rawNewName);
  if (newName === oldName) throw new Error('That is already its name.');
  const newSegments = [...segments.slice(0, -1), newName];
  const newId = newSegments.join('/');
  // Keep names the app recognises, so the folder doesn't vanish from the list.
  if (segments.length === 1 && (!PROJECT_RE.test(newName) || newName === STANDALONE_GROUP)) {
    throw new Error('A project name must start with its number, like "023 - ".');
  }
  if (segments.length === 2 && !SERIES_RE.test(newName)) {
    throw new Error(`A part's name must start with its number and letter, like "${oldName.split(' ')[0]} - ".`);
  }
  const chosen = checkDrafts(drafts, draftsFor([oldName]));
  requireCapCutClosed();

  const from = safeResolve('projects', id);
  const to = safeResolve('projects', newId);
  if (fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) throw new Error(`"${newName}" already exists. Nothing was changed.`);
  fs.renameSync(from, to);

  const notes: string[] = [`Renamed the folder to "${newName}".`];
  for (const d of chosen) {
    const renamed = newName + d.slice(plainDraftName(d).length); // keeps "(2)"
    try {
      renameDraft(d, renamed);
      notes.push(`Renamed the CapCut draft "${d}" to "${renamed}".`);
    } catch (e) {
      notes.push(`Couldn't rename the CapCut draft "${d}": ${e instanceof Error ? e.message : e}`);
    }
  }
  const { updated, failed } = relinkDrafts(segments.join('/'), newId);
  if (updated) notes.push(`Updated the links in ${updated} CapCut draft${updated === 1 ? '' : 's'} that use files from this folder.`);
  if (failed.length) {
    notes.push(
      `Couldn't check or update the links in ${failed.length === 1 ? 'this CapCut draft' : 'these CapCut drafts'}, so ` +
        `${failed.length === 1 ? 'it' : 'they'} may still point at the old name: ${failed.join(', ')}.`,
    );
  }
  const isPiece = segments.length >= 3 && segments[0] !== STANDALONE_GROUP;
  return { showId: isPiece ? parentPage(segments) : newId, message: notes.join(' ') };
}

/** A new, unused folder inside the trash for one delete: "2026-11-06 2315 - 023 - Test". */
function trashSlot(name: string): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const slot = path.join(config.trashDir, `${stamp} - ${name}`);
  fs.mkdirSync(slot, { recursive: true });
  return slot;
}

/** Regenerate: moves one CapCut project into the trash, so a fresh copy can take its name. Returns where it went. */
export function trashDraft(name: string): string {
  const draft = checkDraftName(name);
  requireCapCutClosed();
  if (!config.trashDir) throw new Error('No trash folder is set in config.json. Nothing was changed.');
  const slot = trashSlot(`${draft} (regenerated)`);
  fs.mkdirSync(path.join(slot, 'CapCut Drafts'));
  fs.renameSync(path.join(config.capcutDraftsDir, draft), path.join(slot, 'CapCut Drafts', draft));
  return slot;
}

/** Moves a video folder, and the ticked CapCut drafts, into the trash folder. */
export function deleteFolder(id: string, drafts: unknown): ManageResult {
  const segments = checkManageable(id);
  const name = segments.at(-1)!;
  const dir = safeResolve('projects', id);
  const chosen = checkDrafts(drafts, draftsFor(videoNames(dir)));
  if (chosen.length) requireCapCutClosed();
  if (!config.trashDir) throw new Error('No trash folder is set in config.json. Nothing was changed.');

  const slot = trashSlot(name);
  fs.renameSync(dir, path.join(slot, name));
  const notes = [`Moved "${name}" to the trash.`];
  if (chosen.length) {
    fs.mkdirSync(path.join(slot, 'CapCut Drafts'));
    for (const d of chosen) {
      try {
        fs.renameSync(path.join(config.capcutDraftsDir, d), path.join(slot, 'CapCut Drafts', d));
        notes.push(`Moved the CapCut draft "${d}" too.`);
      } catch (e) {
        notes.push(`Couldn't move the CapCut draft "${d}": ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  notes.push(`To undo, move it back from ${slot}.`);
  return { showId: parentPage(segments), message: notes.join(' ') };
}

