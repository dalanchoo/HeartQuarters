import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import type { AskAi } from './brief';
import { feedbackPrompt, startThumbnailReview, thumbnailReviews } from './thumbnail-feedback';
import { makeTree, removeTree } from './testing';

const PIECE = "005 - John's Video/Longform";
const IMAGE = `${PIECE}/Packaging/Drafts/ChatGPT 01/02.png`;
const PICK = { title: 'My Story', thumbnailText: 'A NEW START', expression: 'Calm', description: 'The real story', tags: 'story, memories', pinnedComment: 'What do you think?' };
let root: string;
let previous: { projects: string; skills: string; reviews: string | undefined };

beforeEach(() => {
  root = makeTree({
    [`Projects/${IMAGE}`]: 'image bytes',
    [`Projects/${PIECE}/Packaging/Drafts/ChatGPT 01/Conversation.json`]: JSON.stringify({ ai: 'codex', session: 's', photo: 'photo.jpg', pick: PICK }),
    [`Projects/${PIECE}/Packaging/Drafts/Brief.md`]: 'A grounded packaging brief.',
    [`Projects/${PIECE}/Subtitles/video-captions.txt`]: 'A truthful transcript.',
    'Projects/Other/Packaging/Drafts/ChatGPT 01/01.png': 'other image',
    'Skills/HMF_Skills/channel-basics/SKILL.md': 'Channel rules',
    'Skills/HMF_Skills/thumbnails-and-titles/SKILL.md': 'Thumbnail rules',
  });
  previous = { projects: config.videoProjectsDir, skills: config.skillsDir, reviews: process.env.HQ_THUMB_REVIEW_DIR };
  config.videoProjectsDir = path.join(root, 'Projects'); config.skillsDir = path.join(root, 'Skills');
  process.env.HQ_THUMB_REVIEW_DIR = path.join(root, 'Reviews');
});

afterEach(() => {
  config.videoProjectsDir = previous.projects; config.skillsDir = previous.skills;
  if (previous.reviews === undefined) delete process.env.HQ_THUMB_REVIEW_DIR; else process.env.HQ_THUMB_REVIEW_DIR = previous.reviews;
  removeTree(root);
});

