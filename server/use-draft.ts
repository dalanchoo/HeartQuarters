// Make Version: turns the draft round John likes (e.g. Drafts\ChatGPT 01\05.png) into the next packaging version
// (V02, V03...), the way the thumbnails-and-titles skill describes:
//   YouTube.md   a copy of the newest version's (or the template's, if there's none), with the pair's title and
//                thumbnail text filled in, so description, tags and settings carry over
//   Thumbnail\Thumbnail.png          the draft enlarged to YouTube's full size (3840 x 2160, or 2160 x 3840 for a Short)
//   Thumbnail\Source\                the draft as made, the photo, the brief, the requests and their reference images
//   Notes.md     where it came from, and "On YouTube: not yet."
// Only a new version folder is made: nothing that exists is changed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, safeResolve } from './config.js';
import { nextVersionName } from './packaging-version.js';
import { CHOICE_FILE, DRAFTS_FOLDER, NOTES_FILE, readChoice, type BriefPick } from './projects.js';
import { isShort, readConversation } from './thumbnails.js';
import { AI_NAMES } from './ai.js';

/** Makes `out` from `source` at exactly width x height (filling the frame, trimming any sliver). Tests pass a fake. */
export type Enlarge = (source: string, out: string, width: number, height: number) => Promise<void>;

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

/** The newest version's YouTube.md, or the template's when the piece has no version with one yet. */
function startingYoutubeMd(pieceDir: string, piece: string): string {
  const packaging = path.join(pieceDir, 'Packaging');
  const versions = fs
    .readdirSync(packaging)
    .filter((d) => /^V\d+$/i.test(d))
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  for (const v of versions) {
    const file = fs.readdirSync(path.join(packaging, v)).find((f) => f.toLowerCase() === 'youtube.md');
    if (file) return fs.readFileSync(path.join(packaging, v, file), 'utf8');
  }
  const template = path.join(config.videoProjectsDir, isShort(piece) ? '--- SHORTS TEMPLATE' : '--- LONGFORM TEMPLATE', 'Packaging', 'V01', 'YouTube.md');
  return fs.existsSync(template) ? fs.readFileSync(template, 'utf8') : '# YouTube Info\n\nTitle:\n';
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
export async function imageSize(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    const [width, height] = out.trim().split(',').map(Number);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Make Version from one draft image (relative to the Video Projects folder), e.g.
 * "005 - .../Longform/Packaging/Drafts/ChatGPT 01/05.png". Returns the new version's name and path.
 */
export async function makeVersionFromDraft(
  piece: string,
  image: string,
  grow: Enlarge = enlarge,
  measure: (file: string) => Promise<{ width: number; height: number } | null> = imageSize,
): Promise<{ name: string; path: string }> {
  if (!piece) throw new Error('No video given.');
  const pieceDir = safeResolve('projects', piece);
  const drafts = path.join(pieceDir, 'Packaging', DRAFTS_FOLDER);
  const draft = safeResolve('projects', image);
  const conversation = path.dirname(draft);
  const round = ROUND_RE.exec(path.basename(draft))?.[1];
  if (!round || path.dirname(conversation).toLowerCase() !== drafts.toLowerCase() || !fs.existsSync(draft)) {
    throw new Error("Choose one of this video's draft images.");
  }
  const info = readConversation(conversation);
  const choice = readChoice(path.join(drafts, CHOICE_FILE));
  const pick: BriefPick | undefined = info?.pick ?? choice?.pick;
  const photo = info?.photo ?? choice?.photo ?? null;
  const short = isShort(piece);
  const [width, height] = short ? [2160, 3840] : [3840, 2160];

  const name = nextVersionName(piece);
  const version = path.join(pieceDir, 'Packaging', name);
  fs.mkdirSync(version); // fails if it somehow exists: nothing is replaced
  try {
    return await fillVersion();
  } catch (e) {
    fs.rmSync(version, { recursive: true, force: true }); // only the folder made just now, half-filled
    throw e;
  }

  async function fillVersion(): Promise<{ name: string; path: string }> {
  const thumbDir = path.join(version, 'Thumbnail');
  const source = path.join(thumbDir, 'Source');
  fs.mkdirSync(source, { recursive: true });

  // The thumbnail at full size, and where it came from.
  const conv = path.basename(conversation);
  const made = await measure(draft);
  await grow(draft, path.join(thumbDir, 'Thumbnail.png'), width, height);
  fs.copyFileSync(draft, path.join(source, `Draft - ${conv} round ${round}${path.extname(draft).toLowerCase()}`));
  if (photo) {
    const full = safeResolve('expressions', photo);
    if (fs.existsSync(full)) fs.copyFileSync(full, path.join(source, `Photo - ${path.basename(full)}`));
  }
  for (const f of ['Brief.md']) if (fs.existsSync(path.join(drafts, f))) fs.copyFileSync(path.join(drafts, f), path.join(source, f));
  if (fs.existsSync(path.join(conversation, 'Requests.md'))) fs.copyFileSync(path.join(conversation, 'Requests.md'), path.join(source, 'Requests.md'));
  const refs = path.join(conversation, 'References');
  if (fs.existsSync(refs)) fs.cpSync(refs, path.join(source, 'References'), { recursive: true, errorOnExist: true, force: false });

  // YouTube.md: everything carries over; the pair's title and thumbnail text go in.
  let youtube = startingYoutubeMd(pieceDir, piece);
  if (pick) {
    youtube = setField(youtube, 'Title', pick.title);
    youtube = setField(youtube, 'Thumbnail text', pick.thumbnailText.toUpperCase());
    youtube = setField(youtube, 'Thumbnail idea', `${pick.expression}. ${pick.background}`);
  }
  fs.writeFileSync(path.join(version, 'YouTube.md'), youtube.endsWith('\n') ? youtube : youtube + '\n');

  const ai = info ? AI_NAMES[info.ai] : conv.replace(/ \d+$/, '');
  fs.writeFileSync(
    path.join(version, NOTES_FILE),
    [
      `Made with Make Version from draft ${conv}, round ${round}, on ${today()}.`,
      '',
      `Thumbnail by ${ai}${pick ? ` for the pair "${pick.thumbnailText.toUpperCase()}" / "${pick.title}"` : ''}${photo ? `, using the photo ${photo}` : ''}.`,
      made ? `The image was made at ${made.width} x ${made.height} and enlarged to ${width} x ${height}.` : `The image was enlarged to ${width} x ${height}.`,
      '',
      pick ? 'Title: from the chosen pair.' : 'Title: unchanged from the previous version.',
      '',
      'On YouTube: not yet.',
      '',
    ].join('\n'),
  );
  return { name, path: path.relative(config.videoProjectsDir, version).split(path.sep).join('/') };
  }
}
