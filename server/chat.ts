// Full-screen multi-AI chat, stored in Drive under Video Projects\_HeartQuarters\Chat\.
// Any of the three AIs (Claude, ChatGPT, Gemini) can be called on any turn and receives the full thread and all attached files.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import {
  AI_NAMES,
  aiCommand,
  aiModelArgs,
  CODEX_STANDARD_TIER,
  geminiAnswer,
  geminiStdin,
  isAiId,
  runAiProcess,
  type AiId,
} from './ai.js';
import { config, isInside, safeResolve } from './config.js';
import { makeFolder, readable, readText, writable, writeFile } from './safe-files.js';
import { sessionFrom } from './thumbnails.js';

export const CHAT_DIR = '_HeartQuarters/Chat';
export const CHAT_FILES_DIR = '_HeartQuarters/Chat/Files';
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const IMAGES_SENT = 6;
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const BLOCKED_EXTS = new Set(['.lnk', '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi']);
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ChatMessage {
  id: string;
  from: 'john' | AiId;
  text: string;
  at: string;
  files?: string[];
}

export interface ChatThread {
  version: 1;
  messages: ChatMessage[];
}

export interface UploadedChatFile {
  name: string;
  size: number;
}

export type ChatAskResult = string | { text: string; generatedImages?: string[] };
export type AskChatAi = (ai: AiId, prompt: string, cwd: string, images?: string[]) => Promise<ChatAskResult>;

let activeChat = false;

function chatFolder(forWrite: boolean): string {
  const dir = safeResolve('projects', CHAT_DIR);
  if (forWrite) {
    makeFolder(dir);
    return writable(dir);
  }
  return dir;
}

function chatFilesFolder(forWrite: boolean): string {
  const dir = safeResolve('projects', CHAT_FILES_DIR);
  if (forWrite) {
    makeFolder(dir);
    return writable(dir);
  }
  return dir;
}

function chatFile(forWrite: boolean): string {
  const dir = chatFolder(forWrite);
  const file = path.join(dir, 'chat.json');
  return forWrite ? writable(file) : readable(file);
}

function emptyChat(): ChatThread {
  return { version: 1, messages: [] };
}

function validMessage(m: unknown): m is ChatMessage {
  const item = m as ChatMessage;
  return !!item
    && typeof item.id === 'string'
    && (item.from === 'john' || isAiId(item.from))
    && typeof item.text === 'string'
    && typeof item.at === 'string'
    && (item.files === undefined || (Array.isArray(item.files) && item.files.every((f) => typeof f === 'string')));
}

/** Reads the saved full-screen chat thread from Drive, or returns an empty thread if none exists yet. */
export function readChat(): ChatThread {
  const dir = chatFolder(false);
  if (!fs.existsSync(dir)) return emptyChat();
  readable(dir);
  const candidate = path.join(dir, 'chat.json');
  if (!fs.existsSync(candidate)) return emptyChat();
  const raw = readText(chatFile(false));
  let parsed: { version?: unknown; messages?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('The chat file could not be read. Nothing was changed.');
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.messages) || !parsed.messages.every(validMessage)) {
    throw new Error('The chat file has an unexpected format. Nothing was changed.');
  }
  return { version: 1, messages: parsed.messages };
}

