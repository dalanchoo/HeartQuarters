// Runs the chosen AI (Claude Code, Codex or Antigravity, see ai.ts) in the background on one video, and keeps the conversation.
//   "Edit with Claude": follows the longform-edit skill; John sends notes after looking at the result in CapCut.
//   "Propose shorts": follows the shorts skill's choosing steps and writes Shorts\\Shorts Plan.json (see shorts.ts).
//   "Make this short": cuts a copy of the longform's CapCut project down to one short, turns it portrait, adds captions.
//
// Each video has one conversation per job (a Claude Code session id). They live only in the engine's memory, never in a
// file (John, 2026-11-12): reloading the page clears them, and so does Clear on a card.
// A run is one turn of that conversation: the first one starts the job, later ones send John's notes.
// If John picks the other AI and sends a note, that AI takes over with the conversation's text (see handoverPrompt).
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_NAMES,
  aiCommand,
  chosenAi,
  codexArgs,
  codexWritableFolders,
  geminiArgs,
  geminiReader,
  readCodexEvent,
  requireCapCutAi,
  type AiEvent,
  type AiId,
} from './ai.js';
import { appDir, config, safeResolve } from './config.js';

export interface ClaudeMessage {
  /** "claude" is whichever AI said it. "app" is HeartQuarters noting something, such as a change of AI. */
  from: 'john' | 'claude' | 'app';
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
  /** Which AI has this conversation. Conversations saved before there was a choice are Claude's. */
  ai?: AiId;
  /** The AI's id for the conversation. Empty until Codex has started: it makes its own. */
  sessionId: string;
  /** The job as first given, for another AI taking over. */
  prompt?: string;
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

const runs = new Map<string, ClaudeRun>();

function load(key: string): ClaudeRun | null {
  return runs.get(key) ?? null;
}

function save(run: ClaudeRun) {
  runs.set(keyOf(run.video, run.job), run);
}

/** Clear on a card: forgets that conversation. A turn still running has to be stopped first. */
export function forgetRun(video: string, job: ClaudeJob = 'edit') {
  if (running.has(keyOf(video, job))) throw new Error('The AI is still working. Stop it first.');
  runs.delete(keyOf(video, job));
}

/** When the page loads: forgets every conversation that isn't in the middle of a turn. */
export function forgetIdleRuns() {
  for (const key of [...runs.keys()]) if (!running.has(key)) runs.delete(key);
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
  /** What the plan says about this clip, such as what to drop. */
  notes?: string;
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
    ...(short.notes ? [`The plan's notes on this clip, which you must follow: ${short.notes}`] : []),
    'Leave the cover and packaging until John asks. Start by checking how this project is actually built.',
    `Before you report, run "${path.join(config.skillsDir, 'HMF_Skills', 'shorts-from-longform', 'scripts', 'check_short.py')}" on the project and fix every PROBLEM it prints.`,
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

/** What Gemini needs to be told on top: why a job may not be possible for it. */
const GEMINI_LIMITS =
  "Your shell commands run in a sandbox that can read everywhere but can't write to this video's folder or Drive. " +
  'To write a file there, use your file-writing tool, which can only write in this video\'s folder. ' +
  "If the job needs a script to write there, or anything outside that folder, don't try another way around it: stop and tell John, so he can pick another AI.";

/** What an AI without Claude's Skill tool needs to be told. Neither can add to its instructions on the command line. */
function otherAiNote(ai: AiId): string {
  const skills = path.join(config.skillsDir, 'HMF_Skills');
  return [
    SYSTEM_NOTE,
    `Skills are plain instruction files. When told to use a skill, first read "${path.join(skills, 'channel-basics', 'SKILL.md')}",`,
    `then "${path.join(skills, '<skill name>', 'SKILL.md')}", and follow them. They were written with Claude in mind:`,
    'where they say Claude, that means you, and folders called Claude keep that name.',
    'In PowerShell on this PC, run npx as npx.cmd.',
    ai === 'gemini'
      ? GEMINI_LIMITS
      : "You can only write in this video's folder, CapCut's drafts folder and your temporary and download folders. If you need to write anywhere else, stop and tell John.",
  ].join(' ');
}

/**
 * For an AI taking over: it has none of the earlier AI's memory, only what was said and what's in the files. So it's
 * told not to take a mention as proof that something was done.
 */
export function handoverPrompt(run: ClaudeRun, note: string): string {
  const said = run.messages
    .filter((m) => m.from !== 'app')
    .map((m) => `${m.from === 'john' ? 'John' : 'AI'}: ${m.text}`)
    .join('\n\n')
    .slice(-12000);
  return [
    "This job was started in an earlier conversation that can't be continued, possibly by a different AI, so you are taking over. " +
      "You don't have its memory, only the text below. Check the real files to see how far it got, don't redo finished work, " +
      "and don't assume something was done just because it's mentioned.",
    ...(run.prompt ? [`The job, as first given:\n${run.prompt}`] : []),
    `The conversation so far:\n${said}`,
    `John's newest message, which is what to act on now:\n${note}`,
  ].join('\n\n');
}

/** Turns one line of Claude's stream-json output into what the page shows. */
export function readEvent(line: string): AiEvent {
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
    // The app restarted while the AI was working: that turn was cut off.
    run.status = 'failed';
    run.error = `HeartQuarters restarted while ${AI_NAMES[run.ai ?? 'claude']} was working. Send a note to carry on.`;
    save(run);
  }
  return run;
}

function runTurn(run: ClaudeRun, message: string, first: boolean, cwd: string) {
  const key = keyOf(run.video, run.job);
  const ai = run.ai ?? 'claude';
  const name = AI_NAMES[ai];
  const [cmd, ...pre] = aiCommand(ai);
  const videoDir = safeResolve('projects', run.video);
  const said = first ? `${otherAiNote(ai)}\n\n${message}` : message;
  const session = first ? null : run.sessionId;
  const args =
    ai === 'codex'
      ? codexArgs(session, said, codexWritableFolders(videoDir))
      : ai === 'gemini'
        ? geminiArgs(session, said, [videoDir])
        : claudeArgs(run, message, first);
  const read = ai === 'codex' ? readCodexEvent : ai === 'gemini' ? geminiReader() : readEvent;
  const child = spawn(cmd, [...pre, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
      const ev = read(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (ev.sessionId) run.sessionId = ev.sessionId;
      if (ev.text) run.messages.push({ from: 'claude', text: ev.text, at: new Date().toISOString() });
      if (ev.activity) run.activity = ev.activity;
      if (ev.done) {
        sawResult = true;
        run.error = ev.error;
      }
      if (ev.text || ev.activity || ev.done || ev.sessionId) save(run);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  let finishing = false;
  const finish = (failed: boolean, why?: string) => {
    if (running.get(key) !== child || finishing) return;
    finishing = true;
    const end = () => {
      if (running.get(key) !== child) return; // stopped while the project was being checked
      running.delete(key);
      run.status = failed ? 'failed' : 'idle';
      run.activity = '';
      if (why) run.error = why;
      save(run);
    };
    if (failed || !run.job?.startsWith('short-')) return end();
    run.activity = 'HeartQuarters is checking the project…';
    save(run);
    checkShortProject(run.draft, (said) => {
      if (said) run.messages.push({ from: 'app', text: said, at: new Date().toISOString() });
      end();
    });
  };
  child.on('error', (e) => finish(true, `Couldn't start ${name}: ${e.message}`));
  const finishUp = (code: number | null) => {
    if (code === 0 && sawResult && !run.error) finish(false);
    else finish(true, run.error || stderr.trim() || `${name} stopped (exit code ${code}).`);
  };
  child.on('close', finishUp);
  // "close" waits until nothing can still write to the output, and a helper the AI left running can hold that open for
  // minutes (Codex's sandbox setup does). So a few seconds after the AI itself has exited, the turn counts as over.
  child.on('exit', (code) => {
    setTimeout(() => finishUp(code), 3000).unref();
  });
}

/** A conversation about to start, with the chosen AI. Claude is given an id for it; Codex makes its own. */
function newRun(fields: Pick<ClaudeRun, 'video' | 'job' | 'draft' | 'prompt'>, said: string, ai: AiId): ClaudeRun {
  return {
    ...fields,
    ai,
    sessionId: ai === 'claude' ? randomUUID() : '',
    status: 'idle',
    activity: '',
    messages: [{ from: 'john', text: said, at: new Date().toISOString() }],
  };
}

/**
 * Runs the skill's checker on a short's CapCut project after each turn, so the result comes from HeartQuarters and not
 * only from the AI's report of it. Says nothing if there's no checker or project to check.
 */
function checkShortProject(draft: string, done: (said: string | null) => void) {
  const script = path.join(config.skillsDir, 'HMF_Skills', 'shorts-from-longform', 'scripts', 'check_short.py');
  const project = path.join(config.capcutDraftsDir, draft);
  if (!fs.existsSync(script) || !fs.existsSync(project)) return done(null);
  execFile(config.python, [script, project], { encoding: 'utf8', timeout: 60000 }, (error, stdout) => {
    const problems = stdout.split(/\r?\n/).filter((line) => line.startsWith('PROBLEM: ')).map((line) => line.slice('PROBLEM: '.length));
    if (problems.length > 0) {
      return done(`HeartQuarters checked this CapCut project and found ${problems.length} problem(s). Don't trust it until they're fixed:\n- ${problems.join('\n- ')}`);
    }
    if (error) return done(`HeartQuarters couldn't check this CapCut project: ${error.message.split('\n')[0]}`);
    done('HeartQuarters checked this CapCut project: no problems in its settings. That says nothing about how it looks or sounds, so check it in CapCut.');
  });
}

/** Starts a new conversation for this video: the AI edits it following the longform-edit skill. */
export function startEdit(video: string, ai: AiId = chosenAi()): ClaudeRun {
  requireCapCutAi(ai);
  const { longform, draft } = videoPlaces(video);
  if (running.has(video)) throw new Error('The AI is already working on this video.');
  if (!fs.existsSync(path.join(config.capcutDraftsDir, draft))) {
    throw new Error(`There's no CapCut project called "${draft}".`);
  }
  const message = firstPrompt(longform, draft);
  const run = newRun({ video, draft, prompt: message }, 'Edit this video with the longform-edit skill.', ai);
  runTurn(run, message, true, longform);
  return run;
}

/** Starts a shorts conversation: the AI proposes shorts into the plan file. Any earlier plan is kept by the caller. */
export function startShortsProposal(video: string, retentionGraph = false, ai: AiId = chosenAi()): ClaudeRun {
  const { longform, draft } = videoPlaces(video);
  if (running.has(keyOf(video, 'shorts'))) throw new Error('The AI is already proposing shorts for this video.');
  const videoDir = path.dirname(longform);
  const message = shortsPrompt(videoDir, retentionGraph);
  const run = newRun({ video, job: 'shorts', draft, prompt: message }, 'Propose shorts for this video.', ai);
  runTurn(run, message, true, videoDir);
  return run;
}

/** Starts one short's conversation: the AI cuts its CapCut project down. The project was copied before this (shorts.ts). */
export function startShortBuild(video: string, short: ShortToBuild, ai: AiId = chosenAi()): ClaudeRun {
  requireCapCutAi(ai);
  const { longform } = videoPlaces(video);
  const job: ClaudeJob = `short-${short.id}`;
  if (running.has(keyOf(video, job))) throw new Error('The AI is already making this short.');
  const videoDir = path.dirname(longform);
  const message = buildPrompt(videoDir, short);
  const run = newRun({ video, job, draft: short.name, prompt: message }, `Make this short: ${short.name}`, ai);
  runTurn(run, message, true, videoDir);
  return run;
}

/**
 * Sends John's note to one of the video's conversations, and the AI carries on from where it was. If he has picked the
 * other AI since, that one takes over. So does a new conversation of the same AI if the first never got started.
 */
export function sendNote(video: string, text: string, job: ClaudeJob = 'edit', ai: AiId = chosenAi()): ClaudeRun {
  const { longform } = videoPlaces(video);
  const note = text.trim();
  if (!note) throw new Error('The note is empty.');
  const run = getRun(video, job);
  if (!run) throw new Error("There's no conversation to reply to yet.");
  if (running.has(keyOf(video, job))) throw new Error('The AI is still working. Wait for it to finish, or stop it.');
  // A conversation can only be resumed from the folder it started in.
  const cwd = job === 'edit' ? longform : path.dirname(longform);
  const was = run.ai ?? 'claude';
  if (ai === was && run.sessionId) {
    run.messages.push({ from: 'john', text: note, at: new Date().toISOString() });
    runTurn(run, note, false, cwd);
    return run;
  }
  const message = handoverPrompt(run, note);
  const at = new Date().toISOString();
  if (ai !== was) run.messages.push({ from: 'app', text: `${AI_NAMES[ai]} takes over from ${AI_NAMES[was]} here.`, at });
  run.messages.push({ from: 'john', text: note, at });
  run.ai = ai;
  run.sessionId = ai === 'claude' ? randomUUID() : '';
  runTurn(run, message, true, cwd);
  return run;
}

/** The message that asks for a short's YouTube metadata. An export isn't needed: the words and the project are enough. */
export function metadataPrompt(shortName: string, longformUrl: string | null): string {
  return [
    `Write the YouTube metadata for the short "${shortName}", following the shorts-from-longform skill's "Packaging" section. YouTube only.`,
    `Fill in Shorts\\${shortName}\\Packaging\\V01\\YouTube.md, or the next version if that one already has real content.`,
    "Use the short's words from its Subtitles folder or the word-by-word transcript: John may not have exported it yet, and you don't need the export.",
    longformUrl
      ? `The longform's YouTube URL is ${longformUrl}.`
      : "The longform's YouTube URL isn't known: leave a clearly marked placeholder, and tell John to link the longform's YouTube video in its \"YouTube upload & settings\" and click the button again.",
    "Read the short's CapCut project to see which music and B-roll it really uses, and go by the episode's notes on where they came from.",
    "Change nothing else, and don't touch its CapCut project. Tell John in a few lines what you wrote, and anything you couldn't confirm.",
  ].join(' ');
}

/** The message that asks for the longform's YouTube metadata. */
export function longformMetadataPrompt(): string {
  return [
    `Write the YouTube metadata for this video's longform, following the longform-edit skill's packaging rules. YouTube only.`,
    `Fill in Longform\\Packaging\\V01\\YouTube.md, or the next version if that one already has real content.`,
    "Use the final video's words: the transcript in Longform\\Subtitles, or the export if there isn't one.",
    "Change nothing else, and don't touch its CapCut project. Tell John in a few lines what you wrote, and anything you couldn't confirm.",
  ].join(' ');
}

/** The first message of a conversation John starts with a note of his own, about one piece of a video. */
export function pieceNotePrompt(videoDir: string, job: ClaudeJob, draft: string, note: string): string {
  const what =
    job === 'edit'
      ? `This conversation is about the longform of the video in "${videoDir}". Follow the longform-edit skill.`
      : `This conversation is about the short "${draft}" of the video in "${videoDir}": its folder is Shorts\\${draft}. Follow the shorts-from-longform skill.`;
  return [
    what,
    `Its CapCut project is "${draft}" in "${config.capcutDraftsDir}". Before changing anything, check how it's actually built, and only write to it with CapCut closed.`,
    `John's request:\n${note}`,
  ].join(' ');
}

/**
 * Sends a message in a piece's conversation, the longform's ("edit") or a short's, or starts one if it has none: a
 * short John made by hand has no conversation yet. `said` is what the page shows for John's side.
 */
export function askInConversation(video: string, job: ClaudeJob, draft: string, message: string, said = message, ai: AiId = chosenAi()): ClaudeRun {
  if (getRun(video, job)) return sendNote(video, message, job, ai);
  const { longform } = videoPlaces(video);
  if (running.has(keyOf(video, job))) throw new Error('The AI is still working. Wait for it to finish, or stop it.');
  const run = newRun({ video, job, draft, prompt: message }, said, ai);
  runTurn(run, message, true, job === 'edit' ? longform : path.dirname(longform));
  return run;
}

/** Ends a turn, along with whatever it started. On Windows, killing only the program would leave those running. */
function stopProcess(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
  else child.kill();
}

/** Stops the AI mid-turn. The conversation is kept; a note carries it on. */
export function stopRun(video: string, job: ClaudeJob = 'edit'): ClaudeRun | null {
  const key = keyOf(video, job);
  const child = running.get(key);
  if (child) {
    running.delete(key);
    stopProcess(child);
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
