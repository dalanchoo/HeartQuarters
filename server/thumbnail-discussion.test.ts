// Discuss: fake folders and a fake AI, so no real AI runs and Drive is never touched.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import type { AskAi } from './brief';
import { changeRequestIn, clearDiscussion, discussionImage, readDiscussion, sendDiscussionMessage } from './thumbnail-discussion';
import { makeTree, removeTree } from './testing';

const PIECE = "005 - John's Video/Longform";
const DRAFT = `${PIECE}/Packaging/Drafts/ChatGPT 01`;
const PICK = { title: 'My Story', thumbnailText: 'ONE STORY SURVIVED', expression: 'Calm' };
let root: string;
let previous: { projects: string; skills: string; dir: string | undefined };

beforeEach(() => {
  root = makeTree({
    [`Projects/${DRAFT}/01.png`]: 'first image',
    [`Projects/${DRAFT}/02.png`]: 'second image',
    [`Projects/${DRAFT}/Conversation.json`]: JSON.stringify({ ai: 'codex', session: 's', photo: 'photo.jpg', pick: PICK }),
    [`Projects/${PIECE}/Packaging/Drafts/Gemini 01/01.png`]: 'other draft',
    [`Projects/${PIECE}/Subtitles/video-captions.txt`]: 'He told me the crib story.',
    'Projects/Other/Packaging/Drafts/ChatGPT 01/01.png': 'other video',
    'Skills/HMF_Skills/thumbnails-and-titles/SKILL.md': 'Thumbnail rules',
  });
  previous = { projects: config.videoProjectsDir, skills: config.skillsDir, dir: process.env.HQ_THUMB_DISCUSSION_DIR };
  config.videoProjectsDir = path.join(root, 'Projects'); config.skillsDir = path.join(root, 'Skills');
  process.env.HQ_THUMB_DISCUSSION_DIR = path.join(root, 'Discussions');
});
afterEach(() => {
  config.videoProjectsDir = previous.projects; config.skillsDir = previous.skills;
  if (previous.dir === undefined) delete process.env.HQ_THUMB_DISCUSSION_DIR; else process.env.HQ_THUMB_DISCUSSION_DIR = previous.dir;
  removeTree(root);
});

describe('discussing a thumbnail draft', () => {
  it('keeps the whole conversation, shows the AI the image, transcript and packaging, and picks out the change request', async () => {
    const prompts: string[] = [];
    const ask: AskAi = async (_ai, prompt, cwd, images = []) => {
      prompts.push(prompt);
      expect(fs.readFileSync(images[0], 'utf8')).toBe(prompts.length === 1 ? 'first image' : 'second image');
      expect(fs.readFileSync(path.join(cwd, 'source.txt'), 'utf8')).toBe('He told me the crib story.');
      return prompts.length === 1 ? 'The bike is the wrong story.' : 'Agreed.\n\n### Change Request\nReplace the dirt bike photo with a small child\'s crib.\n';
    };
    await sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'claude', 'Is the picture right?', ask).finished;
    // The second image of the same draft carries on the same discussion.
    await sendDiscussionMessage(PIECE, `${DRAFT}/02.png`, 'gemini', '  Show the crib instead.  ', ask).finished;
    expect(prompts[0]).toContain('(this is the first message)');
    expect(prompts[0]).toContain('ONE STORY SURVIVED');
    expect(prompts[0]).toContain('Accuracy is a hard rule');
    expect(prompts[1]).toContain('[John]\nIs the picture right?');
    expect(prompts[1]).toContain('[Claude]\nThe bike is the wrong story.');
    expect(prompts[1]).toContain("--- JOHN'S NEW MESSAGE ---\nShow the crib instead.");
    const { messages, job } = readDiscussion(PIECE, `${DRAFT}/01.png`);
    expect(job).toBeNull();
    expect(messages.map(m => m.from)).toEqual(['john', 'claude', 'john', 'gemini']);
    expect(messages[3].changeRequest).toBe("Replace the dirt bike photo with a small child's crib.");
    expect(messages[1].changeRequest).toBeUndefined();
    // Another draft has its own discussion.
    expect(readDiscussion(PIECE, `${PIECE}/Packaging/Drafts/Gemini 01/01.png`).messages).toEqual([]);
    clearDiscussion(PIECE, `${DRAFT}/02.png`);
    expect(readDiscussion(PIECE, `${DRAFT}/01.png`).messages).toEqual([]);
  });

  it("keeps John's message when the AI fails, and checks what it is given", async () => {
    const { job, finished } = sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'codex', 'Hello', async () => { throw new Error('offline'); });
    await finished;
    expect(job).toMatchObject({ state: 'failed', error: 'offline' });
    expect(readDiscussion(PIECE, `${DRAFT}/01.png`).messages.map(m => m.text)).toEqual(['Hello']);
    expect(() => sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'codex', '   ')).toThrow(/Type a message/);
    expect(() => sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'nobody', 'Hi')).toThrow(/Choose Claude/);
    expect(() => sendDiscussionMessage(PIECE, 'Other/Packaging/Drafts/ChatGPT 01/01.png', 'codex', 'Hi')).toThrow();
    expect(() => readDiscussion(PIECE, `${PIECE}/../../Other/Packaging/Drafts/ChatGPT 01/01.png`)).toThrow();
  });

  it('keeps pasted images with the message and sends them, with earlier ones, to the AI', async () => {
    const png = (n: number) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(`picture ${n}`)]).toString('base64');
    const seen: string[][] = [];
    const prompts: string[] = [];
    const ask: AskAi = async (_ai, prompt, _cwd, images = []) => { prompts.push(prompt); seen.push(images.map(i => fs.readFileSync(i, 'latin1').replace(/^\x89PNG\r\n\x1a\n/, ''))); return 'I see it.'; };
    await sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'claude', '', ask, [png(1)]).finished;
    await sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'claude', 'And this one?', ask, [png(2)]).finished;
    // The draft first, then every pasted image so far.
    expect(seen[0]).toEqual(['first image', 'picture 1']);
    expect(seen[1]).toEqual(['first image', 'picture 1', 'picture 2']);
    const { messages } = readDiscussion(PIECE, `${DRAFT}/01.png`);
    expect(messages[0]).toMatchObject({ text: 'Look at the image I attached.', images: [expect.stringMatching(/-1\.png$/)] });
    expect(prompts[1]).toContain(`(John attached: ${messages[0].images![0]})`);
    expect(fs.readFileSync(discussionImage(PIECE, `${DRAFT}/01.png`, messages[2].images![0]), 'latin1')).toContain('picture 2');
    expect(() => discussionImage(PIECE, `${DRAFT}/01.png`, '../../secret.png')).toThrow(/no longer/);
    expect(() => sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'claude', 'Hi', ask, ['not an image'])).toThrow(/could not be read/);
    expect(() => sendDiscussionMessage(PIECE, `${DRAFT}/01.png`, 'claude', 'Hi', ask, [1, 2, 3, 4, 5].map(png))).toThrow(/at most 4/);
    clearDiscussion(PIECE, `${DRAFT}/01.png`);
    expect(fs.readdirSync(path.join(root, 'Discussions'))).toEqual([]);
  });

  it('finds the change request section, or none', () => {
    expect(changeRequestIn('Sure.\n\n## Change Request\nMake the crib larger.\n\n## Why\nIt reads better.')).toBe('Make the crib larger.');
    expect(changeRequestIn('No change yet.')).toBeNull();
    expect(changeRequestIn('### Change Request\n')).toBeNull();
  });
});