describe('thumbnail feedback', () => {
  it('asks about the actual image, expression, packaging and grounded source without changing Drive', async () => {
    let work = '';
    const ask: AskAi = async (ai, prompt, cwd, images = []) => {
      work = cwd; expect(ai).toBe('gemini');
      expect(images).toEqual([path.join(cwd, 'thumbnail.png')]);
      expect(fs.readFileSync(images[0], 'utf8')).toBe('image bytes');
      expect(fs.readFileSync(path.join(cwd, 'source.txt'), 'utf8')).toBe('A truthful transcript.');
      expect(fs.readFileSync(path.join(cwd, 'brief.md'), 'utf8')).toBe('A grounded packaging brief.');
      expect(fs.readFileSync(path.join(cwd, 'thumbnails-and-titles.md'), 'utf8')).toBe('Thumbnail rules');
      expect(prompt).toContain('facial expression'); expect(prompt).toContain('My Story'); expect(prompt).toContain('The real story');
      expect(prompt).toContain('Does this look sad?'); expect(prompt).toContain('Do not generate or edit an image');
      return 'The expression fits, but the text is small.';
    };
    const before = fs.readFileSync(path.join(config.videoProjectsDir, IMAGE));
    const conversationFolder = path.dirname(path.join(config.videoProjectsDir, IMAGE));
    const filesBefore = fs.readdirSync(conversationFolder);
    const metadataBefore = fs.readFileSync(path.join(conversationFolder, 'Conversation.json'));
    const { job, finished } = startThumbnailReview(PIECE, IMAGE, 'gemini', 'Does this look sad?', ask);
    expect(job.state).toBe('working'); await finished;
    expect(fs.existsSync(work)).toBe(false);
    expect(fs.readFileSync(path.join(config.videoProjectsDir, IMAGE))).toEqual(before);
    expect(fs.readdirSync(conversationFolder)).toEqual(filesBefore);
    expect(fs.readFileSync(path.join(conversationFolder, 'Conversation.json'))).toEqual(metadataBefore);
    const result = thumbnailReviews(PIECE, IMAGE);
    expect(result.jobs).toEqual([]); expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({ name: 'Gemini', question: 'Does this look sad?', answer: 'The expression fits, but the text is small.', outdated: false, packagingOutdated: false });
    fs.writeFileSync(path.join(config.videoProjectsDir, IMAGE), 'new image');
    expect(thumbnailReviews(PIECE, IMAGE).reviews[0].outdated).toBe(true);
    fs.writeFileSync(path.join(config.videoProjectsDir, PIECE, 'Packaging', 'Drafts', 'ChatGPT 01', 'Conversation.json'), JSON.stringify({ ai: 'codex', session: 's', photo: 'photo.jpg', pick: { ...PICK, title: 'Changed' } }));
    expect(thumbnailReviews(PIECE, IMAGE).reviews[0].packagingOutdated).toBe(true);
  });

  it('rejects other videos, path traversal and non-image files', () => {
    expect(() => startThumbnailReview(PIECE, 'Other/Packaging/Drafts/ChatGPT 01/01.png', 'codex', '', async () => '')).toThrow(/thumbnail draft/);
    expect(() => startThumbnailReview(PIECE, '../../outside.png', 'codex', '', async () => '')).toThrow(/outside/);
    expect(() => startThumbnailReview(PIECE, `${PIECE}/Packaging/Drafts/ChatGPT 01/Conversation.json`, 'codex', '', async () => '')).toThrow(/thumbnail draft/);
  });

  it('rejects a draft folder linked to another video', () => {
    const other = path.join(config.videoProjectsDir, 'Other', 'Packaging', 'Drafts', 'ChatGPT 01');
    const linked = path.join(config.videoProjectsDir, PIECE, 'Packaging', 'Drafts', 'Linked');
    fs.symlinkSync(other, linked, 'junction');
    expect(() => startThumbnailReview(PIECE, `${PIECE}/Packaging/Drafts/Linked/01.png`, 'codex', '', async () => '')).toThrow(/thumbnail draft/);
  });

  it('reports failures without creating feedback and allows retry', async () => {
    const failed = startThumbnailReview(PIECE, IMAGE, 'claude', '', async () => { throw new Error('Not signed in'); });
    await failed.finished; expect(failed.job).toMatchObject({ state: 'failed', error: 'Not signed in' });
    expect(thumbnailReviews(PIECE, IMAGE).reviews).toEqual([]);
    const retried = startThumbnailReview(PIECE, IMAGE, 'claude', '', async () => 'Looks appropriate.');
    await retried.finished; expect(thumbnailReviews(PIECE, IMAGE).reviews[0].name).toBe('Claude');
  });

  it('allows different AIs to review simultaneously but prevents duplicate requests to the same AI', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const ask: AskAi = async () => { await wait; return 'Feedback'; };
    const first = startThumbnailReview(PIECE, IMAGE, 'codex', '', ask);
    const second = startThumbnailReview(PIECE, IMAGE, 'gemini', '', ask);
    expect(() => startThumbnailReview(PIECE, IMAGE, 'codex', '', ask)).toThrow(/already reviewing/);
    expect(thumbnailReviews(PIECE, IMAGE).jobs.filter(job => job.state === 'working')).toHaveLength(2);
    release(); await Promise.all([first.finished, second.finished]);
    expect(thumbnailReviews(PIECE, IMAGE).reviews).toHaveLength(2);
  });

  it('does not imply the video was checked when no source exists', () => {
    const prompt = feedbackPrompt('thumbnail.png', null, '', false, true, []);
    expect(prompt).toContain('No script or transcript was available');
    expect(prompt).toContain('vertical YouTube Short');
  });
});
