// Make Thumbnail: ChatGPT (through Codex) or Gemini (through Antigravity) makes a thumbnail from the pair and photo
// John chose (Packaging\Drafts\Choice.json), following the thumbnails-and-titles skill. Each go is one AI
// conversation, saved as its own folder in Drafts ("ChatGPT 01", "Gemini 01"...): its images in order (01.png,
// 02.png...), what was asked (Requests.md), and the conversation's id (Conversation.json), so John's change requests
// ("make the text bigger") go to the same conversation, which still has the photo and the earlier image.
// The AI makes the image in a work folder of the app's own; HeartQuarters copies it into Drafts. Nothing is overwritten.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, CODEX_STANDARD_TIER, aiCommand, aiModelArgs, runAiProcess, type AiId } from './ai.js';
import { appDir, config, safeResolve } from './config.js';
import { resolveExpressionPhoto } from './expression-photo-path.js';
import { CHOICE_FILE, DRAFTS_FOLDER, readChoice, type BriefChoice } from './projects.js';
import { appendText, makeFolder, writable, writeFile } from './safe-files.js';

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

/**
 * Reference images for a change request: pasted or dropped ones (base64), and drafts of this video (paths). `photo`:
 * also send the photo of John chosen now (Choice.json), as the new identity reference.
 */
