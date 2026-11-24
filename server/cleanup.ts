// Clean Up: once a video is done, everything that isn't in its CapCut projects or on YouTube goes to HeartQuarters
// Trash, as if the video had been made by hand (John, 2026-11-18). Nothing is deleted: Trash keeps it all, under the
// same folders, so anything can be moved back.
//
// Always kept: Raw and Exports; every file a CapCut project of the video uses (longform and Shorts); each packaging
// version's files (YouTube.md, Notes.md, thumbnail, other platforms) and what John put in Thumbnail\Source himself;
// everything in Subtitles, word-by-word transcripts included (John, 2026-11-18); anything not listed below.
// Removed when CapCut doesn't use it: Claude\ (CapCut backups, frames, scripts...), Packaging\Drafts, a version's
// Thumbnail\Backups and what HeartQuarters copied into Thumbnail\Source, Intermediate files (renders, sources,
// Decisions.md, Edit Scripts, Transcript). Each longform and each Short is cleaned on its own; the Shorts Plan and the
// retention graphs are cleaned from Make Shorts, since its lists come from the plan.
// A file in Claude\ that CapCut does use is moved to Intermediate\ and the CapCut projects are pointed at it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { listDrafts, plainDraftName } from './create.js';
import { writeFileSafely } from './files.js';
import { capCutMentionsPath, replaceCapCutPath, requireCapCutClosed, trashSlot } from './manage.js';
import { writable } from './safe-files.js';

/** Inside a version's Thumbnail\Source: the list of files HeartQuarters added (Use Thumbnail writes it). */
export const SOURCE_MANIFEST = '.heartquarters-added.json';

export interface CleanupItem {
  /** Relative to the Video Projects folder, with forward slashes. */
  path: string;
  size: number;
  /** Why it goes, in a few words. */
  why: string;
  /** For a file that's moved: where to, relative to the Video Projects folder. */
  to?: string;
}
export interface CleanupPlan {
  /** The piece being cleaned: "<video>/Longform" or "<video>/Shorts/<short>". */
  piece: string;
  remove: CleanupItem[];
  move: CleanupItem[];
  /** Folders that will be left empty in cleaned areas and deleted (relative to Video Projects, forward slashes). */
  removeFolders: string[];
  /** Bytes that go to Trash. */
  freed: number;
  /** Shortcuts and junctions, left alone. */
  skipped: string[];
  /** Links in the CapCut projects to files that aren't there. While there are any, nothing is cleaned up. */
  missing: string[];
  /** Changes if anything in the plan changes, so what's carried out is what John approved. */
  token: string;
}

/** What HeartQuarters itself copies into a version's Thumbnail\Source (Use Thumbnail, and Make Version before it). */
export function madeByHeartQuarters(name: string): boolean {
  return /^Draft - .+ round \d+\.\w+$/i.test(name) || /^Photo - /i.test(name) || /^Brief\.md$/i.test(name) || /^Requests( - .+)?\.md$/i.test(name) || /^References( - .+)?$/i.test(name) || name === SOURCE_MANIFEST;
}

export type Verdict = { action: 'keep' } | { action: 'remove'; why: string } | { action: 'move'; to: string; why: string };

/**
 * The rule for one file, given its path inside the video folder (forward slashes), whether a CapCut project uses it,
 * and the names HeartQuarters added to that version's Thumbnail\Source (from its list).
 */
