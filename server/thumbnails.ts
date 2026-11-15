// Make Thumbnail: ChatGPT (through Codex) or Gemini (through Antigravity) makes a thumbnail from the pair and photo
// John chose (Packaging\Drafts\Choice.json), following the thumbnails-and-titles skill. Each go is one AI
// conversation, saved as its own folder in Drafts ("ChatGPT 01", "Gemini 01"...): its images in order (01.png,
// 02.png...), what was asked (Requests.md), and the conversation's id (Conversation.json), so John's change requests
// ("make the text bigger") go to the same conversation, which still has the photo and the earlier image.
// The AI makes the image in a work folder of the app's own; HeartQuarters copies it into Drafts. Nothing is overwritten.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, aiCommand, type AiId } from './ai.js';
import { appDir, config, safeResolve } from './config.js';
import { resolveExpressionPhoto } from './expression-photo-path.js';
import { CHOICE_FILE, DRAFTS_FOLDER, readChoice, type BriefChoice } from './projects.js';

export type ImageAi = Extract<AiId, 'codex' | 'gemini'>;

export interface ThumbJob {
  /** The conversation folder, relative to the Video Projects folder. */
  conversation: string;
  ai: ImageAi;
  state: 'working' | 'done' | 'failed';
  error?: string;
}

/** What an image AI sends back: where it saved the image, and the conversation's id for later changes. */
export interface ImageAnswer {
  image: string;
  session: string;
}

/**
 * Runs one image request. `session` continues that conversation; `photo` is attached on the first request only;
 * `refs` are reference images John added to a change request. Real AIs in makeImage; tests pass a fake.
 */
export type MakeImage = (ai: ImageAi, prompt: string, cwd: string, out: string, opts: { session?: string; photo?: string; refs?: string[] }) => Promise<ImageAnswer>;

/** Reference images for a change request: pasted or dropped ones (base64), and drafts of this video (paths). */
export interface ChangeRefs {
  pasted?: unknown;
  drafts?: unknown;
}

/** Conversation.json: which AI, its conversation id, the photo, and the pair it was made for (drafts made before the pair was saved here have none). */
export interface ConversationInfo {
  ai: ImageAi;
  session: string;
  photo: string;
  pick?: BriefChoice['pick'];
}

/** A draft's Conversation.json, or null if it has none (made by hand) or it can't be read. */
export function readConversation(folder: string): ConversationInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(folder, CONVERSATION_FILE), 'utf8')) as ConversationInfo;
    return info.ai === 'codex' || info.ai === 'gemini' ? info : null;
  } catch {
    return null;
  }
}

const CONVERSATION_FILE = 'Conversation.json';
/** Inside a conversation folder: the reference images John added to his change requests. */
const REFERENCES_FOLDER = 'References';
const MAX_REFS = 4;
const MAX_REF_BYTES = 15_000_000;
const REQUESTS_FILE = 'Requests.md';
const ONE_RUN_MS = 15 * 60 * 1000;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

function rel(full: string): string {
  return path.relative(config.videoProjectsDir, full).split(path.sep).join('/');
}

function draftsFolder(piece: string): string {
  if (!piece) throw new Error('No video given.');
  const dir = safeResolve('projects', piece);
  if (!fs.existsSync(path.join(dir, 'Packaging'))) throw new Error(`"${piece}" has no Packaging folder.`);
  return path.join(dir, 'Packaging', DRAFTS_FOLDER);
}

/** A Short's cover is portrait; everything else is a 16:9 longform thumbnail. */
export function isShort(piece: string): boolean {
  return /(^|\/)Shorts\//i.test(piece) || /^999 - Shorts\//i.test(piece);
}

function skillFile(name: string): string {
  return path.join(config.skillsDir, 'HMF_Skills', name, 'SKILL.md');
}

// ---- What the AI is asked ---------------------------------------------------------------------------------

