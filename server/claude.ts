// Runs Claude Code in the background on one video, and keeps the conversation.
//   "Edit with Claude": follows the longform-edit skill; John sends notes after looking at the result in CapCut.
//   "Propose shorts": follows the shorts skill's choosing steps and writes Shorts\\Shorts Plan.json (see shorts.ts).
//   "Make this short": cuts a copy of the longform's CapCut project down to one short, turns it portrait, adds captions.
//
// Each video has one conversation per job (a Claude Code session id), saved in data/claude/ so it survives a restart.
// A run is one turn of that conversation: the first one starts the job, later ones send John's notes.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appDir, config, safeResolve } from './config.js';

export interface ClaudeMessage {
  from: 'john' | 'claude';
  text: string;
  at: string;
}

/** The longform edit, the list of shorts, or one short ("short-S07"). */
export type ClaudeJob = 'edit' | 'shorts' | `short-${string}`;

export interface ClaudeRun {
  video: string;
  /** Which job this conversation is for (conversations saved before there were jobs are edits). */
  job?: ClaudeJob;
  draft: string;
  sessionId: string;
  status: 'idle' | 'running' | 'failed';
  messages: ClaudeMessage[];
  /** What it's doing right now, e.g. "Running: python plan_edit.py ..." */
  activity: string;
  error?: string;
}

const running = new Map<string, ChildProcess>();

/** One video can have one conversation per job. */
function keyOf(video: string, job: ClaudeJob = 'edit'): string {
  return job === 'edit' ? video : `${video}#${job}`;
}

function stateFile(key: string): string {
  return path.join(appDir, 'data', 'claude', `${key.replace(/[\\/:*?"<>|]/g, '_')}.json`);
}

function load(key: string): ClaudeRun | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(key), 'utf8')) as ClaudeRun;
  } catch {
    return null;
  }
}

function save(run: ClaudeRun) {
  const file = stateFile(keyOf(run.video, run.job));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(run, null, 1));
}

/** The video's Longform folder (checked to be inside the video projects) and its CapCut project's name. */
function videoPlaces(video: string): { longform: string; draft: string } {
  if (!video) throw new Error('No video given.');
  const longform = safeResolve('projects', path.join(video, 'Longform'));
  if (!fs.existsSync(longform)) throw new Error(`"${video}" has no Longform folder.`);
  return { longform, draft: path.basename(video) };
}

/** The first message of a video's conversation. */
export function firstPrompt(longform: string, draft: string): string {
  return [
    `Use the longform-edit skill to edit the longform video in "${longform}",`,
    `writing into its CapCut project "${draft}" (in "${config.capcutDraftsDir}").`,
    'Work through the whole skill without waiting for me, except where the skill says to stop for John.',
  ].join(' ');
}

/** A job from the page: only the shorts conversations can be reached this way. Its name becomes part of a file name. */
export function parseShortsJob(value: unknown): ClaudeJob {
  const job = String(value ?? '');
  if (job === 'shorts' || /^short-S\d+$/.test(job)) return job as ClaudeJob;
  throw new Error('Unknown conversation.');
}

/** The first message of a video's shorts conversation: choosing only, nothing is built. */
export function shortsPrompt(videoDir: string, retentionGraph = false): string {
  return [
    `Use the shorts-from-longform skill to propose shorts for the longform video in "${videoDir}".`,
    'Do only its choosing steps, up to and including "Write the plan for John": write Shorts\\Shorts Plan.json and stop.',
    "Don't create any folders and don't change anything in CapCut.",
    retentionGraph
      ? 'John pasted the retention graph: it is Shorts\\Retention Graph.png. Look at it and use it as the skill says.'
      : 'John has no retention graph for this round, so go ahead without it.',
    "You don't need the YouTube or Substack links yet.",
  ].join(' ');
}

export interface ShortToBuild {
  id: string;
  title: string;
  start: number;
  end: number;
  /** The short's folder and CapCut project are both called this. */
  name: string;
  /** The longform's CapCut project it was copied from. */
  source: string;
}