export function classify(rel: string, used: boolean, addedToSource: Set<string> = new Set()): Verdict {
  const parts = rel.split('/');
  // Video-level files from making the Shorts: cleaned from Make Shorts, not with the longform (John, 2026-11-18).
  if (parts[0] === 'Shorts' && parts.length === 2) {
    if (/^Shorts Plan( - before .+)?\.json$/i.test(parts[1])) return used ? { action: 'keep' } : { action: 'remove', why: 'shorts plan' };
    if (/^Retention Graph( - before .+)?\.png$/i.test(parts[1])) return used ? { action: 'keep' } : { action: 'remove', why: 'retention graph' };
    return { action: 'keep' };
  }
  // The piece the file belongs to: the longform, or one Short.
  const inPiece = parts[0] === 'Longform' ? parts.slice(1) : parts[0] === 'Shorts' && parts.length > 2 ? parts.slice(2) : null;
  if (!inPiece?.length) return { action: 'keep' };
  const piece = parts.slice(0, parts.length - inPiece.length).join('/');
  const [top] = inPiece;
  if (top === 'Raw' || top === 'Exports') return { action: 'keep' };
  if (top === 'Claude') {
    return used ? { action: 'move', to: [piece, 'Intermediate', ...inPiece.slice(1)].join('/'), why: 'used in CapCut, but kept in Claude' } : { action: 'remove', why: 'AI working files' };
  }
  if (used) return { action: 'keep' };
  if (top === 'Packaging' && inPiece[1] === 'Drafts') return { action: 'remove', why: 'thumbnail and title drafts' };
  if (top === 'Packaging' && inPiece[2] === 'Thumbnail' && inPiece[3] === 'Backups') return { action: 'remove', why: 'replaced thumbnail' };
  if (top === 'Packaging' && inPiece[2] === 'Thumbnail' && inPiece[3] === 'Source' && inPiece.length > 4) {
    const name = inPiece[4];
    if (madeByHeartQuarters(name) || addedToSource.has(name)) return { action: 'remove', why: 'copied in by HeartQuarters' };
    return { action: 'keep' };
  }
  if (top === 'Intermediate') return { action: 'remove', why: 'not used in CapCut' };
  return { action: 'keep' };
}

const fwd = (p: string) => p.split(path.sep).join('/');

/** Every file the video's CapCut projects use, as lowercase full paths with forward slashes. */
export function usedByCapCut(video: string): Set<string> {
  return capcutLinks(video).used;
}

export interface CapCutLinks {
  /** Every file the video's CapCut projects use inside the video folder, as lowercase full paths, forward slashes. */
  used: Set<string>;
  /** Links to a file in John's HeartMind folders that isn't there: "<project>: <path>". */
  missing: string[];
}

/**
 * The links in the video's CapCut projects: the projects named after the video or one of its Shorts, and any other
 * that uses its files. A link to a file that isn't there means CapCut looks for it somewhere else, so files that seem
 * unused may be the ones it needs: Clean Up refuses until those are fixed (John, 2026-11-18).
 */
export function capcutLinks(video: string): CapCutLinks {
  const scan = scanLinks(video);
  for (;;) {
    const step = scan.next();
    if (step.done) return step.value;
  }
}

