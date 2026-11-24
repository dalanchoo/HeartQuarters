// Read-only AI feedback on an existing thumbnail. Reviews live in the app's data folder, never in Drive.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, isAiId, type AiId } from './ai.js';
import { findSource, readSource, THUMBNAIL_EXPRESSION_GUIDANCE, type AskAi } from './brief.js';
import { appDir, config, safeResolve } from './config.js';
import { askReadOnlyImage } from './expression-assessment.js';
import { DRAFTS_FOLDER } from './projects.js';
import { isShort, readConversation } from './thumbnails.js';

export interface ThumbnailReview { id: string; ai: AiId; name: string; image: string; imageHash: string; metadataHash: string; question: string; answer: string; createdAt: string; outdated?: boolean; packagingOutdated?: boolean }
export interface ThumbnailReviewJob { ai: AiId; state: 'working' | 'failed'; error?: string }
const jobs = new Map<string, ThumbnailReviewJob>();
const storage = () => process.env.HQ_THUMB_REVIEW_DIR ?? path.join(appDir, 'data', 'thumbnail-reviews');
const keyFor = (piece: string, image: string) => createHash('sha256').update(JSON.stringify([piece.toLowerCase(), image.toLowerCase()])).digest('hex');

/** Only a direct image inside a conversation within this video's Drafts is eligible. */
function checkedImage(piece: string, image: string) {
  if (!piece || !image) throw new Error('Choose a video and a thumbnail.');
  const pieceDir = safeResolve('projects', piece);
  const imageFile = safeResolve('projects', image);
  const conversation = path.dirname(imageFile);
  const drafts = path.join(pieceDir, 'Packaging', DRAFTS_FOLDER);
  if (path.dirname(conversation).toLowerCase() !== drafts.toLowerCase() || !/\.(png|jpe?g|webp)$/i.test(path.basename(imageFile)) || !fs.statSync(imageFile, { throwIfNoEntry: false })?.isFile() || [pieceDir, path.join(pieceDir, 'Packaging'), drafts, conversation, imageFile].some(file => fs.lstatSync(file).isSymbolicLink())) throw new Error("Choose a thumbnail draft from this video's Drafts folder.");
  return { pieceDir, imageFile, conversation };
}

function checkedPick(conversation: string) {
  const info = safeResolve('projects', path.relative(config.videoProjectsDir, path.join(conversation, 'Conversation.json')));
  if (fs.existsSync(info) && fs.lstatSync(info).isSymbolicLink()) throw new Error('The draft metadata must be a real file.');
  return readConversation(conversation)?.pick ?? null;
}

const metadataHash = (pick: unknown) => createHash('sha256').update(JSON.stringify(pick ?? null)).digest('hex');

export function feedbackPrompt(image: string, metadata: unknown, question: string, source: boolean, short: boolean, skills: string[], brief = false): string {
  return [
    `Review the actual thumbnail image at ${image} and the generated YouTube packaging below for Heart Mind Fusion. This is ${short ? 'a vertical YouTube Short' : 'a longform YouTube video'}.`,
    'First inspect the image itself. Pay special attention to whether John’s facial expression fits the title, thumbnail words, and the actual subject. Say clearly if it seems incompatible, ambiguous, or appropriate, and explain why. Do not assume an expression from a filename.',
    THUMBNAIL_EXPRESSION_GUIDANCE,
    'Also assess readability at phone size, visual hierarchy, title and image working together, whether the packaging is truthful, and the description, tags, hashtags, chapters and pinned comment if present. Give concrete, prioritized suggestions. Avoid exaggerated YouTube faces and claims you cannot support. If you cannot see the image or do not have enough information, say so.',
    `Generated packaging (not necessarily the currently published YouTube metadata):\n${JSON.stringify(metadata ?? null, null, 2)}`,
    source ? 'The available script or transcript is in source.txt in the current folder. Read it to check whether claims and the expression fit the video; do not invent facts or timestamps.' : 'No script or transcript was available. Do not claim to have verified the video contents.',
    ...(brief ? ['The packaging brief is in brief.md in the current folder. Read it for the intended audience and creative context; distinguish proposals from verified video content.'] : []),
    ...(skills.length ? [`The channel's relevant guidance is copied into the current folder: ${skills.join(', ')}. Read it for context.`] : []),
    ...(question ? [`John's question: ${question}`] : []),
    'This is feedback only. Do not generate or edit an image, use image generation, change any file, or publish anything. Reply with your feedback in Markdown.',
  ].join('\n\n');
}

