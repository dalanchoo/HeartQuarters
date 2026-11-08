// "Edit with Claude", tested with a fake Claude: a small script that prints what Claude Code prints. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appDir, config } from './config';
import { claudeArgs, firstPrompt, getRun, readEvent, sendNote, startEdit, stopRun, type ClaudeRun } from './claude';
import { makeTree, removeTree } from './testing';

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
let saved: { projects: string; drafts: string; cmd: string[] };
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
  });
  saved = { projects: config.videoProjectsDir, drafts: config.capcutDraftsDir, cmd: config.claudeCommand };
  config.videoProjectsDir = path.join(tmp, 'Videos');
  config.capcutDraftsDir = path.join(tmp, 'Drafts');
  config.claudeCommand = [process.execPath, path.join(tmp, 'fake-claude.cjs')];
});

afterEach(() => {
  stopRun(VIDEO);
  fs.rmSync(path.join(appDir, 'data', 'claude', `${VIDEO}.json`), { force: true });
  config.videoProjectsDir = saved.projects;
  config.capcutDraftsDir = saved.drafts;
  config.claudeCommand = saved.cmd;
  removeTree(tmp);
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
