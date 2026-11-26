import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMENTS_DIR, type VideoCommentsFile } from './channel-comments';
import { draftCommentReply, parseCommentReplyAnswer } from './comment-reply-ai';
import { config } from './config';
import { makeTree, removeTree } from './testing';

const VIDEO = 'abcdefghijk';
let root: string;
let savedProjects: string;

function saveComments(file: VideoCommentsFile) {
  const dir = path.join(config.videoProjectsDir, COMMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${VIDEO}.json`), JSON.stringify(file));
}

beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '' });
  savedProjects = config.videoProjectsDir;
  config.videoProjectsDir = path.join(root, 'Projects');
  saveComments({
    version: 1,
    videoId: VIDEO,
    syncedAt: '2026-11-25T00:00:00Z',
    threads: [{
      id: 't1', topLevelCommentId: 'c1', author: '@viewer', isOwner: false, text: 'I am not alone! Thank you.',
      publishedAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z', likeCount: 0, totalReplyCount: 1,
      replies: [{ id: 'r1', author: '@other', isOwner: false, text: 'Same here.', publishedAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z', likeCount: 0 }],
      ownerReplied: false,
    }],
  });
});

afterEach(() => {
  config.videoProjectsDir = savedProjects;
  removeTree(root);
});

describe('draftCommentReply', () => {
  it("sends the comment, video title, replies and John's notes, and returns the reply and thoughts", async () => {
    let seen = '';
    const res = await draftCommentReply(VIDEO, 'c1', 'claude', 'My Past Is Gone', 'mention the next video', async (_ai, prompt) => {
      seen = prompt;
      return 'Here you go:\n' + JSON.stringify({ reply: "You're not alone. Thanks for being here.", thoughts: 'They feel less isolated.' });
    });
    expect(seen).toContain('I am not alone! Thank you.');
    expect(seen).toContain('My Past Is Gone');
    expect(seen).toContain('Same here.');
    expect(seen).toContain('mention the next video');
    expect(res.reply).toBe("You're not alone. Thanks for being here.");
    expect(res.thoughts).toBe('They feel less isolated.');
    expect(res.aiName).toBe('Claude');
  });

  it('refuses a comment that is not in the downloaded comments', async () => {
    await expect(draftCommentReply(VIDEO, 'nope', 'claude', '', '', async () => '{}')).rejects.toThrow('not in the downloaded comments');
  });

  it("refuses a video whose comments aren't downloaded", async () => {
    await expect(draftCommentReply('zzzzzzzzzzz', 'c1', 'claude', '', '', async () => '{}')).rejects.toThrow("haven't been downloaded");
  });
});

describe('parseCommentReplyAnswer', () => {
  it('uses an answer that is not JSON as the reply', () => {
    expect(parseCommentReplyAnswer('Thanks so much!')).toEqual({ reply: 'Thanks so much!', thoughts: '' });
  });
});