export function thumbnailReviews(piece: string, image: string): { reviews: ThumbnailReview[]; jobs: ThumbnailReviewJob[] } {
  const { imageFile, conversation } = checkedImage(piece, image);
  const currentHash = createHash('sha256').update(fs.readFileSync(imageFile)).digest('hex');
  const currentMetadata = metadataHash(checkedPick(conversation));
  const key = keyFor(piece, image); const dir = path.join(storage(), key);
  const reviews: ThumbnailReview[] = [];
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir).filter(n => /^[a-f0-9-]+\.json$/i.test(n))) {
    try { const item = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ThumbnailReview; if (item.image === image && typeof item.answer === 'string') reviews.push({ ...item, outdated: item.imageHash !== currentHash, packagingOutdated: item.metadataHash !== currentMetadata }); } catch { /* ignore a damaged review */ }
  }
  return { reviews: reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), jobs: [...jobs.entries()].filter(([id]) => id.startsWith(`${key}:`)).map(([, job]) => job) };
}

export function startThumbnailReview(piece: string, image: string, ai: unknown, question: unknown, ask: AskAi = askReadOnlyImage): { job: ThumbnailReviewJob; finished: Promise<void> } {
  if (!isAiId(ai)) throw new Error('Choose Claude, ChatGPT, or Gemini.');
  if (typeof question !== 'string' || question.length > 4000) throw new Error('The question must be at most 4,000 characters.');
  const { pieceDir, imageFile, conversation } = checkedImage(piece, image);
  const key = keyFor(piece, image); const jobKey = `${key}:${ai}`;
  if (jobs.get(jobKey)?.state === 'working') throw new Error(`${AI_NAMES[ai]} is already reviewing this image.`);
  const pick = checkedPick(conversation);
  const job: ThumbnailReviewJob = { ai, state: 'working' }; jobs.set(jobKey, job);
  const finished = (async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-thumbnail-review-'));
    try {
      const imageCopy = path.join(work, `thumbnail${path.extname(imageFile).toLowerCase()}`);
      const imageBytes = fs.readFileSync(imageFile); fs.writeFileSync(imageCopy, imageBytes);
      const imageHash = createHash('sha256').update(imageBytes).digest('hex');
      const source = findSource(pieceDir);
      if (source) { const safeSource = safeResolve('projects', path.relative(config.videoProjectsDir, source.full)); if (fs.lstatSync(safeSource).isSymbolicLink() || fs.lstatSync(path.dirname(safeSource)).isSymbolicLink()) throw new Error('The source must be a real file in this video folder.'); fs.writeFileSync(path.join(work, 'source.txt'), await readSource(safeSource)); }
      const briefPath = safeResolve('projects', path.relative(config.videoProjectsDir, path.join(pieceDir, 'Packaging', DRAFTS_FOLDER, 'Brief.md')));
      const hasBrief = fs.existsSync(briefPath);
      if (hasBrief) { if (fs.lstatSync(briefPath).isSymbolicLink()) throw new Error('The brief must be a real file.'); fs.copyFileSync(briefPath, path.join(work, 'brief.md')); }
      const skills: string[] = [];
      for (const name of ['channel-basics', 'thumbnails-and-titles']) {
        const skill = path.join(config.skillsDir, 'HMF_Skills', name, 'SKILL.md');
        if (fs.existsSync(skill)) { const file = `${name}.md`; fs.copyFileSync(skill, path.join(work, file)); skills.push(file); }
      }
      const answer = (await ask(ai, feedbackPrompt(imageCopy, pick, question.trim(), !!source, isShort(piece), skills, hasBrief), work, [imageCopy])).trim();
      if (!answer) throw new Error(`${AI_NAMES[ai]} returned no feedback.`);
      const id = randomUUID(); const dir = path.join(storage(), key); fs.mkdirSync(dir, { recursive: true });
      const review: ThumbnailReview = { id, ai, name: AI_NAMES[ai], image, imageHash, metadataHash: metadataHash(pick), question: question.trim(), answer, createdAt: new Date().toISOString() };
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(review, null, 2), { flag: 'wx' });
      jobs.delete(jobKey);
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  })().catch((error: unknown) => { job.state = 'failed'; job.error = error instanceof Error ? error.message : String(error); });
  return { job, finished };
}
