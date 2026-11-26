// Full-screen multi-AI chat, stored in Drive under Video Projects\_HeartQuarters\Chat\.
// Supports multiple conversations, folders, and any attached file format; any AI (Claude, ChatGPT, Gemini) can reply on any turn.
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
export const CHAT_THREADS_DIR = '_HeartQuarters/Chat/Threads';
export const CHAT_FILES_DIR = '_HeartQuarters/Chat/Files';
const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const TITLE_MAX = 120;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const IMAGES_SENT = 6;
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS]);
const BLOCKED_EXTS = new Set(['.lnk', '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi']);
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ChatMessage {
  id: string;
  from: 'john' | AiId;
  text: string;
  at: string;
  files?: string[];
}

export interface ChatFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  folderId: string | null;
  ideaId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatIndex {
  version: 1;
  folders: ChatFolder[];
  chats: ChatSummary[];
}

export interface ChatThread {
  version: 1;
  id: string;
  title: string;
  folderId: string | null;
  ideaId?: string;
  messages: ChatMessage[];
}

export interface UploadedChatFile {
  name: string;
  size: number;
}

export type ChatAskResult = string | { text: string; generatedImages?: string[] };
export type AskChatAi = (ai: AiId, prompt: string, cwd: string, images?: string[]) => Promise<ChatAskResult>;

const activeChats = new Set<string>();

function checkId(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !CHAT_ID_RE.test(raw)) {
    throw new Error(`Choose a valid ${label}.`);
  }
  return raw;
}

function cleanTitle(raw: unknown, fallback = 'New Chat'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return cleaned || fallback;
}

function titleFromMessage(message: string): string {
  const firstLine = message.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const cleaned = firstLine.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New Chat';
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
}

function chatFolder(forWrite: boolean): string {
  const dir = safeResolve('projects', CHAT_DIR);
  if (forWrite) {
    makeFolder(dir);
    return writable(dir);
  }
  return dir;
}

function threadsFolder(forWrite: boolean): string {
  const dir = safeResolve('projects', CHAT_THREADS_DIR);
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

function indexFile(forWrite: boolean): string {
  const dir = chatFolder(forWrite);
  const file = path.join(dir, 'chats.json');
  return forWrite ? writable(file) : readable(file);
}

function threadFile(chatId: string, forWrite: boolean): string {
  const dir = threadsFolder(forWrite);
  const file = path.join(dir, `${chatId}.json`);
  return forWrite ? writable(file) : readable(file);
}

function emptyIndex(): ChatIndex {
  return { version: 1, folders: [], chats: [] };
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

function readThreadMessages(chatId: string): ChatMessage[] {
  const dir = threadsFolder(false);
  if (!fs.existsSync(dir)) return [];
  readable(dir);
  const candidate = path.join(dir, `${chatId}.json`);
  if (!fs.existsSync(candidate)) return [];
  const raw = readText(threadFile(chatId, false));
  let parsed: { version?: unknown; messages?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('The chat file could not be read. Nothing was changed.');
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.messages) || !parsed.messages.every(validMessage)) {
    throw new Error('The chat file has an unexpected format. Nothing was changed.');
  }
  return parsed.messages;
}

function saveThreadMessages(chatId: string, messages: ChatMessage[]) {
  writeFile(threadFile(chatId, true), JSON.stringify({ version: 1, messages }, null, 2) + '\n');
}

function saveIndex(index: ChatIndex) {
  writeFile(indexFile(true), JSON.stringify(index, null, 2) + '\n');
}

/** Migrates an older single-conversation chat.json into chats.json + Threads/<id>.json if needed. */
function maybeMigrateLegacyChat(): void {
  const dir = chatFolder(false);
  if (!fs.existsSync(dir)) return;
  readable(dir);
  const idxPath = path.join(dir, 'chats.json');
  const legacyPath = path.join(dir, 'chat.json');
  if (fs.existsSync(idxPath) || !fs.existsSync(legacyPath)) return;

  const raw = readText(readable(legacyPath));
  let parsed: { version?: unknown; messages?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return;
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.messages) || !parsed.messages.every(validMessage)) return;
  if (parsed.messages.length === 0) return;

  const id = randomUUID();
  const firstJohn = parsed.messages.find((m) => m.from === 'john');
  const firstAt = parsed.messages[0].at;
  const lastAt = parsed.messages[parsed.messages.length - 1].at;
  const title = firstJohn ? titleFromMessage(firstJohn.text) : 'Previous Chat';

  saveThreadMessages(id, parsed.messages);
  saveIndex({
    version: 1,
    folders: [],
    chats: [{ id, title, folderId: null, createdAt: firstAt, updatedAt: lastAt, messageCount: parsed.messages.length }],
  });
  writable(legacyPath);
  fs.rmSync(legacyPath, { force: true });
}

