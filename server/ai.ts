// Which AI does the jobs the buttons start: Claude (Claude Code), ChatGPT (OpenAI's Codex) or Gemini (Google's
// Antigravity CLI, "agy"). John picks at the top of the app. A conversation stays with the AI it's with until John sends a note after picking the other one; see claude.ts.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, config } from './config.js';

export type AiId = 'claude' | 'codex' | 'gemini';

export const AI_NAMES: Record<AiId, string> = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini' };

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiOverview {
  chosen: AiId;
  options: {
    id: AiId;
    name: string;
    available: boolean;
    model: string;
    defaultLabel: string;
    models: AiModelOption[];
  }[];
}

// HQ_AI_FILE lets tests and a test copy keep their own choice, away from John's.
const choiceFile = () => process.env.HQ_AI_FILE ?? path.join(appDir, 'data', 'ai-choice.json');
const MODEL_ID_RE = /^[A-Za-z0-9._-]+$/;

export function isAiId(value: unknown): value is AiId {
  return value === 'claude' || value === 'codex' || value === 'gemini';
}

interface StoredAiChoice {
  ai: AiId;
  models: Partial<Record<AiId, string>>;
}

function readChoiceData(): StoredAiChoice {
  try {
    const raw = JSON.parse(fs.readFileSync(choiceFile(), 'utf8')) as { ai?: unknown; models?: Record<string, unknown> };
    const models: Partial<Record<AiId, string>> = {};
    for (const id of ['claude', 'codex', 'gemini'] as const) {
      const m = raw.models?.[id];
      if (typeof m === 'string' && MODEL_ID_RE.test(m)) models[id] = m;
    }
    return { ai: isAiId(raw.ai) ? raw.ai : 'claude', models };
  } catch {
    return { ai: 'claude', models: {} };
  }
}

function writeChoiceData(data: StoredAiChoice) {
  const file = choiceFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

/** The AI John picked. Claude if he never has, or if the file is unreadable. */
export function chosenAi(): AiId {
  return readChoiceData().ai;
}

export function chooseAi(value: unknown): AiId {
  if (!isAiId(value)) throw new Error('Unknown AI.');
  const current = readChoiceData();
  writeChoiceData({ ...current, ai: value });
  return value;
}

/** The model John picked for `ai`, or '' for that CLI's own default. */
export function chosenModel(ai: AiId): string {
  return readChoiceData().models[ai] ?? '';
}

export function chooseAiModel(ai: unknown, model: unknown): string {
  if (!isAiId(ai)) throw new Error('Unknown AI.');
  const clean = String(model ?? '').trim();
  if (clean && !MODEL_ID_RE.test(clean)) throw new Error('Invalid model name.');
  const current = readChoiceData();
  const models = { ...current.models };
  if (clean) models[ai] = clean;
  else delete models[ai];
  writeChoiceData({ ...current, models });
  return clean;
}

/** Command-line arguments to pass the chosen model for `ai` (empty when set to Default). */
export function aiModelArgs(ai: AiId): string[] {
  const model = chosenModel(ai);
  if (!model) return [];
  return ai === 'codex' ? ['-c', `model=${JSON.stringify(model)}`] : ['--model', model];
}

/**
 * Settings for every ChatGPT (Codex) call: the normal speed tier, because John's own Codex settings may have Fast
 * mode on, which uses credits faster. Put first so a chosen model can follow it.
 */
export const CODEX_STANDARD_TIER = ['-c', 'service_tier="standard"'];

let cachedGeminiModels: AiModelOption[] | null = null;

/** Parses `<id>\t<label>` lines printed by `agy.exe models`. */
export function parseGeminiModels(out: string): AiModelOption[] {
  const seen = new Set<string>();
  const list: AiModelOption[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [id, label] = line.trim().split('\t');
    if (!id || !label || !MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    list.push({ id, label: label.trim() });
  }
  return list;
}

export function rememberGeminiModels(models: AiModelOption[]) {
  if (models.length) cachedGeminiModels = models;
}

const DEFAULT_CLAUDE_MODELS: AiModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];

const DEFAULT_CODEX_MODELS: AiModelOption[] = [
  { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol' },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2-Astra' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
  { id: 'gpt-6-sol', label: 'GPT-6-Sol' },
];

const DEFAULT_GEMINI_MODELS: AiModelOption[] = [
  { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
];

export function availableModels(ai: AiId, home = os.homedir()): { defaultLabel: string; models: AiModelOption[] } {
  let defaultModel = '';
  let models: AiModelOption[] = [];
  if (ai === 'claude') {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')) as { model?: unknown };
      if (typeof s.model === 'string') defaultModel = s.model;
    } catch { /* no explicit model in settings.json */ }
    try {
      const dir = path.join(home, '.claude', 'cache', 'model-catalog');
      const newest = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('-cc.json'))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0];
      if (newest) {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, newest.f), 'utf8')) as { catalog?: { config?: { models?: { id?: string; name?: string }[] } } };
        models = (raw.catalog?.config?.models ?? [])
          .filter((m): m is { id: string; name?: string } => typeof m.id === 'string' && MODEL_ID_RE.test(m.id))
          .map((m) => ({ id: m.id, label: m.name || m.id }));
      }
    } catch { /* fall back to default list */ }
    if (!models.length) models = DEFAULT_CLAUDE_MODELS;
  } else if (ai === 'codex') {
    try {
      const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
      defaultModel = /^\s*model\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? '';
    } catch { /* no config.toml */ }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'models_cache.json'), 'utf8')) as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
      models = (raw.models ?? [])
        .filter((m): m is { slug: string; display_name?: string; visibility?: string } => typeof m.slug === 'string' && MODEL_ID_RE.test(m.slug) && m.visibility !== 'hide')
        .map((m) => ({ id: m.slug, label: m.display_name || m.slug }));
    } catch { /* fall back to default list */ }
    if (!models.length) models = DEFAULT_CODEX_MODELS;
  } else {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8')) as { model?: unknown };
      if (typeof s.model === 'string') defaultModel = s.model;
    } catch { /* no settings.json */ }
    models = cachedGeminiModels ?? DEFAULT_GEMINI_MODELS;
  }
  const defaultName = defaultModel ? (models.find((m) => m.id === defaultModel)?.label ?? defaultModel) : (models[0]?.label ?? '');
  return { defaultLabel: defaultName ? `Default (${defaultName})` : 'Default', models };
}

