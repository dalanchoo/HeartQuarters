// Discuss: a back-and-forth text conversation with any AI about one thumbnail draft, before (or instead of) making a new
// image (John, 2026-11-25). The AI sees the image shown, the draft's title and thumbnail words, the brief, the video's
// source and the channel's skills, and the whole conversation so far. It never makes images or changes files. When John
// and the AI agree on a change, the AI writes it under "### Change Request", which the page can put in Ask for Changes.
// One discussion per draft conversation, saved on this computer like Ask for Feedback's reviews, never in Drive.
// John can paste or drop images into a message (John, 2026-11-25); they are kept beside the discussion and go to the AI
// with every later turn (the newest few), so it can still refer to them.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, isAiId, type AiId } from './ai.js';
import { ACCURACY_RULE, THUMBNAIL_EXPRESSION_GUIDANCE, type AskAi } from './brief.js';
import { appDir } from './config.js';
import { askReadOnlyImage } from './expression-assessment.js';
import { writeFileSafely } from './files.js';
import { checkedConversation, checkedImage, checkedPick, prepareDraftFolder } from './thumbnail-feedback.js';
import { decodeReference, isShort } from './thumbnails.js';

export interface DiscussionMessage { id: string; from: 'john' | AiId; text: string; at: string; /** The draft image shown when John wrote it. */ image?: string; /** Images John pasted with it, by file name. */ images?: string[]; /** In an AI's reply: its "### Change Request" section. */ changeRequest?: string }
export interface DiscussionJob { ai: AiId; state: 'working' | 'failed'; error?: string }
export const MESSAGE_MAX = 4000;
/** Images per message, and how many of the discussion's newest images go to the AI each turn. */
export const MAX_IMAGES = 4;
const IMAGES_SENT = 6;
const IMAGE_NAME = /^[0-9a-f-]{36}-[1-4]\.(png|jpg|webp)$/;

const storage = () => process.env.HQ_THUMB_DISCUSSION_DIR ?? path.join(appDir, 'data', 'thumbnail-discussions');
/** The discussion belongs to the draft conversation, so it carries on across the images made in it. */
const keyFor = (piece: string, conversation: string) => createHash('sha256').update(JSON.stringify([piece.toLowerCase(), path.resolve(conversation).toLowerCase()])).digest('hex');
const jobs = new Map<string, DiscussionJob>();

function fileFor(piece: string, target: string, conversationFallback?: string) {
  if (target) {
    const checked = checkedImage(piece, target);
    const key = keyFor(piece, checked.conversation);
    return { ...checked, imageFile: checked.imageFile as string | null, key, file: path.join(storage(), `${key}.json`), images: path.join(storage(), key) };
  }
  const checked = checkedConversation(piece, conversationFallback ?? '');
  const key = keyFor(piece, checked.conversation);
  return { ...checked, imageFile: null as string | null, key, file: path.join(storage(), `${key}.json`), images: path.join(storage(), key) };
}

/** Appends one or more messages (such as an image-generation request and the AI's reply) to a draft's discussion. */
export function appendDiscussionMessages(piece: string, conversationDir: string, entries: Array<{ from: 'john' | AiId; text: string }>): void {
  if (!entries.length) return;
  const key = keyFor(piece, conversationDir);
  const file = path.join(storage(), `${key}.json`);
  const now = new Date().toISOString();
  const added: DiscussionMessage[] = entries.map((e) => ({ id: randomUUID(), from: e.from, text: e.text, at: now }));
  saveMessages(file, [...readMessages(file), ...added]);
}

function readMessages(file: string): DiscussionMessage[] {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { messages?: unknown };
    return Array.isArray(value.messages) ? (value.messages as DiscussionMessage[]).filter(m => m && typeof m.text === 'string' && (m.from === 'john' || isAiId(m.from))).map(m => ({ ...m, ...(m.images ? { images: m.images.filter(name => IMAGE_NAME.test(name)) } : {}) })) : [];
  } catch { return []; }
}
function saveMessages(file: string, messages: DiscussionMessage[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileSafely(file, JSON.stringify({ messages }, null, 2));
}

/** The conversation about a draft so far, and whether an AI is replying. */
export function readDiscussion(piece: string, image: string, conversation = ''): { messages: DiscussionMessage[]; job: DiscussionJob | null } {
  const { file, key } = fileFor(piece, image, conversation);
  return { messages: readMessages(file), job: jobs.get(key) ?? null };
}

/** Start Over: forgets the conversation about this draft. */
export function clearDiscussion(piece: string, image: string, conversation = ''): void {
  const { file, key, images } = fileFor(piece, image, conversation);
  if (jobs.get(key)?.state === 'working') throw new Error('Wait for the reply, then start over.');
  jobs.delete(key);
  fs.rmSync(file, { force: true });
  fs.rmSync(images, { recursive: true, force: true });
}

/** One image John pasted into this draft's discussion, checked against the messages so no other file can be asked for. */
export function discussionImage(piece: string, image: string, name: unknown, conversation = ''): string {
  const { file, images } = fileFor(piece, image, conversation);
  if (typeof name !== 'string' || !IMAGE_NAME.test(name) || !readMessages(file).some(m => m.images?.includes(name))) throw new Error('That image is no longer in this discussion.');
  const full = path.join(images, name);
  if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) throw new Error('That image is no longer in this discussion.');
  return full;
}