/** The first message of one short's conversation. */
export function buildPrompt(videoDir: string, short: ShortToBuild): string {
  return [
    `Use the shorts-from-longform skill, "Build each short", to build one short for the video in "${videoDir}".`,
    `Its folder is "Shorts\\${short.name}". Its CapCut project is "${short.name}" in "${config.capcutDraftsDir}":`,
    `HeartQuarters has just made it as a full copy of the longform's project "${short.source}", so don't copy anything.`,
    `The clip runs from ${short.start} to ${short.end} seconds on the longform's timeline.`,
    'Build the picture and the captions: keep that stretch on every track, moved to start at 0, then 9:16, John framed',
    "so his head stays on screen, B-roll and graphics refitted to the portrait frame, and captions, all as the skill says.",
    'Leave the cover and packaging until John asks. Start by checking how this project is actually built.',
    'CapCut is closed now. Tell John what to look at when you are done.',
  ].join(' ');
}

/** How John sees this conversation: he reads it in HeartQuarters, not in a terminal. */
const SYSTEM_NOTE =
  'You are running inside HeartQuarters, started by a button John clicked. He reads only your text ' +
  'replies, on a page in the app, and answers there. Keep each reply short and plain: what you did, and at most one ' +
  'question when you need him. When you need him (for example to close CapCut, or to decide something), say so ' +
  'clearly and end your turn.';

/** The command line for one turn. Tools are allowed up front: a background run can't stop to ask. */
export function claudeArgs(run: ClaudeRun, message: string, first: boolean): string[] {
  return [
    '-p', message,
    '--output-format', 'stream-json', '--verbose',
    ...(first ? ['--session-id', run.sessionId] : ['--resume', run.sessionId]),
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Bash', 'PowerShell', 'TodoWrite',
    '--add-dir', config.skillsDir, config.capcutDraftsDir,
    '--append-system-prompt', SYSTEM_NOTE,
  ];
}

/** Turns one line of Claude's stream-json output into what the page shows. */
export function readEvent(line: string): { text?: string; activity?: string; done?: boolean; error?: string } {
  let e: { type?: string; subtype?: string; is_error?: boolean; result?: string; message?: { content?: unknown } };
  try {
    e = JSON.parse(line);
  } catch {
    return {};
  }
  if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
    const out: { text?: string; activity?: string } = {};
    for (const c of e.message.content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (c.type === 'text' && c.text?.trim()) out.text = (out.text ? out.text + '\n\n' : '') + c.text.trim();
      if (c.type === 'tool_use') {
        const detail = String(c.input?.command ?? c.input?.file_path ?? c.input?.pattern ?? c.input?.skill ?? '');
        out.activity = `${c.name}${detail ? ': ' + detail.split('\n')[0].slice(0, 160) : ''}`;
      }
    }
    return out;
  }
  if (e.type === 'result') {
    return e.is_error || e.subtype !== 'success'
      ? { done: true, error: e.result || `Claude stopped (${e.subtype ?? 'error'}).` }
      : { done: true };
  }
  return {};
}

export function getRun(video: string, job: ClaudeJob = 'edit'): ClaudeRun | null {
  const key = keyOf(video, job);
  const run = load(key);
  if (run && run.status === 'running' && !running.has(key)) {
    // The app restarted while Claude was working: that turn was cut off.
    run.status = 'failed';
    run.error = 'HeartQuarters restarted while Claude was working. Send a note to carry on.';
    save(run);
  }
  return run;
}