function saveChat(data: ChatThread) {
  const file = chatFile(true);
  writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

function cleanFileName(raw: unknown): { stem: string; ext: string } {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Choose a file to attach.');
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const ext = path.extname(base).toLowerCase();
  if (BLOCKED_EXTS.has(ext)) throw new Error(`Files ending in ${ext} cannot be attached.`);
  const stem = path
    .basename(base, ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  const safeStem = !stem || stem === '.' || stem === '..' || RESERVED_NAME.test(stem) ? 'Attachment' : stem;
  return { stem: safeStem, ext };
}

/** Saves an uploaded or pasted file into Drive under Video Projects\_HeartQuarters\Chat\Files\. */
export function uploadChatFile(rawName: unknown, bytes: Buffer): UploadedChatFile {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('The attached file is empty.');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Attached files must be 100 MB or smaller.');

  const { stem, ext } = cleanFileName(rawName);
  const dir = chatFilesFolder(true);
  const existing = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n++})${ext}`;
  }

  const target = writable(safeResolve('projects', path.posix.join(CHAT_FILES_DIR, candidate)));
  writeFile(target, bytes, { flag: 'wx' });
  return { name: candidate, size: bytes.length };
}

/** Checked path to an attached chat file for serving sandboxed in the browser. */
export function chatFilePath(rawName: unknown): string {
  if (typeof rawName !== 'string' || !rawName.trim() || rawName.includes('/') || rawName.includes('\\') || rawName === '.' || rawName === '..') {
    throw new Error('Choose a valid attached file.');
  }
  const full = readable(safeResolve('projects', path.posix.join(CHAT_FILES_DIR, rawName)));
  const stat = fs.lstatSync(full, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('That attached file could not be found.');
  }
  return full;
}

function speakerLabel(from: ChatMessage['from']): string {
  return from === 'john' ? 'John' : AI_NAMES[from];
}

function formatMessageForPrompt(m: Pick<ChatMessage, 'text' | 'files'>): string {
  return m.files?.length ? `${m.text}\n[Attached: ${m.files.join(', ')}]` : m.text;
}

/** Builds the full-context prompt passed to whichever AI John sends the next turn to. */
export function buildChatPrompt(
  history: ChatMessage[],
  nextMessage: string,
  nextFiles: string[],
  ai: AiId,
  allFiles: string[] = [],
  extractedDocx: Record<string, string> = {},
): string {
  const fileLines = allFiles.length
    ? allFiles.map((f, i) => {
      const txt = extractedDocx[f] ? ` (extracted text also saved as ${extractedDocx[f]})` : '';
      return `${i + 1}. ${f}${txt}`;
    }).join('\n')
    : '(none)';
  const thread = history.length
    ? history.map((m) => `[${speakerLabel(m.from)}]\n${formatMessageForPrompt(m)}`).join('\n\n')
    : '(no messages yet)';
  return [
    `You are ${AI_NAMES[ai]}, chatting with John (creator of Heart Mind Fusion) in a shared multi-AI conversation.`,
    'Other AIs (Claude, ChatGPT, or Gemini) may also be part of this conversation. Read the full thread and any attached files in your working folder before answering.',
    'Reply directly in Markdown. If John asks you to draw, generate, or edit an image and you have an image generation tool, use it (do not write code to draw it) and save the image in your current working folder if your sandbox allows.',
    `--- ATTACHED FILES IN YOUR WORKING FOLDER ---\n${fileLines}`,
    `--- CONVERSATION SO FAR ---\n${thread}`,
    `--- JOHN'S NEW MESSAGE ---\n${formatMessageForPrompt({ text: nextMessage, files: nextFiles })}`,
  ].join('\n\n');
}

function newImagesInDir(dir: string, since: number, exclude: Set<string> = new Set()): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()) && !exclude.has(f))
      .map((f) => path.join(dir, f))
      .filter((full) => {
        try {
          const stat = fs.statSync(full);
          return stat.isFile() && stat.mtimeMs >= since - 2000;
        } catch {
          return false;
        }
      })
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  } catch {
    return [];
  }
}

function newestBrainImage(rootDir: string, convId: string, since: number): string[] {
  if (convId) {
    const exact = newImagesInDir(path.join(rootDir, convId), since);
    if (exact.length) return [exact[exact.length - 1]];
  }
  try {
    const recentDirs = fs
      .readdirSync(rootDir)
      .map((d) => path.join(rootDir, d))
      .filter((full) => {
        try {
          const st = fs.statSync(full);
          return st.isDirectory() && st.mtimeMs >= since - 5000;
        } catch {
          return false;
        }
      });
    const all = recentDirs.flatMap((d) => newImagesInDir(d, since));
    if (all.length) {
      all.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
      return [all[all.length - 1]];
    }
  } catch {
    // Ignore missing brain directory.
  }
  return [];
}

