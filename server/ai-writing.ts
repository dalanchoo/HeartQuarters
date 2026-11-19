// Asks the selected AI to review a piece of John's writing (script, description, pinned comment, title, etc.)
// for anything that sounds AI-written, and suggest plain-spoken rewrites in his voice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, chosenAi, type AiId } from './ai.js';
import type { AskAi } from './brief.js';
import { askReadOnlyImage } from './expression-assessment.js';

export interface AiWritingReview {
  ai: AiId;
  aiName: string;
  review: string;
}

export function buildAiWritingPrompt(text: string, label: string): string {
  return [
    `Review the following ${label || 'text'} for John (creator of the YouTube channel Heart Mind Fusion) and flag any part that sounds like AI writing rather than a real person speaking.`,
    "John's real voice is calm, honest, personal, plain first-person storytelling. He avoids hype ('insane', 'incredible', 'game-changer'), avoids telling viewers how to feel, and avoids tacked-on moralizing conclusions or lessons.",
    'Look carefully for AI writing tells and statistical fingerprints, including:',
    '- Formulaic contrast structures ("It’s not just X, it’s Y", "Not about X — it’s about Y", "Less about X and more about Y", "No X. No Y. Just Z.")',
    '- Overused AI words and throat-clearing ("delve", "tapestry", "unpack", "nuance", "transformative", "resonates deeply", "at its core", "Here’s the thing", "The truth is")',
    '- Flat sentence rhythm (low burstiness: many sentences in a row of similar 14–18 word length, or rule-of-three adjective/clause lists)',
    '- Em-dash (—) rhetoric or overly symmetrical parallel sentences',
    '- Tacked-on summary morals ("Because ultimately...", "...is a reminder that..."), therapy-speak ("holding space", "leaning into the discomfort"), or generic YouTube hype',
    'Instructions for your reply:',
    '1. If the text already sounds natural, plain-spoken, and human, say so in one short sentence.',
    '2. For each phrase or sentence that sounds like AI, quote the exact words, explain briefly in plain English why it sounds like AI, and give a natural, plain-spoken rewrite in John’s voice.',
    '3. Keep your reply concise in Markdown. Do not change any files.',
    '--- TEXT TO CHECK ---',
    text.trim(),
  ].join('\n\n');
}

export async function checkAiWriting(
  rawText: unknown,
  rawLabel: unknown = 'Text',
  ask: AskAi = askReadOnlyImage,
): Promise<AiWritingReview> {
  const text = String(rawText ?? '').trim();
  const label = String(rawLabel ?? 'Text').trim() || 'Text';
  if (!text) throw new Error('There is no text to check yet.');
  if (text.length > 40_000) throw new Error('That text is too long to check all at once (maximum 40,000 characters).');

  const ai = chosenAi();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-ai-writing-'));
  try {
    const answer = (await ask(ai, buildAiWritingPrompt(text, label), work)).trim();
    return { ai, aiName: AI_NAMES[ai], review: answer || 'No issues found.' };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