/** The same, letting the engine answer other requests between project files (a video's projects are ~150 MB). */
export async function capcutLinksSlowly(video: string): Promise<CapCutLinks> {
  const scan = scanLinks(video);
  for (;;) {
    const step = scan.next();
    if (step.done) return step.value;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The HeartMind paths in one project file, remembered until the file changes (reading it is the slow part). */
const linksInFile = new Map<string, { stamp: string; paths: string[] }>();

/** The video's CapCut projects: those named after it or one of its Shorts, and any other that uses its files. */
function videoDrafts(video: string): string[] {
  const prefix = `${fwd(config.videoProjectsDir)}/${video}/`.toLowerCase();
  const own = new Set([path.basename(video), ...shortNames(video)].map((n) => plainDraftName(n).toLowerCase()));
  return listDrafts().filter((d) => {
    let meta: string;
    try {
      meta = fs.readFileSync(path.join(config.capcutDraftsDir, d, 'draft_meta_info.json'), 'utf8');
    } catch (e) {
      throw new Error(`Couldn't read CapCut project "${d}" (${e instanceof Error ? e.message.split('\n')[0] : e}). Wait for CapCut or Drive to finish with it and try again. Nothing was changed.`);
    }
    return own.has(plainDraftName(d).toLowerCase()) || capCutMentionsPath(meta, prefix);
  });
}

/** A project's text files that hold links (CapCut's .json and .tmp, and .bak copies). */
function draftTextFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(json|bak|tmp)$/i.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

/**
 * Whether a path mentioned inside CapCut draft `dir` exists: either at `original` as written, or if it points into a
 * CapCut Drafts folder under an older draft name (for example ".../CapCut Drafts/021 - Working/subdraft/..."), at the
 * same relative path inside `dir` itself (where CapCut actually loads its subdrafts from).
 */
function capcutLinkExists(dir: string, original: string): boolean {
  if (fs.existsSync(original)) return true;
  const draftsRoot = config.capcutDraftsDir ? `${fwd(path.resolve(config.capcutDraftsDir))}/`.toLowerCase() : '';
  const lower = original.toLowerCase();
  if (draftsRoot && lower.startsWith(draftsRoot)) {
    const afterRoot = original.slice(draftsRoot.length);
    const slash = afterRoot.indexOf('/');
    if (slash > 0 && fs.existsSync(path.join(dir, afterRoot.slice(slash + 1)))) return true;
  }
  const m = /\/capcut drafts\/[^/]+\/(.+)$/i.exec(original);
  return !!m && fs.existsSync(path.join(dir, m[1]));
}

function* scanLinks(video: string): Generator<void, CapCutLinks> {
  const prefix = `${fwd(config.videoProjectsDir)}/${video}/`.toLowerCase();
  const heartMind = `${fwd(path.dirname(path.resolve(config.videoProjectsDir)))}/`.toLowerCase();
  const used = new Set<string>();
  const missing: string[] = [];
  for (const d of videoDrafts(video)) {
    const dir = path.join(config.capcutDraftsDir, d);
    const seen = new Set<string>();
    for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || !/\.(json|tmp)$/i.test(e.name)) continue;
      const file = path.join(e.parentPath, e.name);
      const stat = fs.statSync(file);
      if (stat.size > 200_000_000) continue;
      const stamp = `${stat.size}:${stat.mtimeMs}:${heartMind}`;
      let paths = linksInFile.get(file)?.stamp === stamp ? linksInFile.get(file)!.paths : null;
      if (!paths) {
        const found = new Set<string>();
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/"((?:[A-Za-z]:)?[^"]*?)"/g)) {
          const original = m[1].replace(/\\\\/g, '/').replace(/\\/g, '/');
          if (original.toLowerCase().startsWith(heartMind)) found.add(original);
        }
        paths = [...found];
        linksInFile.set(file, { stamp, paths });
        yield;
      }
      // "template (1).json", "mini_draft (1).json": copies Google Drive made, which CapCut never reads. Their links still
      // count as used (keeping more is safe), but a stale link in them isn't a missing link in the project.
      // draft_agency_config.json only remembers which clips CapCut once made proxies for; it isn't checked when the
      // project opens, so old paths in it aren't broken links (005B, 2026-11-18).
      const driveCopy = / \(\d+\)\.[a-z]+$/i.test(e.name) || e.name.toLowerCase() === 'draft_agency_config.json';
      for (const original of paths) {
        const value = original.toLowerCase();
        if (value.startsWith(prefix)) used.add(value);
        // A file (it has an extension) in the HeartMind folders that isn't there.
        if (!driveCopy && /\.[a-z0-9]{2,5}$/i.test(value) && !seen.has(value)) {
          seen.add(value);
          if (!capcutLinkExists(dir, original)) missing.push(`${d}: ${original}`);
        }
      }
    }
  }
  return { used, missing };
}

