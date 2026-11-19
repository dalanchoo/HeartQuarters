// Whether each AI is signed in, and opening its sign-in. Fake programs only: no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { aiModelArgs, aiOverview, availableModels, chooseAi, chooseAiModel, chosenModel, parseGeminiModels, rememberGeminiModels, runAiProcess } from './ai';
import { aiSignIns, openSignIn, readSignIn, type Runner } from './ai-signin';
import { makeTree, removeTree } from './testing';

describe('reading each AI sign-in check', () => {
  it('Claude: its JSON says whether it is signed in', () => {
    expect(readSignIn('claude', { code: 0, out: '{"loggedIn": true, "email": "a@b.c"}' })).toEqual({ state: 'in', detail: 'Signed in as a@b.c' });
    expect(readSignIn('claude', { code: 0, out: '{"loggedIn": false, "authMethod": "none"}' }).state).toBe('out');
    expect(readSignIn('claude', { code: 1, out: 'something else' }).state).toBe('unknown');
  });
  it('ChatGPT: "Logged in" or "Not logged in"', () => {
    expect(readSignIn('codex', { code: 0, out: 'Logged in using ChatGPT\n' })).toEqual({ state: 'in', detail: 'Logged in using ChatGPT' });
    expect(readSignIn('codex', { code: 1, out: 'Not logged in\n' }).state).toBe('out');
  });
  it('Gemini: signed in when it can list its models', () => {
    expect(readSignIn('gemini', { code: 0, out: 'Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon\n' }).state).toBe('in');
    expect(readSignIn('gemini', { code: 1, out: 'Please sign in\n' })).toEqual({ state: 'out', detail: 'Please sign in' });
    expect(readSignIn('gemini', { code: null, out: "Couldn't start it: not found" }).state).toBe('unknown');
  });
});

describe('checking all three', () => {
  it('asks each program its own question', async () => {
    const run = vi.fn<Runner>().mockImplementation(async (_cmd, args) =>
      args.includes('auth') ? { code: 0, out: '{"loggedIn": false}' } : args.includes('login') ? { code: 0, out: 'Logged in using ChatGPT' } : { code: 0, out: 'gemini-4\tGemini 4' },
    );
    const result = await aiSignIns(run);
    expect(result.map((r) => [r.name, r.state])).toEqual([['Claude', 'out'], ['ChatGPT', 'in'], ['Gemini', 'in']]);
    expect(run.mock.calls.map((c) => c[1].slice(-2))).toEqual([['auth', 'status'], ['login', 'status'], expect.arrayContaining(['models'])]);
  });
});

describe('opening a sign-in', () => {
  it('starts only the known AI programs, each with its sign-in command', () => {
    const open = vi.fn();
    expect(openSignIn('claude', open)).toEqual({ name: 'Claude' });
    expect(open.mock.calls[0][1].slice(-2)).toEqual(['auth', 'login']);
    openSignIn('codex', open);
    expect(open.mock.calls[1][1].at(-1)).toBe('login');
    expect(() => openSignIn('calc.exe', open)).toThrow(/Unknown AI/);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('runAiProcess', () => {
  it('captures stdout, handles missing executables, and kills timed-out processes', async () => {
    const ok = await runAiProcess(process.execPath, ['-e', 'console.log("hello")'], { cwd: process.cwd(), timeoutMs: 5000 });
    expect(ok).toMatchObject({ code: 0, timedOut: false });
    expect(ok.stdout.trim()).toBe('hello');

    const missing = await runAiProcess('definitely-not-a-real-binary-hq', [], { cwd: process.cwd(), timeoutMs: 5000 });
    expect(missing.code).toBeNull();
    expect(missing.startError).toBeTruthy();

    const slow = await runAiProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { cwd: process.cwd(), timeoutMs: 150 });
    expect(slow.timedOut).toBe(true);
  });
});

describe('per-AI model selection and catalog discovery', () => {
  it('remembers a chosen model per AI across AI switches and formats CLI model args', () => {
    const tmp = makeTree({});
    const oldFile = process.env.HQ_AI_FILE;
    process.env.HQ_AI_FILE = path.join(tmp, 'ai-choice.json');
    try {
      expect(chosenModel('claude')).toBe('');
      expect(aiModelArgs('claude')).toEqual([]);
      chooseAiModel('claude', 'claude-opus-5-5');
      chooseAiModel('codex', 'gpt-6.2-sol');
      chooseAi('gemini');
      chooseAiModel('gemini', 'gemini-4-argon-medium');
      expect(chosenModel('claude')).toBe('claude-opus-5-5');
      expect(chosenModel('codex')).toBe('gpt-6.2-sol');
      expect(chosenModel('gemini')).toBe('gemini-4-argon-medium');
      expect(aiModelArgs('claude')).toEqual(['--model', 'claude-opus-5-5']);
      expect(aiModelArgs('codex')).toEqual(['-c', 'model="gpt-6.2-sol"']);
      expect(aiModelArgs('gemini')).toEqual(['--model', 'gemini-4-argon-medium']);
      expect(aiOverview().options.map((o) => [o.id, o.model])).toEqual([
        ['claude', 'claude-opus-5-5'],
        ['codex', 'gpt-6.2-sol'],
        ['gemini', 'gemini-4-argon-medium'],
      ]);
      expect(() => chooseAiModel('claude', 'bad model; rm -rf')).toThrow(/Invalid model/);
      chooseAiModel('claude', '');
      expect(chosenModel('claude')).toBe('');
    } finally {
      if (oldFile === undefined) delete process.env.HQ_AI_FILE;
      else process.env.HQ_AI_FILE = oldFile;
      removeTree(tmp);
    }
  });

  it('reads local Claude and Codex model catalogs and parses Gemini models', () => {
    const home = makeTree({
      '.claude/settings.json': JSON.stringify({ model: 'claude-sonnet-5-5' }),
      '.claude/cache/model-catalog/abc-cc.json': JSON.stringify({
        catalog: { config: { models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }, { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' }] } },
      }),
      '.codex/config.toml': 'model = "gpt-6-sol"\n',
      '.codex/models_cache.json': JSON.stringify({
        models: [
          { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', visibility: 'list' },
          { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list' },
          { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide' },
        ],
      }),
    });
    try {
      const claude = availableModels('claude', home);
      expect(claude.defaultLabel).toBe('Default (Sonnet 5.5)');
      expect(claude.models).toEqual([
        { id: 'claude-opus-5-5', label: 'Opus 5.5' },
        { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
      ]);
      const codex = availableModels('codex', home);
      expect(codex.defaultLabel).toBe('Default (GPT-6-Sol)');
      expect(codex.models).toEqual([
        { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol' },
        { id: 'gpt-6-sol', label: 'GPT-6-Sol' },
      ]);
      const geminiList = parseGeminiModels('Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\n');
      expect(geminiList).toEqual([
        { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
        { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
      ]);
      rememberGeminiModels(geminiList);
      expect(availableModels('gemini', home).defaultLabel).toBe('Default (Gemini 4 Neon (High))');
    } finally {
      removeTree(home);
    }
  });
});
