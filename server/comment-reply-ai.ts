// Asks the AI John chose to draft a reply to one viewer comment, in John's voice, plus a short note on why.
// Nothing is posted or saved: the draft goes into the reply box, where John edits it and posts it himself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, parseAi, type AiId } from './ai.js';
import type { AskAi } from './brief.js';
import { readVideoComments, type StoredCommentThread } from './channel-comments.js';
import { askReadOnlyImage } from './expression-assessment.js';

export interface CommentReplyDraft {
  ai: AiId;
  aiName: string;
  /** The reply to put in the reply box. */
  reply: string;
  /** A few sentences on what the AI noticed in the comment and why it answered this way. */
  thoughts: string;
}

export function buildCommentReplyPrompt(thread: StoredCommentThread, videoTitle: string, notes: string): string {
  const earlier = thread.replies.map((r) => `- ${r.isOwner ? 'John (channel owner)' : r.author || 'Viewer'}: ${r.text}`);
  return [
    "Draft a reply from John, creator of the YouTube channel Heart Mind Fusion, to a viewer's comment on one of his videos.",
    "John's voice is calm, honest, warm and personal: plain first-person words, like a real person typing a reply. No hype, no telling the viewer how to feel, no therapy-speak, no tacked-on lessons, no em-dashes, no hashtags, no emojis unless the viewer used them. Keep it short (usually one to three sentences). Answer any question the viewer asked; if you don't know the answer, don't make one up.",
    'Reply with JSON only, no other writing, in exactly this shape:',
    '{"reply": "the reply text", "thoughts": "two or three short sentences: what the viewer seems to want or feel, and why the reply is written this way"}',
    'Do not change any files.',
    `--- VIDEO TITLE ---\n${videoTitle.trim() || '(unknown)'}`,
    `--- COMMENT by ${thread.author || 'a viewer'} ---\n${thread.text.trim()}`,
    ...(earlier.length ? [`--- REPLIES SO FAR ---\n${earlier.join('\n')}`] : []),
    ...(notes.trim() ? [`--- JOHN'S NOTES OR DRAFT (follow these; build the reply from them) ---\n${notes.trim()}`] : []),
  ].join('\n\n');
}

/** Reads the AI's answer. An answer that isn't the JSON asked for becomes the reply as it is, with no thoughts. */
export function parseCommentReplyAnswer(answer: string): { reply: string; thoughts: string } {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  let data: unknown;
  try { data = start >= 0 && end > start ? JSON.parse(answer.slice(start, end + 1)) : undefined; } catch { data = undefined; }
  const reply = data && typeof data === 'object' ? String((data as { reply?: unknown }).reply ?? '').trim() : '';
  if (!reply) return { reply: answer.trim(), thoughts: '' };
  return { reply, thoughts: String((data as { thoughts?: unknown }).thoughts ?? '').trim() };
}

export async function draftCommentReply(
  rawVideoId: unknown,
  rawCommentId: unknown,
  rawAi: unknown = 'claude',
  rawTitle: unknown = '',
  rawNotes: unknown = '',
  ask: AskAi = askReadOnlyImage,
): Promise<CommentReplyDraft> {
  const file = readVideoComments(rawVideoId);
  if (!file) throw new Error("This video's comments haven't been downloaded yet.");
  const thread = file.threads.find((t) => t.topLevelCommentId === rawCommentId || t.id === rawCommentId);
  if (!thread) throw new Error('That comment is not in the downloaded comments. Refresh the comments and try again.');
  const notes = String(rawNotes ?? '').slice(0, 5000);
  const title = String(rawTitle ?? '').slice(0, 300);

  const ai = parseAi(rawAi);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-comment-reply-'));
  try {
    const answer = (await ask(ai, buildCommentReplyPrompt(thread, title, notes), work)).trim();
    const parsed = parseCommentReplyAnswer(answer);
    if (!parsed.reply) throw new Error(`${AI_NAMES[ai]} gave no reply. Try again.`);
    return { ai, aiName: AI_NAMES[ai], ...parsed };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