/** The names of the video's Shorts' folders (their CapCut projects have the same names). */
function shortNames(video: string): string[] {
  try {
    return fs.readdirSync(safeResolve('projects', `${video}/Shorts`), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * A piece to clean, checked: "<video>/Longform", "<video>/Shorts/<short>", or "<video>/Shorts" for Make Shorts' own
 * files (the Shorts Plan and retention graphs). A video may be a series part, one folder deeper. Returns the video's
 * folder and the piece's place inside it.
 */
export function pieceOf(piece: string): { video: string; inVideo: string } {
  const parts = String(piece ?? '').split('/');
  const bad = () => new Error('Choose a longform, a Short or Make Shorts to clean up.');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) throw bad();
  if (parts.length > 1 && parts.at(-1) === 'Shorts') return { video: parts.slice(0, -1).join('/'), inVideo: 'Shorts' };
  let at = parts.lastIndexOf('Longform');
  if (at === parts.length - 1 && at > 0) return { video: parts.slice(0, at).join('/'), inVideo: 'Longform' };
  at = parts.length - 2;
  if (at > 0 && parts[at] === 'Shorts') return { video: parts.slice(0, at).join('/'), inVideo: `Shorts/${parts[at + 1]}` };
  throw bad();
}

/** The cleanup list for one piece: the longform, one Short, or Make Shorts' plan and retention graphs. Changes nothing. */
export function cleanupPlan(piece: string, given?: Set<string> | CapCutLinks): CleanupPlan {
  const { video, inVideo } = pieceOf(piece);
  const pieceRoot = safeResolve('projects', `${video}/${inVideo}`);
  if (!fs.existsSync(pieceRoot) || !fs.statSync(pieceRoot).isDirectory()) throw new Error('That folder was not found.');
  const links = given instanceof Set ? { used: given, missing: [] } : (given ?? capcutLinks(video));
  const used = links.used;
  if (links.missing.length) {
    return { piece: `${video}/${inVideo}`, remove: [], move: [], removeFolders: [], freed: 0, skipped: [], missing: links.missing, token: '' };
  }
  const remove: CleanupItem[] = [];
  const move: CleanupItem[] = [];
  const removeFolders: string[] = [];
  const skipped: string[] = [];
  const walk = (dir: string, rel: string, added: Set<string>): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    // In a Thumbnail\Source folder, HeartQuarters' own list of what it added.
    let here = added;
    if (/\/Thumbnail\/Source$/i.test(rel) && entries.some((e) => e.name === SOURCE_MANIFEST)) {
      try {
        const list = JSON.parse(fs.readFileSync(path.join(dir, SOURCE_MANIFEST), 'utf8')) as unknown;
        if (Array.isArray(list)) here = new Set(list.filter((x): x is string => typeof x === 'string'));
      } catch {
        /* an unreadable list adds nothing */
      }
    }
    let empty = true;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) {
        skipped.push(`${video}/${r}`);
        empty = false;
        continue;
      }
      if (e.isDirectory()) {
        if (walk(full, r, here) && classify(`${r}/x`, false).action !== 'keep') {
          removeFolders.push(`${video}/${r}`);
        } else {
          empty = false;
        }
      } else if (e.isFile()) {
        const v = classify(r, used.has(`${fwd(full)}`.toLowerCase()), here);
        if (v.action === 'keep') {
          empty = false;
          continue;
        }
        const item: CleanupItem = { path: `${video}/${r}`, size: fs.statSync(full).size, why: v.why };
        if (v.action === 'move') move.push({ ...item, to: `${video}/${v.to}` });
        else remove.push(item);
      } else {
        empty = false;
      }
    }
    return empty;
  };
  if (inVideo === 'Shorts') {
    // Make Shorts: only the files beside the Shorts' folders (the plan and retention graphs), never inside a Short.
    for (const e of fs.readdirSync(pieceRoot, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const full = path.join(pieceRoot, e.name);
      const v = classify(`Shorts/${e.name}`, used.has(fwd(full).toLowerCase()));
      if (v.action === 'remove') remove.push({ path: `${video}/Shorts/${e.name}`, size: fs.statSync(full).size, why: v.why });
    }
  } else walk(pieceRoot, inVideo, new Set());
  removeFolders.sort();
  const freed = remove.reduce((n, i) => n + i.size, 0);
  const token = crypto.createHash('sha1').update(JSON.stringify([remove, move, removeFolders])).digest('hex');
  return { piece: `${video}/${inVideo}`, remove, move, removeFolders, freed, skipped, missing: [], token };
}

