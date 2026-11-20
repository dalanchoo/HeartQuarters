// Asks the selected AI to review a piece of John's writing (script, description, pinned comment, title, etc.)
// for anything that sounds AI-written, and suggest plain-spoken rewrites in his voice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, chosenAi, type AiId } from './ai.js';
import type { AskAi } from './brief.js';
import { askReadOnlyImage } from './expression-assessment.js';

/** One rewrite: `find` is a whole sentence (or phrase) copied exactly from the text, `replace` what to put instead. */
export interface AiWritingSuggestion {
  find: string;
  replace: string;
  why: string;
}

export interface AiWritingReview {
  ai: AiId;
  aiName: string;
  /** A short overall verdict, or the AI's whole answer when it didn't give a list. */
  review: string;
  /** In the order they appear in the text. Only rewrites whose `find` is really in the text are kept. */
  suggestions: AiWritingSuggestion[];
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
    'Reply with JSON only, no other writing, in exactly this shape:',
    '{"summary": "one short sentence overall", "suggestions": [{"find": "...", "replace": "...", "why": "..."}]}',
    'Rules for each suggestion:',
    '- "find" is the WHOLE sentence (or whole line) that should change, copied character for character from the text, including its punctuation. Never a fragment of a sentence, and never text that isn’t in the text.',
    '- "replace" is the WHOLE new sentence to put in its place, in John’s plain-spoken voice. It replaces all of "find".',
    '- "why" says briefly, in plain English, why the original sounds like AI.',
    '- List suggestions in the order they appear in the text. Don’t let two suggestions cover the same words.',
    'If the text already sounds natural and human, give an empty "suggestions" list and say so in "summary". Do not change any files.',
    '--- TEXT TO CHECK ---',
    text.trim(),
  ].join('\n\n');
}

/**
 * Reads the AI's answer. Keeps suggestions whose `find` is in the text, sorted by where they appear, dropping any
 * that overlap an earlier one. An answer that isn't the JSON asked for is shown as it is, with no suggestions.
 */
export function parseAiWritingAnswer(answer: string, text: string): { review: string; suggestions: AiWritingSuggestion[] } {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  let data: unknown;
  try { data = start >= 0 && end > start ? JSON.parse(answer.slice(start, end + 1)) : undefined; } catch { data = undefined; }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { suggestions?: unknown }).suggestions)) return { review: answer || 'No issues found.', suggestions: [] };
  const raw = (data as { suggestions: unknown[] }).suggestions;
  const found = raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ find: String(s.find ?? ''), replace: String(s.replace ?? ''), why: String(s.why ?? '') }))
    .filter((s) => s.find && s.find !== s.replace)
    .map((s) => ({ s, at: text.indexOf(s.find) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  const suggestions: AiWritingSuggestion[] = [];
  let reached = 0;
  for (const { s, at } of found) {
    if (at < reached) continue;
    suggestions.push(s);
    reached = at + s.find.length;
  }
  const summary = String((data as { summary?: unknown }).summary ?? '').trim();
  return { review: summary || (suggestions.length ? '' : 'No issues found.'), suggestions };
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
    return { ai, aiName: AI_NAMES[ai], ...parseAiWritingAnswer(answer, text) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