function readIndex(): ChatIndex {
  maybeMigrateLegacyChat();
  const dir = chatFolder(false);
  if (!fs.existsSync(dir)) return emptyIndex();
  readable(dir);
  const candidate = path.join(dir, 'chats.json');
  if (!fs.existsSync(candidate)) return emptyIndex();
  const raw = readText(indexFile(false));
  let parsed: Partial<ChatIndex>;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<ChatIndex>;
  } catch {
    throw new Error('The chat index could not be read. Nothing was changed.');
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.folders) || !Array.isArray(parsed.chats)) {
    throw new Error('The chat index has an unexpected format. Nothing was changed.');
  }
  return { version: 1, folders: parsed.folders, chats: parsed.chats };
}

/** Lists all folders and conversations (newest updated first). */
export function listChats(): ChatIndex {
  const index = readIndex();
  return {
    version: 1,
    folders: [...index.folders],
    chats: [...index.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

/** Reads one conversation by ID, or returns an empty placeholder when no ID is given. */
export function readChat(rawChatId?: unknown): ChatThread {
  const index = readIndex();
  if (rawChatId === undefined || rawChatId === null || rawChatId === '') {
    const latest = [...index.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) return { version: 1, id: '', title: 'New Chat', folderId: null, messages: [] };
    return {
      version: 1,
      id: latest.id,
      title: latest.title,
      folderId: latest.folderId,
      ...(latest.ideaId ? { ideaId: latest.ideaId } : {}),
      messages: readThreadMessages(latest.id),
    };
  }
  const chatId = checkId(rawChatId, 'conversation');
  const summary = index.chats.find((c) => c.id === chatId);
  if (!summary) throw new Error('That conversation no longer exists.');
  return {
    version: 1,
    id: summary.id,
    title: summary.title,
    folderId: summary.folderId,
    ...(summary.ideaId ? { ideaId: summary.ideaId } : {}),
    messages: readThreadMessages(chatId),
  };
}

/** Creates a new empty conversation, optionally inside a folder (by ID or folder name, creating the folder if needed). */
export function createChat(rawFolderId?: unknown, rawTitle?: unknown, rawFolderName?: unknown, rawIdeaId?: unknown): { index: ChatIndex; chat: ChatThread } {
  const index = readIndex();
  const ideaId = rawIdeaId !== undefined && rawIdeaId !== null && rawIdeaId !== '' ? checkId(rawIdeaId, 'idea') : undefined;
  if (ideaId) {
    const existingChat = index.chats.find((c) => c.ideaId === ideaId);
    if (existingChat) {
      return { index: listChats(), chat: readChat(existingChat.id) };
    }
  }
  let folderId: string | null = null;
  if (rawFolderId !== undefined && rawFolderId !== null && rawFolderId !== '') {
    folderId = checkId(rawFolderId, 'folder');
    if (!index.folders.some((f) => f.id === folderId)) throw new Error('That folder no longer exists.');
  } else if (typeof rawFolderName === 'string' && rawFolderName.trim()) {
    const wanted = cleanTitle(rawFolderName, '');
    if (wanted) {
      const existing = index.folders.find((f) => f.name.toLowerCase() === wanted.toLowerCase());
      if (existing) {
        folderId = existing.id;
      } else {
        const created = { id: randomUUID(), name: wanted, createdAt: new Date().toISOString() };
        index.folders.push(created);
        folderId = created.id;
      }
    }
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = cleanTitle(rawTitle, 'New Chat');
  const summary: ChatSummary = { id, title, folderId, ...(ideaId ? { ideaId } : {}), createdAt: now, updatedAt: now, messageCount: 0 };
  index.chats.unshift(summary);
  saveThreadMessages(id, []);
  saveIndex(index);
  return {
    index: listChats(),
    chat: { version: 1, id, title, folderId, ...(ideaId ? { ideaId } : {}), messages: [] },
  };
}

/** Renames an existing conversation. */
export function renameChat(rawChatId: unknown, rawTitle: unknown): ChatIndex {
  const chatId = checkId(rawChatId, 'conversation');
  const title = cleanTitle(rawTitle, '');
  if (!title) throw new Error('Enter a conversation name.');
  const index = readIndex();
  const chat = index.chats.find((c) => c.id === chatId);
  if (!chat) throw new Error('That conversation no longer exists.');
  chat.title = title;
  saveIndex(index);
  return listChats();
}

/** Moves a conversation into a folder (or null for no folder). */
export function moveChat(rawChatId: unknown, rawFolderId: unknown): ChatIndex {
  const chatId = checkId(rawChatId, 'conversation');
  const index = readIndex();
  const chat = index.chats.find((c) => c.id === chatId);
  if (!chat) throw new Error('That conversation no longer exists.');

  let folderId: string | null = null;
  if (rawFolderId !== undefined && rawFolderId !== null && rawFolderId !== '') {
    folderId = checkId(rawFolderId, 'folder');
    if (!index.folders.some((f) => f.id === folderId)) throw new Error('That folder no longer exists.');
  }
  chat.folderId = folderId;
  saveIndex(index);
  return listChats();
}

function trashFiles(names: string[]): void {
  if (!names.length) return;
  const filesDir = chatFilesFolder(false);
  if (!fs.existsSync(filesDir)) return;
  writable(filesDir);
  const existing = names.filter((n) => fs.existsSync(path.join(filesDir, n)));
  if (!existing.length) return;

  const projects = path.resolve(config.videoProjectsDir);
  const trash = path.resolve(config.trashDir);
  if (!config.trashDir || isInside(projects, trash) || isInside(trash, projects)) {
    throw new Error('The trash folder must be outside Video Projects.');
  }
  fs.mkdirSync(trash, { recursive: true });
  const holder = fs.mkdtempSync(path.join(trash, 'Chat Files '));
  for (const name of existing) {
    const full = path.join(filesDir, name);
    writable(full);
    fs.renameSync(full, path.join(holder, name));
  }
}

function filesUsedByOtherChats(index: ChatIndex, excludedChatId: string): Set<string> {
  const used = new Set<string>();
  for (const c of index.chats) {
    if (c.id === excludedChatId) continue;
    try {
      for (const m of readThreadMessages(c.id)) {
        for (const f of m.files ?? []) used.add(f);
      }
    } catch {
      // Ignore unreadable sibling threads when collecting referenced files.
    }
  }
  return used;
}

/** Deletes a conversation and moves its unshared files and thread JSON to Trash. */
export function deleteChat(rawChatId: unknown): ChatIndex {
  const chatId = checkId(rawChatId, 'conversation');
  if (activeChats.has(chatId)) throw new Error('Wait for the AI reply before deleting this conversation.');
  const index = readIndex();
  const pos = index.chats.findIndex((c) => c.id === chatId);
  if (pos < 0) throw new Error('That conversation no longer exists.');

  const messages = readThreadMessages(chatId);
  const keep = filesUsedByOtherChats(index, chatId);
  const orphanFiles = [...new Set(messages.flatMap((m) => m.files ?? []))].filter((f) => !keep.has(f));

  index.chats.splice(pos, 1);
  saveIndex(index);

  const file = path.join(threadsFolder(false), `${chatId}.json`);
  if (fs.existsSync(file)) {
    writable(file);
    fs.rmSync(file, { force: true });
  }
  trashFiles(orphanFiles);
  return listChats();
}

/** Creates a new folder in the Chat sidebar. */
export function createFolder(rawName: unknown): ChatIndex {
  const name = cleanTitle(rawName, '');
  if (!name) throw new Error('Enter a folder name.');
  const index = readIndex();
  index.folders.push({ id: randomUUID(), name, createdAt: new Date().toISOString() });
  saveIndex(index);
  return listChats();
}

/** Renames a folder in the Chat sidebar. */
export function renameFolder(rawFolderId: unknown, rawName: unknown): ChatIndex {
  const folderId = checkId(rawFolderId, 'folder');
  const name = cleanTitle(rawName, '');
  if (!name) throw new Error('Enter a folder name.');
  const index = readIndex();
  const folder = index.folders.find((f) => f.id === folderId);
  if (!folder) throw new Error('That folder no longer exists.');
  folder.name = name;
  saveIndex(index);
  return listChats();
}

/** Deletes a folder, moving any conversations inside it back to the top level. */
export function deleteFolder(rawFolderId: unknown): ChatIndex {
  const folderId = checkId(rawFolderId, 'folder');
  const index = readIndex();
  const pos = index.folders.findIndex((f) => f.id === folderId);
  if (pos < 0) throw new Error('That folder no longer exists.');
  index.folders.splice(pos, 1);
  for (const chat of index.chats) {
    if (chat.folderId === folderId) chat.folderId = null;
  }
  saveIndex(index);
  return listChats();
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

function newMediaInDir(dir: string, since: number, exclude: Set<string> = new Set()): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => MEDIA_EXTS.has(path.extname(f).toLowerCase()) && !exclude.has(f))
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

function newestBrainMedia(rootDir: string, convId: string, since: number): string[] {
  if (convId) {
    const exact = newMediaInDir(path.join(rootDir, convId), since);
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
    const all = recentDirs.flatMap((d) => newMediaInDir(d, since));
    if (all.length) {
      all.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
      return [all[all.length - 1]];
    }
  } catch {
    // Ignore missing brain directory.
  }
  return [];
}

/** Finds local file paths (file:///... or Windows/POSIX paths) mentioned in an AI's Markdown reply. */
export function extractMentionedFiles(text: string): string[] {
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
    const ext = path.extname(candidate).toLowerCase();
    if (!ext || BLOCKED_EXTS.has(ext)) return;
    try {
      const st = fs.statSync(candidate);
      if (st.isFile() && !found.includes(candidate)) found.push(candidate);
    } catch {
      // Not an existing local file.
    }
  };
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1]);
  for (const m of text.matchAll(/(?:file:\/\/\/|[A-Za-z]:[\\/])[^\s)"'<>]+\.[A-Za-z0-9]{1,8}/gi)) add(m[0]);
  return found;
}

/** Rewrites local file:/// or disk paths in an AI's Markdown reply to HeartQuarters' /api/chat/file URL. */
export function rewriteFileLinks(text: string, savedBySourcePath: Map<string, string>): string {
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
  const generatedImages = newMediaInDir(cwd, started, beforeCwd);

  if (ai === 'codex') {
    text = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
    const threadId = sessionFrom(res.stdout, 'thread_id');
    if (threadId) {
      for (const p of newMediaInDir(path.join(os.homedir(), '.codex', 'generated_images', threadId), started)) {
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
    for (const p of newestBrainMedia(path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'), convId, started)) {
      if (!generatedImages.includes(p)) generatedImages.push(p);
    }
  }

  for (const p of extractMentionedFiles(text)) {
    if (!generatedImages.includes(p)) generatedImages.push(p);
  }

  return { text, generatedImages };
};

/** Sends a chat message (and any attached files) to the chosen AI, creating a new chat if none is selected. */
export async function sendChatMessage(
  rawChatId: unknown,
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
    chatFilePath(item);
    if (!files.includes(item)) files.push(item);
  }

  const trimmed = (rawMessage ?? '').trim();
  if (!trimmed && !files.length) throw new Error('Type a message or attach a file first.');
  const message = trimmed || 'Look at the attached file(s).';

  let chatId: string;
  if (rawChatId === undefined || rawChatId === null || rawChatId === '') {
    chatId = createChat(null, titleFromMessage(message)).chat.id;
  } else {
    chatId = checkId(rawChatId, 'conversation');
    const idx = readIndex();
    if (!idx.chats.some((c) => c.id === chatId)) throw new Error('That conversation no longer exists.');
  }

  if (activeChats.has(chatId)) {
    throw new Error('An AI is already replying in this conversation. Wait a moment and try again.');
  }
  activeChats.add(chatId);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-chat-'));
  try {
    const messages = readThreadMessages(chatId);
    const historyBefore = [...messages];
    const now = new Date().toISOString();
    messages.push({
      id: randomUUID(),
      from: 'john',
      text: message,
      at: now,
      ...(files.length ? { files } : {}),
    });
    saveThreadMessages(chatId, messages);

    const idxAfterUser = readIndex();
    const sumAfterUser = idxAfterUser.chats.find((c) => c.id === chatId);
    if (sumAfterUser) {
      if (sumAfterUser.title === 'New Chat' && historyBefore.length === 0) {
        sumAfterUser.title = titleFromMessage(message);
      }
      sumAfterUser.updatedAt = now;
      sumAfterUser.messageCount = messages.length;
      saveIndex(idxAfterUser);
    }

    const allFiles: string[] = [];
    for (const m of messages) {
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
        continue;
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
    for (const p of extractMentionedFiles(rawText)) {
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
        // Ignore unreadable generated file paths.
      }
    }

    const answerText = rewriteFileLinks(rawText, savedBySourcePath);

    if (!answerText && !savedGenerated.length) {
      throw new Error(`${AI_NAMES[rawAi]} returned an empty reply.`);
    }

    const latestMessages = readThreadMessages(chatId);
    const replyAt = new Date().toISOString();
    latestMessages.push({
      id: randomUUID(),
      from: rawAi,
      text: answerText || 'Generated an image.',
      at: replyAt,
      ...(savedGenerated.length ? { files: savedGenerated } : {}),
    });
    saveThreadMessages(chatId, latestMessages);

    const idxAfterReply = readIndex();
    const sumAfterReply = idxAfterReply.chats.find((c) => c.id === chatId);
    if (sumAfterReply) {
      sumAfterReply.updatedAt = replyAt;
      sumAfterReply.messageCount = latestMessages.length;
      saveIndex(idxAfterReply);
    }

    return readChat(chatId);
  } finally {
    activeChats.delete(chatId);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Clears the messages in one conversation and moves any unshared files to Trash. */
export function clearChat(rawChatId: unknown): ChatThread {
  const chatId = checkId(rawChatId, 'conversation');
  if (activeChats.has(chatId)) throw new Error('Wait for the AI reply before clearing this conversation.');

  const index = readIndex();
  const summary = index.chats.find((c) => c.id === chatId);
  if (!summary) throw new Error('That conversation no longer exists.');

  const messages = readThreadMessages(chatId);
  const keep = filesUsedByOtherChats(index, chatId);
  const orphanFiles = [...new Set(messages.flatMap((m) => m.files ?? []))].filter((f) => !keep.has(f));

  saveThreadMessages(chatId, []);
  summary.messageCount = 0;
  summary.updatedAt = new Date().toISOString();
  saveIndex(index);
  trashFiles(orphanFiles);

  return readChat(chatId);
}
