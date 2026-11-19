// Is each AI signed in, and a way to sign in again from HeartQuarters. Each check is free: it asks the AI's own
// program, not the AI itself. Signing in opens the AI's program in its own window, where John finishes in the browser.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { AI_NAMES, aiCommand, isAiId, runAiProcess, type AiId } from './ai.js';

export type SignInState = 'in' | 'out' | 'unknown';
export interface SignIn { id: AiId; name: string; state: SignInState; detail: string }
export interface Ran { code: number | null; out: string }
export type Runner = (cmd: string, args: string[]) => Promise<Ran>;

const AIS: AiId[] = ['claude', 'codex', 'gemini'];

/** What each program is asked to find out whether it's signed in. */
const CHECK_ARGS: Record<AiId, string[]> = {
  claude: ['auth', 'status'], // JSON with "loggedIn"
  codex: ['login', 'status'], // "Logged in using ChatGPT"
  gemini: ['models'], // Antigravity has no status command, but lists its models only when signed in
};

/** What each program is started with to sign in. Antigravity has no sign-in command: started on its own, it asks. */
export const SIGN_IN_ARGS: Record<AiId, string[]> = { claude: ['auth', 'login'], codex: ['login'], gemini: [] };

/** Reads one program's answer to the check. */
export function readSignIn(ai: AiId, ran: Ran): { state: SignInState; detail: string } {
  const out = ran.out.trim();
  if (ai === 'claude') {
    try {
      const answer = JSON.parse(out) as { loggedIn?: unknown; email?: unknown };
      if (answer.loggedIn === true) return { state: 'in', detail: typeof answer.email === 'string' ? `Signed in as ${answer.email}` : 'Signed in' };
      if (answer.loggedIn === false) return { state: 'out', detail: 'Not signed in.' };
    } catch {
      /* not the expected answer */
    }
  } else if (ai === 'codex') {
    if (ran.code === 0 && /logged in/i.test(out)) return { state: 'in', detail: out.split('\n')[0] };
    if (/not logged in|logged out/i.test(out)) return { state: 'out', detail: 'Not signed in.' };
  } else {
    if (ran.code === 0 && out.split('\n').some((l) => /^gemini/i.test(l))) return { state: 'in', detail: 'Signed in' };
    if (ran.code !== null && ran.code !== 0) return { state: 'out', detail: lastLines(out) || "It couldn't list its models, so it's probably not signed in." };
  }
  return { state: 'unknown', detail: lastLines(out) || "Its answer wasn't one HeartQuarters knows." };
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-2).join(' ').slice(0, 300);
}

/** Runs a program and collects what it prints, stopping it after 30 seconds. */
export const runProgram: Runner = async (cmd, args) => {
  const res = await runAiProcess(cmd, args, { cwd: os.homedir(), timeoutMs: 30_000, mergeOutput: true });
  return res.startError ? { code: null, out: `Couldn't start it: ${res.startError}` } : { code: res.code, out: res.stdout };
};

/** All three AIs, checked at the same time. */
export async function aiSignIns(run: Runner = runProgram): Promise<SignIn[]> {
  return Promise.all(
    AIS.map(async (id) => {
      const [cmd, ...pre] = aiCommand(id);
      const result = readSignIn(id, await run(cmd, [...pre, ...CHECK_ARGS[id]]));
      return { id, name: AI_NAMES[id], ...result };
    }),
  );
}

export type Opener = (cmd: string, args: string[]) => void;

/** Starts a program in a window of its own (on Windows a detached program gets its own console window). */
const openWindow: Opener = (cmd, args) => {
  const child = spawn(cmd, args, { cwd: os.homedir(), detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => undefined);
  child.unref();
};

/** Opens one AI's sign-in in its own window. Only the three known AIs, with their own fixed commands. */
export function openSignIn(value: unknown, open: Opener = openWindow): { name: string } {
  if (!isAiId(value)) throw new Error('Unknown AI.');
  const [cmd, ...pre] = aiCommand(value);
  open(cmd, [...pre, ...SIGN_IN_ARGS[value]]);
  return { name: AI_NAMES[value] };
}