export interface ChangeRefs {
  pasted?: unknown;
  drafts?: unknown;
  photo?: unknown;
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

export function changeRequest(text: string, out: string, refs: string[] = [], newPhoto?: string): string {
  return [
    `Change request from John for the thumbnail you made last in this conversation: ${text.trim()}`,
    ...(newPhoto
      ? [
          `John chose a new photo of himself for it (attached, and saved at: ${newPhoto}). From now on it is THE IDENTITY REFERENCE: ` +
            "take his face and expression from this photo, keeping his exact likeness (grey hair, goatee, face shape, skin texture, age; don't beautify, smooth or make him younger). Keep the text, layout and background unless he asks otherwise.",
        ]
      : []),
    ...(refs.length
      ? [
          `John added ${refs.length === 1 ? 'a reference image' : `${refs.length} reference images`} to show what he means (attached, and saved at: ${refs.join('; ')}). ` +
            "Use it only as a reference for what he describes, such as how an object looks; it doesn't replace his face or the thumbnail's text.",
        ]
      : []),
    newPhoto
      ? 'Keep everything else the same unless he asks otherwise. Use your image tool to make the image (not code).'
      : "Keep everything else the same, especially his face and likeness, unless he asks otherwise. Use your image tool to edit the image (not code).",
    `Save the result at the size the tool makes, without enlarging it with code, in the current folder as ${out}, and reply with its full path.`,
  ].join('\n\n');
}

// ---- Running the AIs --------------------------------------------------------------------------------------

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  const res = await runAiProcess(cmd, args, { cwd, timeoutMs: ONE_RUN_MS });
  if (res.startError) throw new Error(`Couldn't start it: ${res.startError}`);
  if (res.code === 0) return res.stdout;
  if (res.timedOut) throw new Error('It timed out before finishing.');
  throw new Error(res.stderr.trim().split('\n').slice(-3).join(' ') || `It stopped (exit code ${res.code}).`);
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

/**
 * The AI's last words in its JSON lines (Codex's agent messages, Antigravity's assistant messages), so that when it
 * makes no image John sees why, such as a question it asked. Empty when there are none.
 */
export function lastReply(output: string): string {
  let last = '';
  const text = (v: unknown): string =>
    typeof v === 'string' ? v : Array.isArray(v) ? v.map((c) => (typeof c === 'string' ? c : typeof (c as { text?: unknown })?.text === 'string' ? (c as { text: string }).text : '')).join('') : '';
  for (const line of output.split(/\r?\n/)) {
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const said =
      (event.item?.type === 'agent_message' && text(event.item.text)) ||
      (event.msg?.type === 'agent_message' && text(event.msg.message)) ||
      text(event.last_agent_message) ||
      ((event.role === 'assistant' || event.type === 'assistant') && (text(event.content) || text(event.text) || text(event.message?.content)));
    if (said && said.trim()) last = said.trim();
  }
  return last;
}

/** The error when an AI finished without an image: what it said, if anything. */
export function noImageError(name: string, output: string): Error {
  const said = lastReply(output);
  return new Error(said ? `${name} didn't make an image. It said: "${said.length > 600 ? `${said.slice(0, 600)}…` : said}"` : `${name} finished but didn't make an image.`);
}

/** Tell Gemini about each image and allow it to read each image's folder. */
export function geminiImageArgs(prompt: string, cwd: string, opts: { session?: string; photo?: string; refs?: string[] }): string[] {
  const { session, photo, refs = [] } = opts;
  const settings = { toolPermission: 'proceed-in-sandbox', enableTerminalSandbox: true, permissions: { allow: ['read_file(*)'] } };
  const images = [...(photo ? [photo] : []), ...refs];
  const said = images.length ? `${prompt}\n\nReference image files:\n${images.map((file) => `- ${file}`).join('\n')}` : prompt;
  const dirs = [...new Set([cwd, ...images.map((file) => path.dirname(file))])];
  return ['-p', said, '--output-format', 'stream-json', ...(session ? ['--conversation', session] : []), ...aiModelArgs('gemini'), '--sandbox', ...dirs.flatMap((dir) => ['--add-dir', dir]), '--settings', JSON.stringify(settings), '--print-timeout', '900s'];
}

export const makeImage: MakeImage = async (ai, prompt, cwd, out, { session, photo, refs }) => {
  const [cmd, ...pre] = aiCommand(ai);
  const saved = path.join(cwd, out);
  const started = Date.now();
  if (ai === 'codex') {
    const images = [...(photo ? [photo] : []), ...(refs ?? [])];
    const args = ['exec', ...(session ? ['resume', session] : []), '--json', '--skip-git-repo-check', ...CODEX_STANDARD_TIER, ...aiModelArgs('codex'), '-c', 'sandbox_mode="workspace-write"', prompt, ...images.flatMap((i) => ['-i', i])];
    const output = await run(cmd, [...pre, ...args], cwd);
    const id = session || sessionFrom(output, 'thread_id');
    // If it didn't save where asked, the image tool keeps its own copy.
    const image = fs.existsSync(saved) ? saved : newestImage(path.join(os.homedir(), '.codex', 'generated_images', id), started);
    if (!image) throw noImageError('ChatGPT', output);
    return { image, session: id };
  }
  const args = geminiImageArgs(prompt, cwd, { session, photo, refs });
  const output = await run(cmd, [...pre, ...args], cwd);
  const id = session || sessionFrom(output, 'conversation_id');
  // Antigravity can't save outside its own folder in a sandbox, so the image is taken from there.
  const image = fs.existsSync(saved) ? saved : id ? newestImage(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', id), started) : null;
  if (!image) throw noImageError('Gemini', output);
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
  const numbers = fs
    .readdirSync(folder)
    .map((f) => f.match(/^(\d+)\.(png|jpe?g|webp)$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => Number(m[1]));
  return `${String(Math.max(0, ...numbers) + 1).padStart(2, '0')}.png`;
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
  const folder = makeFolder(path.join(drafts, name)); // made now, so a second click gets the next number
  const prompt = firstRequest(choice, isShort(piece), '01.png');
  writeFile(
    path.join(folder, REQUESTS_FILE),
    `# ${name}\n\nPair: ${choice.pick.thumbnailText} / ${choice.pick.title}\n\nPhoto: ${choice.photo}\n\n## 01\n\n${prompt}\n`,
  );
  return runJob(folder, ai, async () => {
    const work = workFolder(name);
    try {
      const answer = await make(ai, prompt, work, '01.png', { photo });
      fs.copyFileSync(answer.image, writable(path.join(folder, '01.png')), fs.constants.COPYFILE_EXCL);
      const info: ConversationInfo = { ai, session: answer.session, photo: choice.photo!, pick: choice.pick };
      writeFile(path.join(folder, CONVERSATION_FILE), JSON.stringify(info, null, 2) + '\n');
    } finally {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore busy temp cleanup */ }
    }
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
  const dir = makeFolder(path.join(folder, REFERENCES_FOLDER));
  let n = 0;
  return sources.map((r) => {
    let file: string;
    do file = path.join(dir, `${forImage} - ${++n}${r.ext}`);
    while (fs.existsSync(file)); // a retry after a failed request keeps the earlier references
    writeFile(file, r.data, { flag: 'wx' }); // never over an earlier reference
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
  // The photo of John chosen now, when he asked for it to be sent: it becomes the conversation's photo.
  let newPhoto: { name: string; full: string } | null = null;
  if (refs.photo === true) {
    const chosen = readChoice(path.join(drafts, CHOICE_FILE))?.photo;
    if (!chosen) throw new Error('No photo is chosen for the pair. Pick one first.');
    const full = resolveExpressionPhoto(chosen);
    if (!fs.existsSync(full)) throw new Error(`The photo ${chosen} isn't in the expressions library any more.`);
    newPhoto = { name: chosen, full };
  }
  const out = nextImageName(folder);
  const number = out.replace(/\.png$/, '');
  const saved = saveReferences(drafts, folder, number, refs);
  const prompt = changeRequest(request, out, saved, newPhoto?.full);
  return runJob(folder, info.ai, async () => {
    const work = workFolder(path.basename(folder));
    try {
      const answer = await make(info.ai, prompt, work, out, { session: info.session, refs: saved, ...(newPhoto ? { photo: newPhoto.full } : {}) });
      fs.copyFileSync(answer.image, writable(path.join(folder, out)), fs.constants.COPYFILE_EXCL);
      const refNote = saved.length ? `\n\nReference images: ${saved.map((f) => `${REFERENCES_FOLDER}/${path.basename(f)}`).join(', ')}` : '';
      const photoNote = newPhoto ? `\n\nNew photo: ${newPhoto.name}` : '';
      appendText(path.join(folder, REQUESTS_FILE), `\n## ${number} (change request from John)\n\n${request}${photoNote}${refNote}\n`);
      if (newPhoto) writeFile(path.join(folder, CONVERSATION_FILE), JSON.stringify({ ...info, photo: newPhoto.name }, null, 2) + '\n');
    } finally {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore busy temp cleanup */ }
    }
  });
}
