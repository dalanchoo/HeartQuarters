import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import {
  BRAINSTORMS_DIR,
  buildBrainstormPrompt,
  clearBrainstorm,
  readBrainstorm,
  sendBrainstormMessage,
} from './idea-brainstorm';
import { makeTree, removeTree } from './testing';
import { addIdea, addReference } from './video-ideas';

let root: string;
let saved: string;

beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '' });
  saved = config.videoProjectsDir;
  config.videoProjectsDir = path.join(root, 'Projects');
});

afterEach(() => {
  config.videoProjectsDir = saved;
  removeTree(root);
});

describe('idea brainstorm', () => {
  it('starts empty without creating files until the first message', () => {
    const [idea] = addIdea('Test idea');
    expect(readBrainstorm(idea.id)).toEqual({ version: 1, ideaId: idea.id, messages: [] });
    expect(fs.existsSync(path.join(config.videoProjectsDir, BRAINSTORMS_DIR))).toBe(false);
  });

  it('saves turns to Drive and gives each AI the full idea and conversation context', async () => {
    const [idea] = addIdea('Fear brings itself about', 'Viktor Frankl quote');
    addReference(idea.id, { url: 'https://example.com/frankl', note: 'Chapter 2' });

    const seen: { ai: string; prompt: string }[] = [];
    const fakeAsk = async (ai: 'claude' | 'codex' | 'gemini', prompt: string) => {
      seen.push({ ai, prompt });
      return `Reply from ${ai}`;
    };

    const afterClaude = await sendBrainstormMessage(idea.id, 'claude', 'What angle fits best?', fakeAsk);
    expect(afterClaude.messages.map((m) => [m.from, m.text])).toEqual([
      ['john', 'What angle fits best?'],
      ['claude', 'Reply from claude'],
    ]);

    const afterCodex = await sendBrainstormMessage(idea.id, 'codex', 'Challenge that angle.', fakeAsk);
    expect(afterCodex.messages.map((m) => [m.from, m.text])).toEqual([
      ['john', 'What angle fits best?'],
      ['claude', 'Reply from claude'],
      ['john', 'Challenge that angle.'],
      ['codex', 'Reply from codex'],
    ]);

    expect(seen[1].ai).toBe('codex');
    expect(seen[1].prompt).toContain('Fear brings itself about');
    expect(seen[1].prompt).toContain('Viktor Frankl quote');
    expect(seen[1].prompt).toContain('https://example.com/frankl — Chapter 2');
    expect(seen[1].prompt).toContain('[John]\nWhat angle fits best?');
    expect(seen[1].prompt).toContain('[Claude]\nReply from claude');
    expect(seen[1].prompt).toContain("--- JOHN'S NEW MESSAGE ---\nChallenge that angle.");

    // Reading back from Drive returns the same messages.
    expect(readBrainstorm(idea.id).messages).toEqual(afterCodex.messages);

    // Clearing resets messages in Drive.
    expect(clearBrainstorm(idea.id).messages).toEqual([]);
    expect(readBrainstorm(idea.id).messages).toEqual([]);
  });

  it('builds a prompt with empty fallbacks when notes and references are missing', () => {
    const [idea] = addIdea('Bare idea');
    const prompt = buildBrainstormPrompt(idea, [], 'First thought', 'gemini');
    expect(prompt).toContain('You are Gemini');
    expect(prompt).toContain('Notes:\n(none)');
    expect(prompt).toContain('References:\n(none)');
    expect(prompt).toContain('(no messages yet)');
  });

  it('rejects bad idea IDs, invalid AIs, empty messages, and missing ideas', async () => {
    const [idea] = addIdea('Valid idea');
    await expect(sendBrainstormMessage('../escape', 'claude', 'Hi')).rejects.toThrow('valid idea');
    await expect(sendBrainstormMessage(idea.id, 'other', 'Hi')).rejects.toThrow('Claude, ChatGPT, or Gemini');
    await expect(sendBrainstormMessage(idea.id, 'claude', '   ')).rejects.toThrow('Type a message');
    await expect(sendBrainstormMessage('missing-id', 'claude', 'Hi')).rejects.toThrow('no longer on the list');
  });

  it('refuses to read or write through a shortcut or junction', async () => {
    const [idea] = addIdea('Junction check');
    const elsewhere = path.join(root, 'Elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(config.videoProjectsDir, BRAINSTORMS_DIR), 'junction');
    expect(() => readBrainstorm(idea.id)).toThrow();
    await expect(sendBrainstormMessage(idea.id, 'claude', 'Hello')).rejects.toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});