const speaker = (from: DiscussionMessage['from']) => (from === 'john' ? 'John' : AI_NAMES[from]);
const withImages = (m: Pick<DiscussionMessage, 'text' | 'images'>) => m.images?.length ? `${m.text}\n(John attached: ${m.images.join(', ')})` : m.text;

export function discussionPrompt(ai: AiId, image: string | null, pick: unknown, history: DiscussionMessage[], message: string, files: { source: boolean; brief: boolean; skills: string[]; pasted?: string[] }, short: boolean, attached: string[] = []): string {
  const thread = history.length ? history.map(m => `[${speaker(m.from)}]\n${withImages(m)}`).join('\n\n') : '(this is the first message)';
  return [
    image
      ? `You are ${AI_NAMES[ai]}, talking with John, the creator of Heart Mind Fusion, about a thumbnail draft for ${short ? 'a vertical YouTube Short' : 'a longform YouTube video'}. The draft image is attached and saved at ${image}. Look at it before you answer.`
      : `You are ${AI_NAMES[ai]}, talking with John, the creator of Heart Mind Fusion, about a thumbnail draft for ${short ? 'a vertical YouTube Short' : 'a longform YouTube video'}. No thumbnail image has been generated yet for this draft.`,
    'This is a conversation, not a review: answer what John asks or says, briefly and plainly, and ask him a question when you need to know something. Disagree when you have reason to. Skip generic YouTube advice.',
    files.source ? 'The video\'s script or transcript is in source.txt in the current folder. Read it before saying what the video does or does not contain; do not invent facts.' : 'No script or transcript is available. Do not claim to know what the video contains.',
    ...(files.brief ? ['The packaging brief is in brief.md in the current folder.'] : []),
    ...(files.skills.length ? [`The channel's thumbnail guidance is in the current folder: ${files.skills.join(', ')}.`] : []),
    ...(files.pasted?.length ? [`Images John pasted into this discussion are also attached and saved in the current folder: ${files.pasted.join(', ')}. They are references he is showing you, not the draft.`] : []),
    ACCURACY_RULE,
    THUMBNAIL_EXPRESSION_GUIDANCE,
    `The draft's packaging (title, thumbnail words and concept):\n${JSON.stringify(pick ?? null, null, 2)}`,
    'Do not make or edit an image, use image generation, or change any file. When John asks you to, or you and he have settled on a change to this image, end your reply with a section "### Change Request" holding only the request for the image AI, written to the AI that made the draft, in a few plain sentences it can follow on its own.',
    `--- CONVERSATION SO FAR ---\n${thread}`,
    `--- JOHN'S NEW MESSAGE ---\n${withImages({ text: message, images: attached })}`,
    'Reply in Markdown.',
  ].join('\n\n');
}

/** Sends John's message about the draft image to the chosen AI. His message is saved at once; the reply when it comes. */
export function sendDiscussionMessage(piece: string, image: string, rawAi: unknown, rawMessage: unknown, ask: AskAi = askReadOnlyImage, rawPasted: unknown = [], conversationPath = ''): { job: DiscussionJob; finished: Promise<void> } {
  if (!isAiId(rawAi)) throw new Error('Choose Claude, ChatGPT, or Gemini.');
  const pasted = Array.isArray(rawPasted) ? rawPasted : [];
  if (pasted.length > MAX_IMAGES) throw new Error(`Add at most ${MAX_IMAGES} images to a message.`);
  const decoded = pasted.map(decodeReference);
  if (typeof rawMessage !== 'string' || (!rawMessage.trim() && !decoded.length)) throw new Error('Type a message first.');
  const message = rawMessage.trim() || 'Look at the image I attached.';
  if (message.length > MESSAGE_MAX) throw new Error('That message is too long.');
  const { pieceDir, imageFile, conversation, file, key, images: imageDir } = fileFor(piece, image, conversationPath);
  if (jobs.get(key)?.state === 'working') throw new Error('An AI is already replying in this discussion.');
  const pick = checkedPick(conversation);
  const history = readMessages(file);
  const id = randomUUID();
  const names = decoded.map((d, i) => `${id}-${i + 1}${d.ext}`);
  if (decoded.length) {
    fs.mkdirSync(imageDir, { recursive: true });
    decoded.forEach((d, i) => fs.writeFileSync(path.join(imageDir, names[i]), d.data, { flag: 'wx' }));
  }
  saveMessages(file, [...history, { id, from: 'john', text: message, at: new Date().toISOString(), ...(image ? { image } : {}), ...(names.length ? { images: names } : {}) }]);
  // The discussion's newest pasted images go along each turn, so the AI can still see what John showed it earlier.
  const sent = [...history.flatMap(m => m.images ?? []), ...names].slice(-IMAGES_SENT);
  const job: DiscussionJob = { ai: rawAi, state: 'working' };
  jobs.set(key, job);
  const finished = (async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-thumbnail-discussion-'));
    try {
      const folder = await prepareDraftFolder(pieceDir, imageFile, work);
      const copies: string[] = [];
      for (const name of sent) {
        const from = path.join(imageDir, name);
        if (!fs.existsSync(from) || fs.lstatSync(from).isSymbolicLink()) continue;
        fs.copyFileSync(from, path.join(work, `pasted-${name}`)); copies.push(`pasted-${name}`);
      }
      const images = [...(folder.imageCopy ? [folder.imageCopy] : []), ...copies.map(c => path.join(work, c))];
      const answer = (await ask(rawAi, discussionPrompt(rawAi, folder.imageCopy, pick, history, message, { ...folder, pasted: copies }, isShort(piece), names), work, images)).trim();
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