export function firstRequest(choice: BriefChoice, short: boolean, out: string): string {
  const p = choice.pick;
  return [
    'Make a YouTube thumbnail for the Heart Mind Fusion channel. Use your built-in image generation tool to make the image (not code).',
    `First read the skill "${skillFile('thumbnails-and-titles')}": follow its hard rules, "How John's thumbnails look" and "John's face".`,
    'THE IDENTITY REFERENCE: the attached photo is the creator, John. Keep his exact face: grey hair, goatee, face shape, skin texture, age. ' +
      "Don't beautify, smooth or make him younger. Keep his expression from the photo. Replace the background.",
    [
      'THE BRIEF:',
      `- The video's title: "${p.title}"`,
      `- Thumbnail text, exactly: ${p.thumbnailText.toUpperCase()}${p.accent ? ` (accent colour on ${p.accent.toUpperCase()}; the other words white)` : ''}. Tall, condensed, heavy sans-serif, all caps.`,
      `- Expression: ${p.expression}`,
      `- Background and supporting image: ${p.background}`,
      `- Why it should work: ${p.why}`,
      short
        ? '- Layout: portrait. Keep all text out of the top tenth (the Shorts feed crops it off) and the bottom fifth, and away from the right edge, where the app\'s buttons are.'
        : "- Layout: John on one side, the text on the other. He looks at the camera or toward the text, never away out of the frame. Nothing important in the bottom-right corner, where YouTube shows the video's length.",
      '- It must read at phone size: big face, big words.',
    ].join('\n'),
    `FORMAT: ${short ? '9:16 portrait' : '16:9'}, as large as your tool can make it, PNG. Don't enlarge it with code; HeartQuarters does that later.`,
    `Save the image in the current folder as ${out} and reply with its full path.`,
  ].join('\n\n');
}

export function changeRequest(text: string, out: string, refs: string[] = []): string {
  return [
    `Change request from John for the thumbnail you made last in this conversation: ${text.trim()}`,
    ...(refs.length
      ? [
          `John added ${refs.length === 1 ? 'a reference image' : `${refs.length} reference images`} to show what he means (attached, and saved at: ${refs.join('; ')}). ` +
            "Use it only as a reference for what he describes, such as how an object looks; it doesn't replace his face or the thumbnail's text.",
        ]
      : []),
    "Keep everything else the same, especially his face and likeness, unless he asks otherwise. Use your image tool to edit the image (not code).",
    `Save the result at the size the tool makes, without enlarging it with code, in the current folder as ${out}, and reply with its full path.`,
  ].join('\n\n');
}

// ---- Running the AIs --------------------------------------------------------------------------------------

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err = (err + c).slice(-2000)));
    const timer = setTimeout(() => child.kill(), ONE_RUN_MS);
    child.on('error', (e) => reject(new Error(`Couldn't start it: ${e.message}`)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `It stopped (exit code ${code}).`));
    });
  });
}

/** The newest image in a folder made after `since` (so an old image is never taken for a new one), or null. */
function newestImage(dir: string, since: number): string | null {
  try {
    const images = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_RE.test(f))
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(f).mtimeMs >= since - 2000);
    return images.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
  } catch {
    return null;
  }
}

/** The id an AI's JSON lines give for the conversation: Codex's thread_id, Antigravity's conversation_id. */
export function sessionFrom(output: string, key: 'thread_id' | 'conversation_id'): string {
  for (const line of output.split(/\r?\n/)) {
    try {
      const value = (JSON.parse(line) as Record<string, unknown>)[key];
      if (typeof value === 'string' && value) return value;
    } catch {
      /* not a JSON line */
    }
  }
  return '';
}