/** Removes folders left empty inside the areas that were cleaned, deepest first. Never the piece's own folders. */
function removeEmptyFolders(root: string, inVideo: string) {
  const walk = (dir: string, rel: string): boolean => {
    let empty = true;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.isSymbolicLink()) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (walk(path.join(dir, e.name), r)) {
          const v = classify(`${r}/x`, false);
          if (v.action !== 'keep') fs.rmdirSync(writable(path.join(dir, e.name)));
          else empty = false;
        } else empty = false;
      } else empty = false;
    }
    return empty;
  };
  walk(root, inVideo);
}

/**
 * Carries out the plan John approved (`token`): files to remove go to HeartQuarters Trash under their same folders,
 * and files used from Claude\ move to Intermediate\ with the CapCut projects pointed at them (their old text files
 * are kept in Trash first). CapCut must be closed. Returns what was done and where Trash put it.
 */
export function runCleanup(piece: string, token: unknown): { removed: number; moved: number; freed: number; trash: string } {
  requireCapCutClosed();
  if (!config.trashDir) throw new Error('No trash folder is set in config.json. Nothing was changed.');
  const { video, inVideo } = pieceOf(piece);
  const plan = cleanupPlan(piece);
  if (plan.missing.length) throw new Error(`The CapCut projects have ${plan.missing.length} missing ${plan.missing.length === 1 ? 'link' : 'links'}. Fix ${plan.missing.length === 1 ? 'it' : 'them'} in CapCut first, so nothing it needs is taken for unused. Nothing was changed.`);
  if (plan.token !== token) throw new Error('The files changed since the list was made. Look at the new list and approve it again. Nothing was changed.');
  const slot = trashSlot(`${path.basename(video)} ${inVideo === 'Longform' ? 'Longform' : inVideo === 'Shorts' ? 'Shorts plan' : path.basename(inVideo)} (clean up)`);
  const projects = path.resolve(config.videoProjectsDir);

  if (plan.move.length) {
    // Only the video's own projects can use its files. Their text files as they were go to Trash first.
    const drafts = videoDrafts(video);
    for (const d of drafts) {
      const dir = path.join(config.capcutDraftsDir, d);
      for (const from of draftTextFiles(dir)) {
        const to = path.join(slot, 'CapCut Drafts (before)', d, path.relative(dir, from));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
    }
    const relinks: [string, string][] = [];
    for (const item of plan.move) {
      const from = writable(path.join(projects, item.path));
      let to = writable(path.join(projects, item.to!));
      for (let n = 2; fs.existsSync(to); n++) to = writable(path.join(projects, item.to!.replace(/(\.[^./]+)?$/, ` (${n})$1`)));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      relinks.push([fwd(from), fwd(to)]);
    }
    // Each project file is read once and gets every new path (a project is ~20 MB of text).
    for (const d of drafts) {
      for (const file of draftTextFiles(path.join(config.capcutDraftsDir, d))) {
        if (fs.statSync(file).size > 200_000_000) continue;
        const text = fs.readFileSync(file, 'utf8');
        const after = relinks.reduce((t, [from, to]) => replaceCapCutPath(t, from, to), text);
        if (after !== text) writeFileSafely(file, after);
      }
    }
  }
  for (const item of plan.remove) {
    const from = writable(path.join(projects, item.path));
    const to = path.join(slot, item.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  if (inVideo !== 'Shorts') removeEmptyFolders(safeResolve('projects', `${video}/${inVideo}`), inVideo);
  return { removed: plan.remove.length, moved: plan.move.length, freed: plan.freed, trash: slot };
}
