// Whether each AI is signed in, and opening its sign-in. Fake programs only: no real AI runs.
import { describe, expect, it, vi } from 'vitest';
import { aiSignIns, openSignIn, readSignIn, type Runner } from './ai-signin';

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