export const makeImage: MakeImage = async (ai, prompt, cwd, out, { session, photo, refs }) => {
  const [cmd, ...pre] = aiCommand(ai);
  const saved = path.join(cwd, out);
  const started = Date.now();
  if (ai === 'codex') {
    const images = [...(photo ? [photo] : []), ...(refs ?? [])];
    const args = ['exec', ...(session ? ['resume', session] : []), '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', prompt, ...images.flatMap((i) => ['-i', i])];
    const output = await run(cmd, [...pre, ...args], cwd);
    const id = session || sessionFrom(output, 'thread_id');
    // If it didn't save where asked, the image tool keeps its own copy.
    const image = fs.existsSync(saved) ? saved : newestImage(path.join(os.homedir(), '.codex', 'generated_images', id), started);
    if (!image) throw new Error("ChatGPT finished but didn't make an image.");
    return { image, session: id };
  }
  const settings = { toolPermission: 'proceed-in-sandbox', enableTerminalSandbox: true, permissions: { allow: ['read_file(*)'] } };
  const said = photo ? `${prompt}\n\nThe photo is at: ${photo}` : prompt;
  const args = ['-p', said, '--output-format', 'stream-json', ...(session ? ['--conversation', session] : []), '--sandbox', '--add-dir', cwd, ...(photo ? ['--add-dir', path.dirname(photo)] : []), ...(refs?.length ? ['--add-dir', path.dirname(refs[0])] : []), '--settings', JSON.stringify(settings), '--print-timeout', '900s'];
  const output = await run(cmd, [...pre, ...args], cwd);
  const id = session || sessionFrom(output, 'conversation_id');
  // Antigravity can't save outside its own folder in a sandbox, so the image is taken from there.
  const image = fs.existsSync(saved) ? saved : newestImage(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', id), started);
  if (!image) throw new Error("Gemini finished but didn't make an image.");
  return { image, session: id };
};

// ---- Conversations in Drafts ---------------------------------------------------------------------------

const jobs = new Map<string, ThumbJob>();

/** The thumbnails being made, or made since the engine started, for one piece. */
export function thumbJobs(piece: string): ThumbJob[] {
  const prefix = rel(draftsFolder(piece)) + '/';
  return [...jobs.values()].filter((j) => j.conversation.startsWith(prefix));
}

/** The next conversation folder for an AI: "ChatGPT 03" after "ChatGPT 02". */
export function nextConversationName(drafts: string, ai: ImageAi): string {
  const name = AI_NAMES[ai];
  let n = 0;
  try {
    for (const f of fs.readdirSync(drafts)) {
      const m = new RegExp(`^${name} (\\d+)$`, 'i').exec(f);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {
    /* no Drafts folder yet */
  }
  return `${name} ${String(n + 1).padStart(2, '0')}`;
}

function nextImageName(folder: string): string {
  const n = fs.readdirSync(folder).filter((f) => /^\d+\.(png|jpe?g|webp)$/i.test(f)).length;
  return `${String(n + 1).padStart(2, '0')}.png`;
}

function workFolder(name: string): string {
  const root = process.env.VITEST ? path.join(os.tmpdir(), 'hq-thumb-tests') : path.join(appDir, 'data', 'thumbnails');
  const dir = path.join(root, `${Date.now()}-${name.replace(/[^A-Za-z0-9]+/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs one request in the background and records it as a job; `finished` settles when it's done. */
function runJob(folder: string, ai: ImageAi, work: (job: ThumbJob) => Promise<void>): { job: ThumbJob; finished: Promise<void> } {
  const key = rel(folder);
  if (jobs.get(key)?.state === 'working') throw new Error(`${AI_NAMES[ai]} is still working on this one.`);
  const job: ThumbJob = { conversation: key, ai, state: 'working' };
  jobs.set(key, job);
  const finished = work(job).then(
    () => {
      job.state = 'done';
    },
    (e: unknown) => {
      job.state = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
    },
  );
  return { job, finished };
}

/** Make Thumbnail: a new conversation with `ai`, from the chosen pair and photo. */
export function startThumbnail(piece: string, ai: unknown, make: MakeImage = makeImage): { job: ThumbJob; finished: Promise<void> } {
  if (ai !== 'codex' && ai !== 'gemini') throw new Error('Choose ChatGPT or Gemini to make the thumbnail.');
  const drafts = draftsFolder(piece);
  const choice = readChoice(path.join(drafts, CHOICE_FILE));
  if (!choice) throw new Error('Choose one of the top 3 pairs first.');
  if (!choice.photo) throw new Error('Pick a photo for the pair first.');
  const photo = resolveExpressionPhoto(choice.photo);
  if (!fs.existsSync(photo)) throw new Error(`The photo ${choice.photo} isn't in the expressions library any more.`);
  const name = nextConversationName(drafts, ai);
  const folder = path.join(drafts, name);
  fs.mkdirSync(folder, { recursive: true }); // made now, so a second click gets the next number
  const prompt = firstRequest(choice, isShort(piece), '01.png');
  fs.writeFileSync(
    path.join(folder, REQUESTS_FILE),
    `# ${name}\n\nPair: ${choice.pick.thumbnailText} / ${choice.pick.title}\n\nPhoto: ${choice.photo}\n\n## 01\n\n${prompt}\n`,
  );
  return runJob(folder, ai, async () => {
    const work = workFolder(name);
    const answer = await make(ai, prompt, work, '01.png', { photo });
    fs.copyFileSync(answer.image, path.join(folder, '01.png'));
    const info: ConversationInfo = { ai, session: answer.session, photo: choice.photo!, pick: choice.pick };
    fs.writeFileSync(path.join(folder, CONVERSATION_FILE), JSON.stringify(info, null, 2) + '\n');
  });
}

/** A pasted image, checked: a PNG, JPEG or WebP up to 15 MB. Returns its bytes and file extension. */
export function decodeReference(value: unknown): { data: Buffer; ext: string } {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_REF_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('A reference image could not be read. Paste a PNG, JPEG or WebP up to 15 MB.');
  }
  const data = Buffer.from(value, 'base64');
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { data, ext: '.png' };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { data, ext: '.jpg' };
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return { data, ext: '.webp' };
  throw new Error('A reference image must be a PNG, JPEG or WebP.');
}

/**
 * Saves a change request's reference images in the conversation's References folder, named after the image they're
 * for ("02 - 1.png"), and returns their full paths. Drafts may only be images from this video's own Drafts.
 */
export function saveReferences(drafts: string, folder: string, forImage: string, refs: ChangeRefs): string[] {
  const pasted = Array.isArray(refs.pasted) ? refs.pasted : [];
  const fromDrafts = Array.isArray(refs.drafts) ? refs.drafts : [];
  if (pasted.length + fromDrafts.length > MAX_REFS) throw new Error(`Add at most ${MAX_REFS} reference images.`);
  const sources: { data: Buffer; ext: string }[] = pasted.map(decodeReference);
  for (const d of fromDrafts) {
    const full = safeResolve('projects', String(d));
    const inDrafts = full.toLowerCase().startsWith(drafts.toLowerCase() + path.sep);
    if (!inDrafts || !IMAGE_RE.test(full) || !fs.existsSync(full)) throw new Error("A reference must be one of this video's draft images.");
    sources.push({ data: fs.readFileSync(full), ext: path.extname(full).toLowerCase() });
  }
  if (!sources.length) return [];
  const dir = path.join(folder, REFERENCES_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return sources.map((r) => {
    let file: string;
    do file = path.join(dir, `${forImage} - ${++n}${r.ext}`);
    while (fs.existsSync(file)); // a retry after a failed request keeps the earlier references
    fs.writeFileSync(file, r.data, { flag: 'wx' }); // never over an earlier reference
    return file;
  });
}

/** A change request: the same conversation edits its last image, saved as the next number. */
export function changeThumbnail(piece: string, conversation: string, text: unknown, make: MakeImage = makeImage, refs: ChangeRefs = {}): { job: ThumbJob; finished: Promise<void> } {
  const request = String(text ?? '').trim();
  if (!request) throw new Error('Say what to change.');
  const drafts = draftsFolder(piece);
  const folder = safeResolve('projects', conversation);
  if (path.dirname(folder).toLowerCase() !== drafts.toLowerCase()) throw new Error("That isn't one of this video's drafts.");
  const running = jobs.get(rel(folder));
  if (running?.state === 'working') throw new Error(`${AI_NAMES[running.ai]} is still working on this one.`);
  let info: ConversationInfo;
  try {
    info = JSON.parse(fs.readFileSync(path.join(folder, CONVERSATION_FILE), 'utf8')) as ConversationInfo;
  } catch {
    throw new Error("This draft wasn't made by Make Thumbnail, so there's no conversation to continue. Make a new one.");
  }
  if (!info.session) throw new Error('The AI gave no conversation to continue. Make a new one.');
  const out = nextImageName(folder);
  const number = out.replace(/\.png$/, '');
  const saved = saveReferences(drafts, folder, number, refs);
  const prompt = changeRequest(request, out, saved);
  return runJob(folder, info.ai, async () => {
    const work = workFolder(path.basename(folder));
    const answer = await make(info.ai, prompt, work, out, { session: info.session, refs: saved });
    fs.copyFileSync(answer.image, path.join(folder, out));
    const refNote = saved.length ? `\n\nReference images: ${saved.map((f) => `${REFERENCES_FOLDER}/${path.basename(f)}`).join(', ')}` : '';
    fs.appendFileSync(path.join(folder, REQUESTS_FILE), `\n## ${number} (change request from John)\n\n${request}${refNote}\n`);
  });
}