function runTurn(run: ClaudeRun, message: string, first: boolean, cwd: string) {
  const key = keyOf(run.video, run.job);
  const [cmd, ...pre] = config.claudeCommand;
  const child = spawn(cmd, [...pre, ...claudeArgs(run, message, first)], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  running.set(key, child);
  run.status = 'running';
  run.activity = 'Starting…';
  run.error = undefined;
  save(run);

  let buffer = '';
  let stderr = '';
  let sawResult = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const ev = readEvent(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (ev.text) run.messages.push({ from: 'claude', text: ev.text, at: new Date().toISOString() });
      if (ev.activity) run.activity = ev.activity;
      if (ev.done) {
        sawResult = true;
        run.error = ev.error;
      }
      if (ev.text || ev.activity || ev.done) save(run);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const finish = (failed: boolean, why?: string) => {
    if (running.get(key) !== child) return;
    running.delete(key);
    run.status = failed ? 'failed' : 'idle';
    run.activity = '';
    if (why) run.error = why;
    save(run);
  };
  child.on('error', (e) => finish(true, `Couldn't start Claude: ${e.message}`));
  child.on('close', (code) => {
    if (code === 0 && sawResult && !run.error) finish(false);
    else finish(true, run.error || stderr.trim() || `Claude stopped (exit code ${code}).`);
  });
}

/** Starts a new conversation for this video: Claude edits it following the longform-edit skill. */
export function startEdit(video: string): ClaudeRun {
  const { longform, draft } = videoPlaces(video);
  if (running.has(video)) throw new Error('Claude is already working on this video.');
  if (!fs.existsSync(path.join(config.capcutDraftsDir, draft))) {
    throw new Error(`There's no CapCut project called "${draft}".`);
  }
  const message = firstPrompt(longform, draft);
  const run: ClaudeRun = {
    video,
    draft,
    sessionId: randomUUID(),
    status: 'idle',
    activity: '',
    messages: [{ from: 'john', text: 'Edit this video with the longform-edit skill.', at: new Date().toISOString() }],
  };
  runTurn(run, message, true, longform);
  return run;
}

/** Starts a shorts conversation: Claude proposes shorts into the plan file. Any earlier plan is kept by the caller. */
export function startShortsProposal(video: string, retentionGraph = false): ClaudeRun {
  const { longform, draft } = videoPlaces(video);
  if (running.has(keyOf(video, 'shorts'))) throw new Error('Claude is already proposing shorts for this video.');
  const videoDir = path.dirname(longform);
  const run: ClaudeRun = {
    video,
    job: 'shorts',
    draft,
    sessionId: randomUUID(),
    status: 'idle',
    activity: '',
    messages: [{ from: 'john', text: 'Propose shorts for this video.', at: new Date().toISOString() }],
  };
  runTurn(run, shortsPrompt(videoDir, retentionGraph), true, videoDir);
  return run;
}

/** Starts one short's conversation: Claude cuts its CapCut project down. The project was copied before this (shorts.ts). */
export function startShortBuild(video: string, short: ShortToBuild): ClaudeRun {
  const { longform } = videoPlaces(video);
  const job: ClaudeJob = `short-${short.id}`;
  if (running.has(keyOf(video, job))) throw new Error('Claude is already making this short.');
  const videoDir = path.dirname(longform);
  const run: ClaudeRun = {
    video,
    job,
    draft: short.name,
    sessionId: randomUUID(),
    status: 'idle',
    activity: '',
    messages: [{ from: 'john', text: `Make this short: ${short.name}`, at: new Date().toISOString() }],
  };
  runTurn(run, buildPrompt(videoDir, short), true, videoDir);
  return run;
}

/** Sends John's note to one of the video's conversations; Claude carries on from where it was. */
export function sendNote(video: string, text: string, job: ClaudeJob = 'edit'): ClaudeRun {
  const { longform } = videoPlaces(video);
  const note = text.trim();
  if (!note) throw new Error('The note is empty.');
  const run = getRun(video, job);
  if (!run) throw new Error("There's no conversation to reply to yet.");
  if (running.has(keyOf(video, job))) throw new Error('Claude is still working. Wait for it to finish, or stop it.');
  run.messages.push({ from: 'john', text: note, at: new Date().toISOString() });
  // A conversation can only be resumed from the folder it started in.
  runTurn(run, note, false, job === 'edit' ? longform : path.dirname(longform));
  return run;
}

/** Stops Claude mid-turn. The conversation is kept; a note carries it on. */
export function stopRun(video: string, job: ClaudeJob = 'edit'): ClaudeRun | null {
  const key = keyOf(video, job);
  const child = running.get(key);
  if (child) {
    running.delete(key);
    child.kill();
    const run = load(key);
    if (run) {
      run.status = 'failed';
      run.activity = '';
      run.error = 'Stopped. Send a note to carry on.';
      save(run);
    }
  }
  return getRun(video, job);
}
