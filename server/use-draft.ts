// Use Thumbnail / Use Title: puts a draft round John likes (e.g. Drafts\ChatGPT 01\05.png) into the packaging version he
// has selected, like editing that version by hand. The screens lock old versions, so this only reaches one he unlocked.
//   Thumbnail\Thumbnail.png   the draft enlarged to YouTube's full size (3840 x 2160, or 2160 x 3840 for a Short)
//   Thumbnail\Source\         the draft as made, the photo, the brief, the requests and their reference images
//   Thumbnail\Backups\        a thumbnail that was there before ("Replaced ..."): nothing is deleted
//   YouTube.md                the pair's title, and/or its thumbnail text and idea
//   Notes.md                  a line saying what was used, and what the title was before
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { resolveExpressionPhoto } from './expression-photo-path.js';
import { versionFolder } from './packaging-version.js';
import { copyNewFile, makeFolder, moveFile, readable, readText, writable, writeFile } from './safe-files.js';
import { madeByHeartQuarters, SOURCE_MANIFEST } from './cleanup.js';
import { CHOICE_FILE, DRAFTS_FOLDER, NOTES_FILE, readChoice, type BriefPick } from './projects.js';
import { isShort, readConversation } from './thumbnails.js';
import { AI_NAMES } from './ai.js';

/** Makes `out` from `source` at exactly width x height (filling the frame, trimming any sliver). Tests pass a fake. */
export type Enlarge = (source: string, out: string, width: number, height: number) => Promise<void>;
export type Measure = (file: string) => Promise<{ width: number; height: number } | null>;

const LABEL_RE = /^[A-Z][A-Za-z ]{0,30}:\s*$/;
/** Older files wrote some labels in capitals without the colon ("PINNED COMMENT"); only known field names count. */
const OLD_LABELS = new Set(['title', 'tags', 'pinned comment', 'comment', 'hashtags', 'thumbnail text', 'thumbnail idea', 'video language', 'made for kids', 'altered content', 'playlists']);
const isLabel = (line: string) => LABEL_RE.test(line) || OLD_LABELS.has(line.replace(/:$/, '').toLowerCase()) && /^[A-Z][A-Z ]+:?$/.test(line);
const ROUND_RE = /^(\d+)\.(png|jpe?g|webp)$/i;

/**
 * Sets one field of a labelled file like YouTube.md ("Title:" on its own line, the value below it) to a one-line value,
 * replacing what was there up to the next blank line or label. A missing field is added at the end.
 */
export function setField(text: string, label: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `${label.toLowerCase()}:`);
  if (at < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return [...lines, '', `${label}:`, value].join(eol) + eol;
  }
  let end = at + 1;
  while (end < lines.length && lines[end].trim() && !isLabel(lines[end].trim())) end++;
  lines.splice(at + 1, end - (at + 1), value);
  return lines.join(eol);
}

/** One field's current one-line value, or '' when it's missing or empty. */
export function getField(text: string, label: string): string {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `${label.toLowerCase()}:`);
  const next = at >= 0 ? lines[at + 1]?.trim() ?? '' : '';
  return next && !isLabel(next) ? next : '';
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => (out += b.toString()));
    child.stderr.on('data', (b: Buffer) => (err += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} stopped (exit code ${code}).`))));
  });
}

/** The real enlarging, with ffmpeg: scaled to fill the frame, then trimmed to exactly its size. */
export const enlarge: Enlarge = async (source, out, width, height) => {
  await run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`, '-frames:v', '1', out]);
};

/** An image's size, read with ffprobe; null if it can't be read. */
export const imageSize: Measure = async (file) => {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    const [width, height] = out.trim().split(',').map(Number);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
};

const pad = (n: number) => String(n).padStart(2, '0');
function today(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}


export interface UseParts { thumbnail: boolean; title: boolean }

/**
 * Puts a draft image (relative to the Video Projects folder, e.g. ".../Packaging/Drafts/ChatGPT 01/05.png") into a
 * version of the same video: its thumbnail, its title, or both. Returns what was done, in words.
 */