/** Finds local image file paths (file:///... or Windows/POSIX paths) mentioned in an AI's Markdown reply. */
export function extractMentionedImages(text: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    let candidate = raw.trim();
    if (candidate.startsWith('file:///')) {
      try {
        candidate = decodeURIComponent(candidate.slice('file:///'.length));
      } catch {
        candidate = candidate.slice('file:///'.length);
      }
    }
    if (!IMAGE_EXTS.has(path.extname(candidate).toLowerCase())) return;
    try {
      const st = fs.statSync(candidate);
      if (st.isFile() && !found.includes(candidate)) found.push(candidate);
    } catch {
      // Not an existing local file.
    }
  };
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1]);
  for (const m of text.matchAll(/(?:file:\/\/\/|[A-Za-z]:[\\/])[^\s)"'<>]+\.(?:png|jpe?g|webp|gif)/gi)) add(m[0]);
  return found;
}

/** Rewrites local file:/// or disk paths in an AI's Markdown reply to HeartQuarters' /api/chat/file URL. */
export function rewriteImageLinks(text: string, savedBySourcePath: Map<string, string>): string {
  let out = text;
  for (const [srcPath, savedName] of savedBySourcePath) {
    const url = `/api/chat/file?name=${encodeURIComponent(savedName)}`;
    const normalized = srcPath.replace(/\\/g, '/');
    const variants = [
      `file:///${normalized}`,
      `file:///${encodeURI(normalized).replace(/#/g, '%23')}`,
      srcPath,
      normalized,
    ];
    for (const v of variants) {
      if (out.includes(v)) out = out.split(v).join(url);
    }
  }
  return out;
}

/** Runs the chosen AI for Chat, allowing both Markdown text replies and image generation (ChatGPT/Gemini). */
export const askChatAi: AskChatAi = async (ai, prompt, cwd, images = []) => {
  const [cmd, ...prefix] = aiCommand(ai);
  const output = path.join(cwd, 'answer.json');
  const modelArgs = aiModelArgs(ai);
  const gemini = geminiStdin(prompt);
  const started = Date.now();
  const beforeCwd = new Set(fs.readdirSync(cwd));

  const args = ai === 'codex'
    ? ['exec', '--skip-git-repo-check', ...CODEX_STANDARD_TIER, ...modelArgs, '-c', 'sandbox_mode="workspace-write"', '--json', '-o', output, '-', ...images.flatMap((image) => ['-i', image])]
    : ai === 'claude'
      ? ['-p', ...modelArgs, '--output-format', 'json', '--permission-mode', 'default', '--allowedTools', 'Read']
      : [...gemini.args, ...modelArgs, '--sandbox', '--add-dir', cwd, '--settings', JSON.stringify({ toolPermission: 'proceed-in-sandbox', enableTerminalSandbox: true, permissions: { allow: ['read_file(*)'] } }), '--print-timeout', '1200s'];

  const res = await runAiProcess(cmd, [...prefix, ...args], {
    cwd,
    timeoutMs: 20 * 60 * 1000,
    input: ai === 'gemini' ? gemini.input : prompt,
  });
  if (res.startError) throw new Error(`Could not start the AI: ${res.startError}`);
  if (res.code !== 0) throw new Error(res.timedOut ? 'The AI timed out.' : res.stderr.trim().slice(-600) || `The AI stopped (exit code ${res.code}).`);

  let text = '';
  const generatedImages = newImagesInDir(cwd, started, beforeCwd);

  if (ai === 'codex') {
    text = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
    const threadId = sessionFrom(res.stdout, 'thread_id');
    if (threadId) {
      for (const p of newImagesInDir(path.join(os.homedir(), '.codex', 'generated_images', threadId), started)) {
        if (!generatedImages.includes(p)) generatedImages.push(p);
      }
    }
  } else if (ai === 'claude') {
    const result = JSON.parse(res.stdout) as { is_error?: boolean; result?: string };
    if (result.is_error || !result.result) throw new Error(result.result || 'Claude could not reply.');
    text = result.result;
  } else {
    text = geminiAnswer(res.stdout);
    const convId = sessionFrom(res.stdout, 'conversation_id');
    for (const p of newestBrainImage(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'), convId, started)) {
      if (!generatedImages.includes(p)) generatedImages.push(p);
    }
  }

  for (const p of extractMentionedImages(text)) {
    if (!generatedImages.includes(p)) generatedImages.push(p);
  }

  return { text, generatedImages };
};

/** Sends a chat message (and any attached files) to the chosen AI, saving both turns to Drive. */
export async function sendChatMessage(
  rawAi: unknown,
  rawMessage: unknown,
  rawFiles: unknown = [],
  ask: AskChatAi = askChatAi,
): Promise<ChatThread> {
  if (!isAiId(rawAi)) throw new Error('Choose Claude, ChatGPT, or Gemini.');
  if (rawMessage !== undefined && typeof rawMessage !== 'string') throw new Error('Type a message first.');
  if (rawFiles !== undefined && !Array.isArray(rawFiles)) throw new Error('Invalid file list.');

  const files: string[] = [];
  for (const item of rawFiles ?? []) {
    if (typeof item !== 'string') throw new Error('Invalid file name.');
    chatFilePath(item); // verify each file exists and is safe before recording it
    if (!files.includes(item)) files.push(item);
  }

  const trimmed = (rawMessage ?? '').trim();
  if (!trimmed && !files.length) throw new Error('Type a message or attach a file first.');
  const message = trimmed || 'Look at the attached file(s).';

  if (activeChat) {
    throw new Error('An AI is already replying in Chat. Wait a moment and try again.');
  }
  activeChat = true;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-chat-'));
  try {
    const current = readChat();
    const historyBefore = [...current.messages];
    current.messages.push({
      id: randomUUID(),
      from: 'john',
      text: message,
      at: new Date().toISOString(),
      ...(files.length ? { files } : {}),
    });
    saveChat(current);

    // Copy all files referenced in the conversation into the AI's working folder.
    const allFiles: string[] = [];
    for (const m of current.messages) {
      for (const name of m.files ?? []) {
        if (!allFiles.includes(name)) allFiles.push(name);
      }
    }

    const copiedFiles: string[] = [];
    const extractedDocx: Record<string, string> = {};
    const imagePaths: string[] = [];

    for (const name of allFiles) {
      let src: string;
      try {
        src = chatFilePath(name);
      } catch {
        continue; // If a file was removed from Drive, continue with the remaining context.
      }
      const dest = path.join(work, name);
      fs.copyFileSync(src, dest);
      copiedFiles.push(name);

      const ext = path.extname(name).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        imagePaths.push(dest);
      } else if (ext === '.docx') {
        try {
          const text = (await mammoth.extractRawText({ path: dest })).value.trim();
          if (text) {
            const txtName = `${name}.txt`;
            const txtPath = path.join(work, txtName);
            if (!fs.existsSync(txtPath)) {
              fs.writeFileSync(txtPath, text, 'utf8');
              extractedDocx[name] = txtName;
            }
          }
        } catch {
          // If mammoth cannot read a .docx, leave the original file in work.
        }
      }
    }

    const sentImages = imagePaths.slice(-IMAGES_SENT);
    const prompt = buildChatPrompt(historyBefore, message, files, rawAi, copiedFiles, extractedDocx);
    const rawResult = await ask(rawAi, prompt, work, sentImages);
    const rawText = (typeof rawResult === 'string' ? rawResult : rawResult.text).trim();
    const generatedPaths = typeof rawResult === 'string' ? [] : (rawResult.generatedImages ?? []);
    for (const p of extractMentionedImages(rawText)) {
      if (!generatedPaths.includes(p)) generatedPaths.push(p);
    }

    const savedGenerated: string[] = [];
    const savedBySourcePath = new Map<string, string>();
    for (const imgPath of generatedPaths) {
      try {
        const bytes = fs.readFileSync(imgPath);
        if (bytes.length > 0) {
          const savedName = uploadChatFile(path.basename(imgPath), bytes).name;
          savedGenerated.push(savedName);
          savedBySourcePath.set(imgPath, savedName);
        }
      } catch {
        // Ignore unreadable generated image paths.
      }
    }

    const answerText = rewriteImageLinks(rawText, savedBySourcePath);

    if (!answerText && !savedGenerated.length) {
      throw new Error(`${AI_NAMES[rawAi]} returned an empty reply.`);
    }

    const latest = readChat();
    latest.messages.push({
      id: randomUUID(),
      from: rawAi,
      text: answerText || 'Generated an image.',
      at: new Date().toISOString(),
      ...(savedGenerated.length ? { files: savedGenerated } : {}),
    });
    saveChat(latest);
    return latest;
  } finally {
    activeChat = false;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Clears the chat conversation and moves any attached files in Drive to HeartQuarters Trash. */
export function clearChat(): ChatThread {
  if (activeChat) throw new Error('Wait for the AI reply before clearing the chat.');

  const filesDir = chatFilesFolder(false);
  if (fs.existsSync(filesDir)) {
    writable(filesDir);
    const entries = fs.readdirSync(filesDir);
    if (entries.length) {
      const projects = path.resolve(config.videoProjectsDir);
      const trash = path.resolve(config.trashDir);
      if (!config.trashDir || isInside(projects, trash) || isInside(trash, projects)) {
        throw new Error('The trash folder must be outside Video Projects.');
      }
      fs.mkdirSync(trash, { recursive: true });
      const holder = fs.mkdtempSync(path.join(trash, 'Chat Files '));
      for (const entry of entries) {
        const full = path.join(filesDir, entry);
        writable(full);
        fs.renameSync(full, path.join(holder, entry));
      }
    }
  }

  const cleared = emptyChat();
  const dir = chatFolder(false);
  if (fs.existsSync(path.join(dir, 'chat.json'))) {
    saveChat(cleared);
  }
  return cleared;
}
