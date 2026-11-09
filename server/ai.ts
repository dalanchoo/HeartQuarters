// Which AI does the jobs the buttons start: Claude (Claude Code), ChatGPT (OpenAI's Codex) or Gemini (Google's
// Antigravity CLI, "agy"). John picks at the top of the app. A conversation stays with the AI it's with until John sends a note after picking the other one; see claude.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, config } from './config.js';

export type AiId = 'claude' | 'codex' | 'gemini';

export const AI_NAMES: Record<AiId, string> = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini' };

export interface AiOverview {
  chosen: AiId;
  options: { id: AiId; name: string; available: boolean }[];
}

// HQ_AI_FILE lets tests and a test copy keep their own choice, away from John's.
const choiceFile = () => process.env.HQ_AI_FILE ?? path.join(appDir, 'data', 'ai-choice.json');

export function isAiId(value: unknown): value is AiId {
  return value === 'claude' || value === 'codex' || value === 'gemini';
}

/** The AI John picked. Claude if he never has, or if the file is unreadable. */
export function chosenAi(): AiId {
  try {
    const ai: unknown = JSON.parse(fs.readFileSync(choiceFile(), 'utf8')).ai;
    return isAiId(ai) ? ai : 'claude';
  } catch {
    return 'claude';
  }
}

export function chooseAi(value: unknown): AiId {
  if (!isAiId(value)) throw new Error('Unknown AI.');
  const file = choiceFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ai: value }));
  return value;
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
  return {
    chosen: chosenAi(),
    options: (['claude', 'codex', 'gemini'] as const).map((id) => ({ id, name: AI_NAMES[id], available: isAvailable(id) })),
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