export async function useDraft(piece: string, image: string, version: string, parts: UseParts, grow: Enlarge = enlarge, measure: Measure = imageSize): Promise<{ done: string }> {
  if (!piece) throw new Error('No video given.');
  if (!parts.thumbnail && !parts.title) throw new Error('Choose the thumbnail, the title or both.');
  const pieceDir = safeResolve('projects', piece);
  const drafts = path.join(pieceDir, 'Packaging', DRAFTS_FOLDER);
  const draft = safeResolve('projects', image);
  const conversation = path.dirname(draft);
  const round = ROUND_RE.exec(path.basename(draft))?.[1];
  if (!round || path.dirname(conversation).toLowerCase() !== drafts.toLowerCase() || !fs.existsSync(draft)) throw new Error("Choose one of this video's draft images.");
  const dir = versionFolder(piece, version);
  const versionName = path.basename(dir);

  const info = readConversation(conversation);
  const pick: BriefPick | undefined = info?.pick ?? readChoice(path.join(drafts, CHOICE_FILE))?.pick;
  const photo = info?.photo ?? null;
  if (parts.title && !pick) throw new Error("This draft's title isn't known, so only its thumbnail can be used.");
  const conv = path.basename(conversation);
  const notes: string[] = [];

  // Every change is recorded with how to undo it. If a later step fails (Drive offline, a locked file), the finished
  // steps are undone in reverse, so the version is as it was (code review #4). Every path goes through safe-files.ts.
  const undo: { what: string; run: () => void }[] = [];
  const folder = (full: string) => {
    const existed = fs.existsSync(full);
    const made = makeFolder(full);
    if (!existed) undo.push({ what: `the folder ${path.basename(full)}`, run: () => fs.rmdirSync(made) });
    return made;
  };
  const copy = (from: string, to: string, root?: 'projects' | 'expressions') => {
    const target = writable(to);
    if (fs.existsSync(target)) return;
    copyNewFile(from, to, root);
    if (fs.existsSync(target)) undo.push({ what: path.basename(to), run: () => fs.rmSync(target, { force: true }) });
  };
  const write = (file: string, text: string) => {
    const was = fs.existsSync(file) ? readText(file) : null;
    writeFile(file, text);
    undo.push({ what: path.basename(file), run: () => (was === null ? fs.rmSync(writable(file), { force: true }) : writeFile(file, was)) });
  };
  const move = (from: string, to: string) => {
    moveFile(from, to);
    undo.push({ what: path.basename(from), run: () => moveFile(to, from) });
  };
  let fresh: string | null = null;

  try {
    // 1. Getting ready: every place it will write checked, the new image made beside the old one, the new texts worked out.
    let swap: { thumbDir: string; old?: string; backups: string; kept: string } | null = null;
    let sources: (() => void) | null = null;
    if (parts.thumbnail) {
      const thumbDir = folder(path.join(dir, 'Thumbnail'));
      const source = folder(path.join(thumbDir, 'Source'));
      const [width, height] = isShort(piece) ? [2160, 3840] : [3840, 2160];
      const oldNames = fs.readdirSync(thumbDir).filter((f) => /^Thumbnail\.(png|jpe?g)$/i.test(f) && fs.lstatSync(path.join(thumbDir, f)).isFile());
      if (oldNames.length > 1) throw new Error('This version has more than one Thumbnail file. Remove the extra one before replacing it.');
      const old = oldNames[0];
      const backups = writable(path.join(thumbDir, 'Backups'));
      if (old) writable(path.join(thumbDir, old));
      writable(path.join(thumbDir, 'Thumbnail.png'));
      const d = new Date();
      const baseKept = `Replaced ${today(d)} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())} - ${old}`;
      let kept = baseKept;
      if (old) {
        const ext = path.extname(old);
        const stem = baseKept.slice(0, baseKept.length - ext.length);
        for (let n = 2; fs.existsSync(path.join(backups, kept)); n++) kept = `${stem} (${n})${ext}`;
      }
      fresh = writable(path.join(thumbDir, `Thumbnail.new-${crypto.randomUUID()}.png`));
      const made = await measure(draft);
      await grow(draft, fresh, width, height);
      swap = { thumbDir, old, backups, kept };
      sources = () => {
        copy(draft, path.join(source, `Draft - ${conv} round ${round}${path.extname(draft).toLowerCase()}`));
        if (photo) {
          const full = resolveExpressionPhoto(photo);
          copy(full, path.join(source, `Photo - ${path.basename(full)}`), photo.startsWith('project:') ? 'projects' : 'expressions');
        }
        copy(path.join(drafts, 'Brief.md'), path.join(source, 'Brief.md'));
        copy(path.join(conversation, 'Requests.md'), path.join(source, `Requests - ${conv}.md`));
        const refs = readable(path.join(conversation, 'References'));
        if (fs.existsSync(refs)) {
          const keptRefs = folder(path.join(source, `References - ${conv}`));
          for (const f of fs.readdirSync(refs)) if (fs.lstatSync(path.join(refs, f)).isFile()) copy(path.join(refs, f), path.join(keptRefs, f));
        }
        // HeartQuarters' list of what it put in Source, so Clean Up removes only those and never John's own files.
        const manifest = path.join(source, SOURCE_MANIFEST);
        let listed: string[] = [];
        try {
          const old = JSON.parse(readText(manifest)) as unknown;
          if (Array.isArray(old)) listed = old.filter((x): x is string => typeof x === 'string');
        } catch {
          /* none yet */
        }
        const ours = fs.readdirSync(source).filter((name) => madeByHeartQuarters(name) && name !== SOURCE_MANIFEST);
        write(writable(manifest), JSON.stringify([...new Set([...listed, ...ours])].sort(), null, 2) + '\n');
      };
      const ai = info ? AI_NAMES[info.ai] : conv.replace(/ \d+$/, '');
      notes.push(
        `Thumbnail: draft ${conv}, round ${round}, by ${ai}${photo ? `, using the photo ${photo}` : ''}. ` +
          (made ? `Made at ${made.width} x ${made.height}, enlarged to ${width} x ${height}.` : `Enlarged to ${width} x ${height}.`),
      );
      if (old) notes.push(`The thumbnail before is kept as Thumbnail\\Backups\\${kept}.`);
    }

    let youtube: { file: string; text: string } | null = null;
    if (pick) {
      const ytName = fs.readdirSync(dir).find((f) => f.toLowerCase() === 'youtube.md') ?? 'YouTube.md';
      const ytFile = writable(path.join(dir, ytName));
      let text = fs.existsSync(ytFile) ? readText(ytFile) : '# YouTube Info\n\nTitle:\n';
      if (parts.title) {
        const before = getField(text, 'Title');
        text = setField(text, 'Title', pick.title);
        notes.push(before && before !== pick.title ? `Title: "${pick.title}" (it was "${before}").` : `Title: "${pick.title}".`);
      }
      if (parts.thumbnail) {
        text = setField(text, 'Thumbnail text', pick.thumbnailText.toUpperCase());
        text = setField(text, 'Thumbnail idea', `${pick.expression}. ${pick.background}`);
      }
      youtube = { file: ytFile, text: text.endsWith('\n') ? text : text + '\n' };
    }

    // Notes.md: what was used, added at the end.
    const notesName = fs.readdirSync(dir).find((f) => f.toLowerCase() === NOTES_FILE.toLowerCase()) ?? NOTES_FILE;
    const notesFile = writable(path.join(dir, notesName));
    const notesBefore = fs.existsSync(notesFile) ? readText(notesFile) : '';
    const eol = notesBefore.includes('\r\n') ? '\r\n' : '\n';
    const entry = [`${today()}: used from the drafts.`, ...notes].join(eol);
    const notesText = notesBefore.trim() ? `${notesBefore.replace(/\s+$/, '')}${eol}${eol}${entry}${eol}` : `${entry}${eol}`;

    // 2. The changes, each one undoable: the sources, YouTube.md, the thumbnail swap, then Notes.md.
    sources?.();
    if (youtube) write(youtube.file, youtube.text);
    if (swap) {
      if (swap.old) move(path.join(swap.thumbDir, swap.old), path.join(folder(swap.backups), swap.kept));
      // The new image goes in last; undoing it removes it (the old one comes back from Backups after).
      const installed = path.join(swap.thumbDir, 'Thumbnail.png');
      moveFile(fresh!, installed);
      fresh = null;
      undo.push({ what: 'the new Thumbnail.png', run: () => fs.rmSync(writable(installed), { force: true }) });
    }
    write(notesFile, notesText);
  } catch (e) {
    if (fresh) fs.rmSync(fresh, { force: true });
    const stuck: string[] = [];
    for (const step of undo.reverse()) {
      try {
        step.run();
      } catch {
        stuck.push(step.what);
      }
    }
    const why = e instanceof Error ? e.message : String(e);
    if (!undo.length) throw e;
    throw new Error(stuck.length ? `${why} Some changes couldn't be put back: ${stuck.join(', ')}. Check ${versionName}.` : `${why} Nothing was changed: what was done so far was put back.`);
  }

  const what = parts.thumbnail && parts.title ? 'thumbnail and title' : parts.thumbnail ? 'thumbnail' : 'title';
  return { done: `${versionName} now uses this ${what}.` };
}