export function aiCommand(ai: AiId): string[] {
  return ai === 'codex' ? config.codexCommand : ai === 'gemini' ? config.geminiCommand : config.claudeCommand;
}

/** False when the program isn't where config.json says. A bare name is looked up when it runs, so it counts as there. */
function isAvailable(ai: AiId): boolean {
  const program = aiCommand(ai).at(-1) ?? '';
  return !!program && (!path.isAbsolute(program) || fs.existsSync(program));
}

export function aiOverview(): AiOverview {
  const data = readChoiceData();
  return {
    chosen: data.ai,
    options: (['claude', 'codex', 'gemini'] as const).map((id) => {
      const model = data.models[id] ?? '';
      const { defaultLabel, models } = availableModels(id);
      const list = model && !models.some((m) => m.id === model) ? [{ id: model, label: model }, ...models] : models;
      return { id, name: AI_NAMES[id], available: isAvailable(id), model, defaultLabel, models: list };
    }),
  };
}

/**
 * Building a CapCut project takes scripts that write to Drive, and Gemini's commands can't (see geminiArgs). So those
 * jobs are refused before anything happens: Regenerate would otherwise throw a short away and then fail to remake it.
 */
export function requireCapCutAi(ai: AiId) {
  if (ai === 'gemini') {
    throw new Error("Gemini is set up in a limited way and can't build CapCut projects. Pick Claude or ChatGPT at the top of the app. Nothing was changed.");
  }
}

// ---- Codex ------------------------------------------------------------------

/** What Codex may write to besides the folder it starts in. It can't write anywhere else. */
export function codexWritableFolders(videoDir: string): string[] {
  return [
    videoDir,
    config.capcutDraftsDir,
    // Where HyperFrames and npx keep what they download.
    path.join(os.homedir(), '.cache'),
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'npm-cache'),
  ];
}

/**
 * The command line for one turn. Without a session it's a new conversation. The limits are set in a way that works for
 * both: continuing a conversation doesn't take the normal --sandbox option, and would otherwise be read-only.
 */
export function codexArgs(sessionId: string | null, message: string, writable: string[]): string[] {
  return [
    'exec',
    ...(sessionId ? ['resume', sessionId] : []),
    '--json',
    '--skip-git-repo-check',
    ...CODEX_STANDARD_TIER,
    ...aiModelArgs('codex'),
    '-c', 'sandbox_mode="workspace-write"',
    '-c', 'sandbox_workspace_write.network_access=true',
    // A JSON list of strings is also valid in Codex's settings format, backslashes included.
    '-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(writable)}`,
    message,
  ];
}

export interface AiEvent {
  text?: string;
  activity?: string;
  done?: boolean;
  error?: string;
  /** The conversation's id: Codex makes its own, so it's only known once it has started. */
  sessionId?: string;
}

