// Discuss: a back-and-forth text conversation with any AI about one thumbnail draft, before (or instead of) making a new
// image (John, 2026-11-25). The AI sees the image shown, the draft's title and thumbnail words, the brief, the video's
// source and the channel's skills, and the whole conversation so far. It never makes images or changes files. When John
// and the AI agree on a change, the AI writes it under "### Change Request", which the page can put in Ask for Changes.
// One discussion per draft conversation, saved on this computer like Ask for Feedback's reviews, never in Drive.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, isAiId, type AiId } from './ai.js';
import { ACCURACY_RULE, THUMBNAIL_EXPRESSION_GUIDANCE, type AskAi } from './brief.js';
import { appDir } from './config.js';
import { askReadOnlyImage } from './expression-assessment.js';
import { writeFileSafely } from './files.js';
import { checkedImage, checkedPick, prepareDraftFolder } from './thumbnail-feedback.js';
import { isShort } from './thumbnails.js';

export interface DiscussionMessage { id: string; from: 'john' | AiId; text: string; at: string; /** The draft image shown when John wrote it. */ image?: string; /** In an AI's reply: its "### Change Request" section. */ changeRequest?: string }
export interface DiscussionJob { ai: AiId; state: 'working' | 'failed'; error?: string }
export const MESSAGE_MAX = 4000;

const storage = () => process.env.HQ_THUMB_DISCUSSION_DIR ?? path.join(appDir, 'data', 'thumbnail-discussions');
/** The discussion belongs to the draft conversation, so it carries on across the images made in it. */
const keyFor = (piece: string, conversation: string) => createHash('sha256').update(JSON.stringify([piece.toLowerCase(), path.resolve(conversation).toLowerCase()])).digest('hex');
const jobs = new Map<string, DiscussionJob>();

function fileFor(piece: string, image: string) {
  const checked = checkedImage(piece, image);
  return { ...checked, key: keyFor(piece, checked.conversation), file: path.join(storage(), `${keyFor(piece, checked.conversation)}.json`) };
}

function readMessages(file: string): DiscussionMessage[] {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { messages?: unknown };
    return Array.isArray(value.messages) ? (value.messages as DiscussionMessage[]).filter(m => m && typeof m.text === 'string' && (m.from === 'john' || isAiId(m.from))) : [];
  } catch { return []; }
}
function saveMessages(file: string, messages: DiscussionMessage[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileSafely(file, JSON.stringify({ messages }, null, 2));
}

/** The conversation about a draft so far, and whether an AI is replying. */
export function readDiscussion(piece: string, image: string): { messages: DiscussionMessage[]; job: DiscussionJob | null } {
  const { file, key } = fileFor(piece, image);
  return { messages: readMessages(file), job: jobs.get(key) ?? null };
}

/** Start Over: forgets the conversation about this draft. */
export function clearDiscussion(piece: string, image: string): void {
  const { file, key } = fileFor(piece, image);
  if (jobs.get(key)?.state === 'working') throw new Error('Wait for the reply, then start over.');
  jobs.delete(key);
  fs.rmSync(file, { force: true });
}

const speaker = (from: DiscussionMessage['from']) => (from === 'john' ? 'John' : AI_NAMES[from]);

export function discussionPrompt(ai: AiId, image: string, pick: unknown, history: DiscussionMessage[], message: string, files: { source: boolean; brief: boolean; skills: string[] }, short: boolean): string {
  const thread = history.length ? history.map(m => `[${speaker(m.from)}]\n${m.text}`).join('\n\n') : '(this is the first message)';
  return [
    `You are ${AI_NAMES[ai]}, talking with John, the creator of Heart Mind Fusion, about a thumbnail draft for ${short ? 'a vertical YouTube Short' : 'a longform YouTube video'}. The draft image is attached and saved at ${image}. Look at it before you answer.`,
    'This is a conversation, not a review: answer what John asks or says, briefly and plainly, and ask him a question when you need to know something. Disagree when you have reason to. Skip generic YouTube advice.',
    files.source ? 'The video\'s script or transcript is in source.txt in the current folder. Read it before saying what the video does or does not contain; do not invent facts.' : 'No script or transcript is available. Do not claim to know what the video contains.',
    ...(files.brief ? ['The packaging brief is in brief.md in the current folder.'] : []),
    ...(files.skills.length ? [`The channel's thumbnail guidance is in the current folder: ${files.skills.join(', ')}.`] : []),
    ACCURACY_RULE,
    THUMBNAIL_EXPRESSION_GUIDANCE,
    `The draft's packaging (title, thumbnail words and concept):\n${JSON.stringify(pick ?? null, null, 2)}`,
    'Do not make or edit an image, use image generation, or change any file. When John asks you to, or you and he have settled on a change to this image, end your reply with a section "### Change Request" holding only the request for the image AI, written to the AI that made the draft, in a few plain sentences it can follow on its own.',
    `--- CONVERSATION SO FAR ---\n${thread}`,
    `--- JOHN'S NEW MESSAGE ---\n${message}`,
    'Reply in Markdown.',
  ].join('\n\n');
}

/** Sends John's message about the draft image to the chosen AI. His message is saved at once; the reply when it comes. */
export function sendDiscussionMessage(piece: string, image: string, rawAi: unknown, rawMessage: unknown, ask: AskAi = askReadOnlyImage): { job: DiscussionJob; finished: Promise<void> } {
  if (!isAiId(rawAi)) throw new Error('Choose Claude, ChatGPT, or Gemini.');
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) throw new Error('Type a message first.');
  const message = rawMessage.trim();
  if (message.length > MESSAGE_MAX) throw new Error('That message is too long.');
  const { pieceDir, imageFile, conversation, file, key } = fileFor(piece, image);
  if (jobs.get(key)?.state === 'working') throw new Error('An AI is already replying in this discussion.');
  const pick = checkedPick(conversation);
  const history = readMessages(file);
  saveMessages(file, [...history, { id: randomUUID(), from: 'john', text: message, at: new Date().toISOString(), image }]);
  const job: DiscussionJob = { ai: rawAi, state: 'working' };
  jobs.set(key, job);
  const finished = (async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-thumbnail-discussion-'));
    try {
      const folder = await prepareDraftFolder(pieceDir, imageFile, work);
      const answer = (await ask(rawAi, discussionPrompt(rawAi, folder.imageCopy, pick, history, message, folder, isShort(piece)), work, [folder.imageCopy])).trim();
      if (!answer) throw new Error(`${AI_NAMES[rawAi]} returned an empty reply.`);
      const changeRequest = changeRequestIn(answer);
      saveMessages(file, [...readMessages(file), { id: randomUUID(), from: rawAi, text: answer, at: new Date().toISOString(), ...(changeRequest ? { changeRequest } : {}) }]);
      jobs.delete(key);
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  })().catch((e: unknown) => { job.state = 'failed'; job.error = e instanceof Error ? e.message : String(e); });
  return { job, finished };
}

/** The text under the last "### Change Request" heading of a reply, or null. */
export function changeRequestIn(text: string): string | null {
  const match = /^#{2,4}\s*Change Request\s*$/im.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const end = /^#{1,4}\s/m.exec(rest);
  const request = (end ? rest.slice(0, end.index) : rest).trim();
  return request || null;
}
