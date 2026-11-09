// "Edit with Claude", tested with a fake Claude: a small script that prints what Claude Code prints. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appDir, config } from './config';
import { claudeArgs, firstPrompt, getRun, handoverPrompt, readEvent, sendNote, startEdit, stopRun, type ClaudeRun } from './claude';
import { aiOverview, chooseAi, chosenAi, codexArgs, geminiArgs, geminiReader, readCodexEvent } from './ai';
import { makeTree, removeTree } from './testing';

// Prints Codex's --json lines: its arguments and message, and the conversation id it was given or makes up.
const FAKE_CODEX = `
const args = process.argv.slice(2);
const msg = args[args.length - 1];
const resumed = args[1] === 'resume';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'thread.started', thread_id: resumed ? args[2] : 'thread-1' });
out({ type: 'item.started', item: { type: 'command_execution', command: 'dir' } });
out({ type: 'item.completed', item: { type: 'agent_message', text: (resumed ? 'Resumed ' + args[2] + ': ' : 'New: ') + msg } });
// Leaves a helper running that keeps the output open, as Codex's sandbox setup does.
if (msg.includes('LINGER')) require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit', cwd: require('os').tmpdir() }).unref();
if (msg.includes('FAILTURN')) { out({ type: 'turn.failed', error: { message: 'You hit your usage limit.' } }); process.exit(1); }
out({ type: 'turn.completed', usage: {} });
`;

// Prints Antigravity's stream-json lines: its message in two pieces, and the conversation id it was given or makes up.
const FAKE_GEMINI = `
const args = process.argv.slice(2);
const msg = args[args.indexOf('-p') + 1];
const given = args.includes('--conversation') ? args[args.indexOf('--conversation') + 1] : null;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const id = given || 'gemini-1';
out({ event: 'init', conversation_id: id, init: { permission_mode: 'proceed-in-sandbox' } });
out({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'dir' } } } });
out({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: given ? 'Resumed ' + given + ': ' : 'New: ' } });
out({ event: 'step_update', step_update: { state: 'DONE', step_type: 'agent_response', text_delta: msg } });
out({ event: 'result', result: { status: 'SUCCESS', response: 'x' } });
`;

// Prints Claude Code's stream-json lines; says the message it got, then finishes (or hangs with HANG in it).
const FAKE = `
const args = process.argv.slice(2);
const msg = args[args.indexOf('-p') + 1];
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'python plan_edit.py' } }] } });
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Got: ' + msg }] } });
if (msg.includes('HANG')) setInterval(() => {}, 1000);
else out({ type: 'result', subtype: 'success', is_error: false, result: 'ok' });
`;

let tmp: string;
let saved: { projects: string; drafts: string; cmd: string[]; codex: string[]; gemini: string[] };
const VIDEO = 'TEST-claude-023 - Test';