/** Turns one line of Codex's --json output into what the page shows. */
export function readCodexEvent(line: string): AiEvent {
  let e: {
    type?: string;
    thread_id?: string;
    error?: { message?: string };
    item?: { type?: string; text?: string; command?: string; changes?: { path?: string }[] };
  };
  try {
    e = JSON.parse(line);
  } catch {
    return {};
  }
  if (e.type === 'thread.started') return { sessionId: e.thread_id };
  if (e.type === 'turn.completed') return { done: true };
  if (e.type === 'turn.failed') return { done: true, error: e.error?.message || 'ChatGPT stopped with an error.' };
  if (e.type === 'item.started' && e.item?.type === 'command_execution') {
    const command = String(e.item.command ?? '').replace(/^"[^"]*powershell\.exe"\s+-Command\s+/i, '');
    return { activity: `Running: ${command.split('\n')[0].slice(0, 160)}` };
  }
  if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text?.trim()) {
    return { text: e.item.text.trim() };
  }
  if (e.type === 'item.completed' && e.item?.type === 'file_change') {
    const file = e.item.changes?.[0]?.path;
    return { activity: `Edited: ${file ? path.basename(file) : 'a file'}` };
  }
  return {};
}

// ---- Gemini (Antigravity CLI) -------------------------------------------------

/**
 * The command line for one turn. Commands run in its sandbox without asking; anything else needs approval, which a
 * background run can't give, so it's refused. Don't allow commands with a "command(...)" rule: tested, that also lets it
 * re-run a refused command outside the sandbox, which is the whole limit gone. On Windows the sandbox can't write to
 * folders outside the user profile, so only its file-writing tool can reach Drive, and only in `writable`.
 */
export function geminiArgs(sessionId: string | null, message: string, writable: string[]): string[] {
  const settings = {
    toolPermission: 'proceed-in-sandbox',
    enableTerminalSandbox: true,
    permissions: { allow: ['read_file(*)', ...writable.map((folder) => `write_file(${folder})`)] },
  };
  return [
    '-p', message,
    '--output-format', 'stream-json',
    ...(sessionId ? ['--conversation', sessionId] : []),
    ...aiModelArgs('gemini'),
    '--sandbox',
    ...writable.flatMap((folder) => ['--add-dir', folder]),
    '--settings', JSON.stringify(settings),
  ];
}

interface GeminiEvent {
  event?: string;
  conversation_id?: string;
  step_update?: {
    state?: string;
    step_type?: string;
    tool_name?: string;
    text_delta?: string;
    tool_info?: { parameters?: { CommandLine?: string; Path?: string } };
  };
  result?: { status?: string; response?: string; error?: string };
}

/**
 * Makes a reader for one turn's output. Gemini sends its words in small pieces, so it remembers them until the end of
 * each message. A turn can end with nothing said, when a tool it needed was refused, and that shouldn't look like success.
 */
export function geminiReader(): (line: string) => AiEvent {
  let words = '';
  let saidAnything = false;
  return (line) => {
    let e: GeminiEvent;
    try {
      e = JSON.parse(line);
    } catch {
      return {};
    }
    if (e.event === 'init') return { sessionId: e.conversation_id };
    const step = e.step_update;
    if (e.event === 'step_update' && step?.step_type === 'tool' && step.state === 'ACTIVE') {
      const detail = step.tool_info?.parameters?.CommandLine ?? step.tool_info?.parameters?.Path ?? '';
      return { activity: `${step.tool_name ?? 'Tool'}${detail ? ': ' + detail.split('\n')[0].slice(0, 160) : ''}` };
    }
    if (e.event === 'step_update' && step?.step_type === 'agent_response') {
      words += step.text_delta ?? '';
      if (step.state !== 'DONE' || !words.trim()) return {};
      const text = words.trim();
      words = '';
      saidAnything = true;
      return { text };
    }
    if (e.event === 'result') {
      if (e.result?.status !== 'SUCCESS') return { done: true, error: e.result?.error || `Gemini stopped (${e.result?.status ?? 'error'}).` };
      if (saidAnything) return { done: true };
      const said = e.result?.response?.trim();
      return { done: true, text: said || 'Gemini finished without saying anything. It may have been refused something it needed.' };
    }
    return {};
  };
}

/** Kills a child process and, on Windows, its child tree (MCP servers, Codex sandbox helpers). */
export function killProcessTree(child: ChildProcess) {
  const fallback = () => { try { child.kill(); } catch { /* already gone */ } };
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', fallback);
    killer.on('close', (code) => { if (code !== 0) fallback(); });
    return;
  }
  fallback();
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  startError?: string;
}

/** Runs an AI subprocess with timeout, Windows process-tree cleanup, and a post-exit settle if a grandchild keeps stdio open. */
export function runAiProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; windowsHide?: boolean; mergeOutput?: boolean },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: opts.windowsHide ?? true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    const done = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitTimer) clearTimeout(exitTimer);
      resolve(result);
    };
    child.stdout.setEncoding('utf8').on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      if (opts.mergeOutput) stdout += c;
      else stderr = (stderr + c).slice(-2000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, opts.timeoutMs);
    child.on('error', (e) => done({ code: null, stdout, stderr, timedOut, startError: e.message }));
    child.on('exit', (code) => {
      exitTimer = setTimeout(() => done({ code, stdout, stderr, timedOut }), 1500);
    });
    child.on('close', (code) => done({ code, stdout, stderr, timedOut }));
  });
}
