import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import { config } from './config';
import {
  BRAINSTORMS_DIR,
  buildBrainstormPrompt,
  clearBrainstorm,
  linkedPieces,
  readBrainstorm,
  sendBrainstormMessage,
} from './idea-brainstorm';
import { makeTree, removeTree } from './testing';
import { addAttachment, addIdea, addReference } from './video-ideas';

let root: string;
let saved: string;
let savedWriting: string;

beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '', 'Writing/My Journey/': '' });
  saved = config.videoProjectsDir;
  savedWriting = config.writingDir;
  config.videoProjectsDir = path.join(root, 'Projects');
  config.writingDir = path.join(root, 'Writing');
});

afterEach(() => {
  config.videoProjectsDir = saved;
  config.writingDir = savedWriting;
  vi.restoreAllMocks();
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

  it('copies attached files into the AI working folder so any AI can read them', async () => {
    const [idea] = addIdea('SDAM Guide');
    addAttachment(idea.id, 'SDAM Guide.pdf', Buffer.from('%PDF-1.4\ntest'), 'Intro guide');

    let sawPdf = false;
    let promptSeen = '';
    const fakeAsk = async (_ai: 'claude' | 'codex' | 'gemini', prompt: string, cwd: string) => {
      promptSeen = prompt;
      sawPdf = fs.existsSync(path.join(cwd, 'SDAM Guide.pdf'));
      return 'Read it!';
    };

    await sendBrainstormMessage(idea.id, 'gemini', 'Summarize [Attached File: SDAM Guide.pdf]', fakeAsk);
    expect(sawPdf).toBe(true);
    expect(promptSeen).toContain('SDAM Guide.pdf — Intro guide');
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

  it('turns #Videos/ links back into the pieces they point to', () => {
    expect(linkedPieces('#Videos/001%20-%20Video')).toEqual(['001 - Video/Longform', '001 - Video']);
    expect(linkedPieces('#Videos/005%20-%20Series%2F005B%20-%20Part')).toEqual(['005 - Series/005B - Part/Longform', '005 - Series/005B - Part']);
    expect(linkedPieces('#Videos/002%20-%20Video/002%20-%20Video%2FShorts%2FS01')).toEqual(['002 - Video/Shorts/S01']);
    expect(linkedPieces('https://youtube.com/watch?v=x')).toEqual([]);
    expect(linkedPieces('#Videos/%E0%A4%A')).toEqual([]);
  });

  it('gives the AI the transcript of every linked HeartQuarters video by default', async () => {
    const subtitles = path.join(config.videoProjectsDir, '001 - Video', 'Longform', 'Subtitles');
    fs.mkdirSync(subtitles, { recursive: true });
    fs.writeFileSync(path.join(subtitles, '001-captions.txt'), 'What I actually said on camera.');

    const [idea] = addIdea('Follow-up idea');
    addReference(idea.id, { url: '#Videos/001%20-%20Video', note: '001 - Video' });
    addReference(idea.id, { url: '#Videos/999%20-%20Gone', note: 'Moved away' });
    addReference(idea.id, { url: 'https://example.com', note: 'Web page' });

    let prompt = '';
    let folder: Record<string, string> = {};
    const fakeAsk = async (_ai: 'claude' | 'codex' | 'gemini', p: string, work: string) => {
      prompt = p;
      folder = Object.fromEntries(fs.readdirSync(work).map((f) => [f, fs.readFileSync(path.join(work, f), 'utf8')]));
      return 'ok';
    };
    await sendBrainstormMessage(idea.id, 'claude', 'What should the follow-up cover?', fakeAsk);

    expect(Object.keys(folder)).toEqual(['Linked Video 1 Transcript.txt']);
    expect(folder['Linked Video 1 Transcript.txt']).toContain('What I actually said on camera.');
    expect(prompt).toContain('#Videos/001%20-%20Video — 001 - Video (its transcript is in your working folder: Linked Video 1 Transcript.txt)');
    expect(prompt).toContain('#Videos/999%20-%20Gone — Moved away\n');
  });

  it('gives the AI the matching .docx draft text of a linked local Substack entry', async () => {
    const draftsDir = path.join(config.writingDir, 'My Journey', '2024-06-08 – Dad\'s Death', 'Drafts');
    fs.mkdirSync(draftsDir, { recursive: true });
    fs.writeFileSync(path.join(draftsDir, '2024-06-08 - Brainstorm.docx'), 'other');
    fs.writeFileSync(path.join(draftsDir, '2024-06-08 – Dad\'s Death.docx'), 'main');

    const spy = vi.spyOn(mammoth, 'extractRawText').mockImplementation(async (opts) => ({
      value: (opts as { path?: string }).path?.includes("Dad's Death.docx") ? 'Body of the Substack post about Dad.' : 'Brainstorm notes.',
      messages: [],
    }));

    const [idea] = addIdea('SDAM and grief');
    addReference(idea.id, { url: '#Substack/My%20Journey%2F2024-06-08%20%E2%80%93%20Dad\'s%20Death', note: "2024-06-08 – Dad's Death" });

    let prompt = '';
    let folder: Record<string, string> = {};
    await sendBrainstormMessage(idea.id, 'claude', 'How does this fit?', async (_ai, p, work) => {
      prompt = p;
      folder = Object.fromEntries(fs.readdirSync(work).map((f) => [f, fs.readFileSync(path.join(work, f), 'utf8')]));
      return 'ok';
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(folder)).toEqual(['Linked Substack 1.txt']);
    expect(folder['Linked Substack 1.txt']).toContain('Body of the Substack post about Dad.');
    expect(prompt).toContain("(its text is in your working folder: Linked Substack 1.txt)");
  });

  it('refuses to read or write through a shortcut or junction', async () => {
    const [idea] = addIdea('Junction check');
    const elsewhere = path.join(root, 'Elsewhere');
    fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(path.join(config.videoProjectsDir, BRAINSTORMS_DIR)), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(config.videoProjectsDir, BRAINSTORMS_DIR), 'junction');
    expect(() => readBrainstorm(idea.id)).toThrow();
    await expect(sendBrainstormMessage(idea.id, 'claude', 'Hello')).rejects.toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});
