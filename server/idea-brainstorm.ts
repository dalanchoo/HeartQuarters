// Brainstorming conversations for Video Ideas, stored in Drive under Video Projects\_Brainstorms\<idea-id>.json.
// Any of the three AIs (Claude, ChatGPT, Gemini) can be called on any turn and receives the full idea + thread context.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, isAiId, type AiId } from './ai.js';
import type { AskAi } from './brief.js';
import { safeResolve } from './config.js';
import { askReadOnlyImage } from './expression-assessment.js';
import { makeFolder, readable, readText, writable, writeFile } from './safe-files.js';
import { readIdeas, type VideoIdea } from './video-ideas.js';

export const BRAINSTORMS_DIR = '_Brainstorms';
const IDEA_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MESSAGE_MAX = 20_000;

export interface BrainstormMessage {
  id: string;
  from: 'john' | AiId;
  text: string;
  at: string;
}

export interface IdeaBrainstorm {
  version: 1;
  ideaId: string;
  messages: BrainstormMessage[];
}

const activeBrainstorms = new Set<string>();

function checkIdeaId(ideaId: unknown): string {
  if (typeof ideaId !== 'string' || !IDEA_ID_RE.test(ideaId)) {
    throw new Error('Choose a valid idea.');
  }
  return ideaId;
}

function brainstormFolder(forWrite: boolean): string {
  const dir = safeResolve('projects', BRAINSTORMS_DIR);
  if (forWrite) {
    makeFolder(dir);
    return writable(dir);
  }
  return dir;
}

function brainstormFile(ideaId: string, forWrite: boolean): string {
  const dir = brainstormFolder(forWrite);
  const file = path.join(dir, `${ideaId}.json`);
  return forWrite ? writable(file) : readable(file);
}

function emptyBrainstorm(ideaId: string): IdeaBrainstorm {
  return { version: 1, ideaId, messages: [] };
}

function validMessage(m: unknown): m is BrainstormMessage {
  const item = m as BrainstormMessage;
  return !!item
    && typeof item.id === 'string'
    && (item.from === 'john' || isAiId(item.from))
    && typeof item.text === 'string'
    && typeof item.at === 'string';
}

/** Reads the saved brainstorm thread for one idea, or returns an empty thread if none exists yet. */
export function readBrainstorm(rawIdeaId: unknown): IdeaBrainstorm {
  const ideaId = checkIdeaId(rawIdeaId);
  const dir = brainstormFolder(false);
  if (!fs.existsSync(dir)) return emptyBrainstorm(ideaId);
  readable(dir);
  const candidate = path.join(dir, `${ideaId}.json`);
  if (!fs.existsSync(candidate)) return emptyBrainstorm(ideaId);
  const raw = readText(brainstormFile(ideaId, false));
  let parsed: { version?: unknown; ideaId?: unknown; messages?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('The brainstorm file could not be read. Nothing was changed.');
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.messages) || !parsed.messages.every(validMessage)) {
    throw new Error('The brainstorm file has an unexpected format. Nothing was changed.');
  }
  return { version: 1, ideaId, messages: parsed.messages };
}

function saveBrainstorm(data: IdeaBrainstorm) {
  const file = brainstormFile(data.ideaId, true);
  writeFile(file, JSON.stringify(data, null, 2) + '\n');
}

function speakerLabel(from: BrainstormMessage['from']): string {
  return from === 'john' ? 'John' : AI_NAMES[from];
}

/** Builds the full-context prompt passed to whichever AI John sends the next turn to. */
export function buildBrainstormPrompt(
  idea: VideoIdea,
  history: BrainstormMessage[],
  nextMessage: string,
  ai: AiId,
): string {
  const refs = idea.references.length
    ? idea.references.map((r, i) => `${i + 1}. ${r.url}${r.note ? ` — ${r.note}` : ''}`).join('\n')
    : '(none)';
  const files = idea.attachments.length
    ? idea.attachments.map((a, i) => `${i + 1}. ${a.name}${a.note ? ` — ${a.note}` : ''}`).join('\n')
    : '(none)';
  const thread = history.length
    ? history.map((m) => `[${speakerLabel(m.from)}]\n${m.text}`).join('\n\n')
    : '(no messages yet)';
  return [
    `You are ${AI_NAMES[ai]}, brainstorming a YouTube video idea with John (creator of Heart Mind Fusion).`,
    "John's voice is calm, honest, personal, and plain-spoken. Help him explore angles, hooks, structure, and weak spots without generic hype.",
    'Do not create, edit, or delete any files. Reply directly with your thoughts.',
    [
      '--- IDEA DETAILS ---',
      `Title: ${idea.title}`,
      `Category: ${idea.category} | Format: ${idea.format} | Status: ${idea.status}`,
      `Notes:\n${idea.notes.trim() || '(none)'}`,
      `References:\n${refs}`,
      `Attached Files:\n${files}`,
    ].join('\n'),
    `--- CONVERSATION SO FAR ---\n${thread}`,
    `--- JOHN'S NEW MESSAGE ---\n${nextMessage}`,
  ].join('\n\n');
}

/** Sends a brainstorm message to the chosen AI, saving both John's note and the AI's reply to Drive. */
export async function sendBrainstormMessage(
  rawIdeaId: unknown,
  rawAi: unknown,
  rawMessage: unknown,
  ask: AskAi = askReadOnlyImage,
): Promise<IdeaBrainstorm> {
  const ideaId = checkIdeaId(rawIdeaId);
  if (!isAiId(rawAi)) throw new Error('Choose Claude, ChatGPT, or Gemini.');
  if (typeof rawMessage !== 'string') throw new Error('Type a message first.');
  const message = rawMessage.trim();
  if (!message) throw new Error('Type a message first.');
  if (message.length > MESSAGE_MAX) throw new Error('That message is too long.');

  const idea = readIdeas().find((item) => item.id === ideaId);
  if (!idea) throw new Error('That idea is no longer on the list. Reload it and try again.');

  if (activeBrainstorms.has(ideaId)) {
    throw new Error('An AI is already replying to this idea. Wait a moment and try again.');
  }
  activeBrainstorms.add(ideaId);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-brainstorm-'));
  try {
    const current = readBrainstorm(ideaId);
    const historyBefore = [...current.messages];
    current.messages.push({ id: randomUUID(), from: 'john', text: message, at: new Date().toISOString() });
    saveBrainstorm(current);

    const prompt = buildBrainstormPrompt(idea, historyBefore, message, rawAi);
    const answer = (await ask(rawAi, prompt, work)).trim();
    if (!answer) throw new Error(`${AI_NAMES[rawAi]} returned an empty reply.`);

    const latest = readBrainstorm(ideaId);
    latest.messages.push({ id: randomUUID(), from: rawAi, text: answer, at: new Date().toISOString() });
    saveBrainstorm(latest);
    return latest;
  } finally {
    activeBrainstorms.delete(ideaId);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Clears all messages in an idea's brainstorm thread. */
export function clearBrainstorm(rawIdeaId: unknown): IdeaBrainstorm {
  const ideaId = checkIdeaId(rawIdeaId);
  if (activeBrainstorms.has(ideaId)) {
    throw new Error('Wait for the current AI reply to finish before clearing.');
  }
  const empty = emptyBrainstorm(ideaId);
  saveBrainstorm(empty);
  return empty;
}