async function settle(): Promise<ClaudeRun> {
  for (let i = 0; i < 100; i++) {
    const r = getRun(VIDEO)!;
    if (r.status !== 'running') return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('fake Claude never finished');
}

beforeEach(() => {
  tmp = makeTree({
    [`Videos/${VIDEO}/Longform/Raw/`]: '',
    [`Drafts/${VIDEO}/draft_meta_info.json`]: '{}',
    'fake-claude.cjs': FAKE,
    'fake-codex.cjs': FAKE_CODEX,
    'fake-gemini.cjs': FAKE_GEMINI,
  });
  saved = { projects: config.videoProjectsDir, drafts: config.capcutDraftsDir, cmd: config.claudeCommand, codex: config.codexCommand, gemini: config.geminiCommand };
  config.videoProjectsDir = path.join(tmp, 'Videos');
  config.capcutDraftsDir = path.join(tmp, 'Drafts');
  config.claudeCommand = [process.execPath, path.join(tmp, 'fake-claude.cjs')];
  config.codexCommand = [process.execPath, path.join(tmp, 'fake-codex.cjs')];
  config.geminiCommand = [process.execPath, path.join(tmp, 'fake-gemini.cjs')];
});

afterEach(() => {
  stopRun(VIDEO);
  fs.rmSync(path.join(appDir, 'data', 'claude', `${VIDEO}.json`), { force: true });
  config.videoProjectsDir = saved.projects;
  config.capcutDraftsDir = saved.drafts;
  config.claudeCommand = saved.cmd;
  config.codexCommand = saved.codex;
  config.geminiCommand = saved.gemini;
  removeTree(tmp);
});

describe('choosing an AI', () => {
  const file = process.env.HQ_AI_FILE;
  afterEach(() => {
    process.env.HQ_AI_FILE = file;
  });

  it('is Claude until John picks, remembers his pick, and refuses anything else', () => {
    process.env.HQ_AI_FILE = path.join(tmp, 'data', 'ai-choice.json');
    expect(chosenAi()).toBe('claude');
    chooseAi('codex');
    expect(chosenAi()).toBe('codex');
    expect(() => chooseAi('skynet')).toThrow(/Unknown/);
    expect(chosenAi()).toBe('codex');
  });

  it('falls back to Claude if the file is damaged', () => {
    process.env.HQ_AI_FILE = path.join(tmp, 'damaged.json');
    fs.writeFileSync(process.env.HQ_AI_FILE, 'not json');
    expect(chosenAi()).toBe('claude');
  });

  it("says which AI isn't installed", () => {
    expect(aiOverview().options.map((o) => o.available)).toEqual([true, true, true]);
    config.codexCommand = ['node', path.join(tmp, 'missing.js')];
    expect(aiOverview().options.find((o) => o.id === 'codex')?.available).toBe(false);
  });
});

describe('Codex', () => {
  it('reads what it prints', () => {
    expect(readCodexEvent('{"type":"thread.started","thread_id":"abc"}')).toEqual({ sessionId: 'abc' });
    expect(readCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":" Done. "}}')).toEqual({ text: 'Done.' });
    expect(readCodexEvent('{"type":"item.started","item":{"type":"command_execution","command":"\\"C:\\\\x\\\\powershell.exe\\" -Command dir"}}')).toEqual({ activity: 'Running: dir' });
    expect(readCodexEvent('{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"a/b.md"}]}}')).toEqual({ activity: 'Edited: b.md' });
    expect(readCodexEvent('{"type":"turn.completed"}')).toEqual({ done: true });
    expect(readCodexEvent('{"type":"turn.failed","error":{"message":"Limit"}}')).toEqual({ done: true, error: 'Limit' });
    expect(readCodexEvent('not json')).toEqual({});
  });

  it('can write only where it is told, also when continuing a conversation', () => {
    const roots = ['D:\\Google Drive\\Video', 'D:\\Drafts'];
    const first = codexArgs(null, 'hi', roots);
    const later = codexArgs('abc', 'hi', roots);
    expect(first.slice(0, 2)).toEqual(['exec', '--json']);
    expect(later.slice(0, 3)).toEqual(['exec', 'resume', 'abc']);
    for (const args of [first, later]) {
      expect(args).toContain('sandbox_mode="workspace-write"');
      expect(args).toContain('sandbox_workspace_write.writable_roots=["D:\\\\Google Drive\\\\Video","D:\\\\Drafts"]');
      expect(args[args.length - 1]).toBe('hi');
    }
  });

  it('runs a conversation, keeping the id it makes up', async () => {
    const started = startEdit(VIDEO, 'codex');
    expect(started.sessionId).toBe('');
    let run = await settle();
    expect(run.status).toBe('idle');
    expect(run.ai).toBe('codex');
    expect(run.sessionId).toBe('thread-1');
    expect(run.messages[1].text).toMatch(/^New: .*Skills are plain instruction files.*longform-edit/s);

    sendNote(VIDEO, 'Tighter please', 'edit', 'codex');
    run = await settle();
    expect(run.messages.at(-1)?.text).toBe('Resumed thread-1: Tighter please');
  });

  it('finishes even if a helper it left running keeps the output open', async () => {
    startEdit(VIDEO, 'codex');
    await settle();
    sendNote(VIDEO, 'LINGER', 'edit', 'codex');
    const run = await settle();
    expect(run.status).toBe('idle');
    expect(run.messages.at(-1)?.text).toBe('Resumed thread-1: LINGER');
  });

  it('shows why a turn failed, such as a usage limit', async () => {
    startEdit(VIDEO, 'codex');
    await settle();
    sendNote(VIDEO, 'FAILTURN', 'edit', 'codex');
    const run = await settle();
    expect(run.status).toBe('failed');
    expect(run.error).toBe('You hit your usage limit.');
  });
});

describe('Gemini', () => {
  it('stays in its sandbox: commands are never allowed by a rule, which would let it step outside', () => {
    const args = geminiArgs(null, 'hi', ['D:\\Video']);
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    expect(settings.toolPermission).toBe('proceed-in-sandbox');
    expect(settings.enableTerminalSandbox).toBe(true);
    expect(settings.permissions.allow).toEqual(['read_file(*)', 'write_file(D:\\Video)']);
    expect(JSON.stringify(settings)).not.toMatch(/command\(/);
    expect(args).toContain('--sandbox');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--conversation');
    expect(geminiArgs('abc', 'hi', [])).toEqual(expect.arrayContaining(['--conversation', 'abc']));
  });

  it('joins the pieces of a message, and reads the rest of what it prints', () => {
    const read = geminiReader();
    expect(read('{"event":"init","conversation_id":"abc"}')).toEqual({ sessionId: 'abc' });
    expect(read('{"event":"step_update","step_update":{"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"parameters":{"Path":"a.md"}}}}')).toEqual({ activity: 'read_file: a.md' });
    expect(read('{"event":"step_update","step_update":{"state":"DONE","step_type":"agent_response"}}')).toEqual({});
    expect(read('{"event":"step_update","step_update":{"state":"ACTIVE","step_type":"agent_response","text_delta":"Hel"}}')).toEqual({});
    expect(read('{"event":"step_update","step_update":{"state":"DONE","step_type":"agent_response","text_delta":"lo\\n"}}')).toEqual({ text: 'Hello' });
    expect(read('{"event":"result","result":{"status":"SUCCESS","response":"Hello"}}')).toEqual({ done: true });
    expect(read('not json')).toEqual({});
  });

  it("reports a failed turn, and a turn that ended with nothing said", () => {
    expect(geminiReader()('{"event":"result","result":{"status":"ERROR","error":"Quota used up"}}')).toEqual({ done: true, error: 'Quota used up' });
    expect(geminiReader()('{"event":"result","result":{"status":"SUCCESS","response":""}}').text).toMatch(/may have been refused/);
    expect(geminiReader()('{"event":"result","result":{"status":"SUCCESS","response":"Only here"}}').text).toBe('Only here');
  });

  it("refuses to build a CapCut project, and changes nothing", () => {
    expect(() => startEdit(VIDEO, 'gemini')).toThrow(/limited/);
    expect(getRun(VIDEO)).toBeNull();
  });

  it('runs a conversation it was handed, with its limits explained, and continues it', async () => {
    startEdit(VIDEO, 'claude');
    await settle();
    sendNote(VIDEO, 'Write the title', 'edit', 'gemini');
    let run = await settle();
    expect(run.ai).toBe('gemini');
    expect(run.sessionId).toBe('gemini-1');
    expect(run.messages[2].text).toBe('Gemini takes over from Claude here.');
    expect(run.messages.at(-1)?.text).toMatch(/^New: .*sandbox.*stop and tell John.*Write the title/s);
    sendNote(VIDEO, 'Shorter', 'edit', 'gemini');
    run = await settle();
    expect(run.messages.at(-1)?.text).toBe('Resumed gemini-1: Shorter');
  });
});

describe('another AI taking over', () => {
  it('gets the job and the conversation, and is told to check the files', async () => {
    startEdit(VIDEO, 'claude');
    await settle();
    sendNote(VIDEO, 'Carry on please', 'edit', 'codex');
    const run = await settle();
    expect(run.ai).toBe('codex');
    expect(run.sessionId).toBe('thread-1');
    expect(run.messages.map((m) => m.from)).toEqual(['john', 'claude', 'app', 'john', 'claude']);
    expect(run.messages[2].text).toBe('ChatGPT takes over from Claude here.');
    const told = run.messages[4].text;
    expect(told).toMatch(/^New: /);
    expect(told).toMatch(/Check the real files/);
    expect(told).toMatch(/The job, as first given:\nUse the longform-edit/);
    expect(told).toMatch(/AI: Got: Use the longform-edit/);
    expect(told).toMatch(/John's newest message, which is what to act on now:\nCarry on please/);
  });

  it('works the other way round too, with a new conversation', async () => {
    startEdit(VIDEO, 'codex');
    await settle();
    sendNote(VIDEO, 'Back to you', 'edit', 'claude');
    const run = await settle();
    expect(run.ai).toBe('claude');
    expect(run.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.messages.at(-1)?.text).toMatch(/^Got: This job was started.*Back to you/s);
  });

  it('starts over with the job if the first turn never got going', async () => {
    startEdit(VIDEO, 'codex');
    await settle();
    const file = path.join(appDir, 'data', 'claude', `${VIDEO}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...getRun(VIDEO), sessionId: '', status: 'failed' }));
    sendNote(VIDEO, 'Try again', 'edit', 'codex');
    const run = await settle();
    expect(run.messages.at(-1)?.text).toMatch(/^New: .*The job, as first given.*Try again/s);
    expect(run.messages.some((m) => m.from === 'app')).toBe(false);
  });

  it('keeps only the end of a very long conversation', () => {
    const long = { messages: [{ from: 'john', text: 'x'.repeat(50000), at: '' }] } as ClaudeRun;
    expect(handoverPrompt(long, 'note').length).toBeLessThan(13000);
  });
});

describe('readEvent', () => {
  it("picks out Claude's words, what it's doing, and the end", () => {
    expect(readEvent('{"type":"assistant","message":{"content":[{"type":"text","text":" Done. "}]}}')).toEqual({ text: 'Done.' });
    expect(readEvent('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.md"}}]}}'))
      .toEqual({ activity: 'Read: a.md' });
    expect(readEvent('{"type":"result","subtype":"success","is_error":false}')).toEqual({ done: true });
    expect(readEvent('{"type":"result","subtype":"error_max_turns","is_error":true}').error).toMatch(/error_max_turns/);
    expect(readEvent('not json')).toEqual({});
  });
});

describe('the command line', () => {
  it('starts a new conversation the first time and continues it afterwards', () => {
    const run = { sessionId: 'abc' } as ClaudeRun;
    expect(claudeArgs(run, 'hi', true)).toContain('--session-id');
    expect(claudeArgs(run, 'hi', false)).toContain('--resume');
    expect(claudeArgs(run, 'hi', true).slice(0, 2)).toEqual(['-p', 'hi']);
  });

  it('names the skill, the video and its CapCut project', () => {
    expect(firstPrompt('D:/V/023/Longform', '023 - Test')).toMatch(/longform-edit.*D:\/V\/023\/Longform.*"023 - Test"/);
  });
});

describe('a conversation', () => {
  it('runs the first turn and keeps what Claude said', async () => {
    startEdit(VIDEO);
    const run = await settle();
    expect(run.status).toBe('idle');
    expect(run.draft).toBe(VIDEO);
    expect(run.messages.map((m) => m.from)).toEqual(['john', 'claude']);
    expect(run.messages[1].text).toMatch(/^Got: Use the longform-edit/);
  });

  it("sends John's notes to the same conversation", async () => {
    startEdit(VIDEO);
    const first = await settle();
    sendNote(VIDEO, 'The B-roll at 3:20 is in the wrong place');
    const run = await settle();
    expect(run.sessionId).toBe(first.sessionId);
    expect(run.messages.map((m) => m.text)).toContain('Got: The B-roll at 3:20 is in the wrong place');
  });

  it('one turn at a time, and Stop cuts it off but keeps the conversation', async () => {
    startEdit(VIDEO);
    await settle();
    sendNote(VIDEO, 'HANG please');
    expect(() => sendNote(VIDEO, 'another')).toThrow(/still working/);
    expect(() => startEdit(VIDEO)).toThrow(/already working/);
    const stopped = stopRun(VIDEO)!;
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toMatch(/Stopped/);
    expect(stopped.messages.length).toBeGreaterThan(2);
  });

  it('refuses a video without a Longform folder or a CapCut project, or outside the video folder', () => {
    expect(() => startEdit('../Drafts')).toThrow();
    fs.rmSync(path.join(tmp, 'Drafts', VIDEO), { recursive: true });
    expect(() => startEdit(VIDEO)).toThrow(/no CapCut project/);
    expect(() => sendNote('Nope', 'x')).toThrow(/no Longform folder/);
  });
});
