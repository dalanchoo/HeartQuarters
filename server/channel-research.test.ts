import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMENTS_DIR, type StoredCommentThread, type VideoCommentsFile } from './channel-comments';
import { RESEARCH_DIR, gatherTopicEvidence, readTopicResearch, runTopicResearch, topicCounts, topicLabel, topicVideos } from './channel-research';
import type { ChannelVideo } from './channel-videos';
import { config } from './config';
import { makeTree, removeTree } from './testing';

let root: string;
let saved: string;

function video(id: string, over: Partial<ChannelVideo> = {}): ChannelVideo {
  return {
    id, title: `Video ${id}`, publishedAt: '2026-01-01T00:00:00Z', seconds: 600, privacy: 'public', kind: 'longform', kindGuessed: false,
    piece: null, numbers: null, topic: 'unassigned', topic2: 'unassigned', angle: 'unassigned', angle2: 'unassigned', note: '', ...over,
  };
}

function thread(id: string, text: string, over: Partial<StoredCommentThread> = {}): StoredCommentThread {
  return {
    id, topLevelCommentId: id, author: 'Viewer', isOwner: false, text, publishedAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
    likeCount: 0, totalReplyCount: 0, replies: [], ownerReplied: false, ...over,
  };
}

function saveComments(videoId: string, threads: StoredCommentThread[]) {
  const dir = path.join(config.videoProjectsDir, COMMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file: VideoCommentsFile = { version: 1, videoId, syncedAt: '2026-02-02T00:00:00Z', threads };
  fs.writeFileSync(path.join(dir, `${videoId}.json`), JSON.stringify(file));
}

const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const C = 'ccccccccccc';

beforeEach(() => {
  root = makeTree({ 'Projects/001 - SDAM Story/Subtitles/001-captions.txt': 'I cannot relive my memories.' });
  saved = config.videoProjectsDir;
  config.videoProjectsDir = path.join(root, 'Projects');
});

afterEach(() => {
  config.videoProjectsDir = saved;
  removeTree(root);
});

const videos = () => [
  video(A, { topic: 'sdam', piece: '001 - SDAM Story', publishedAt: '2026-01-01T00:00:00Z' }),
  video(B, { topic: 'aphantasia', topic2: 'sdam', kind: 'short', publishedAt: '2026-03-01T00:00:00Z' }),
  video(C, { topic: 'psychedelics' }),
];

describe('channel research', () => {
  it('matches videos by main or second topic, newest first', () => {
    expect(topicVideos('sdam', videos()).map((v) => v.id)).toEqual([B, A]);
    expect(topicLabel('sdam')).toBe('SDAM');
    expect(topicLabel('psychedelics')).toBe('Psychedelics');
  });

  it('counts viewer comments per topic and leaves out John\'s own comments', () => {
    saveComments(A, [thread('t1', 'Do you dream?'), thread('t2', 'Pinned by me', { isOwner: true })]);
    saveComments(B, [thread('t3', 'Same here')]);
    const counts = topicCounts(videos());
    expect(counts.find((c) => c.topic === 'sdam')).toEqual({ topic: 'sdam', videos: 2, comments: 2 });
    expect(counts.find((c) => c.topic === 'unassigned' as never)).toBeUndefined();
  });

  it('rejects unknown topics', async () => {
    await expect(gatherTopicEvidence('unassigned', undefined, videos())).rejects.toThrow('Choose a topic');
    await expect(gatherTopicEvidence('../etc', undefined, videos())).rejects.toThrow('Choose a topic');
    expect(() => readTopicResearch('nope')).toThrow('Choose a topic');
  });

  it('gives the AI one file per video with comments and transcript, and saves the report to Drive', async () => {
    saveComments(A, [thread('t1', 'Do you dream in pictures?', { likeCount: 5, replies: [{ id: 'r1', author: 'John', isOwner: true, text: 'Not really.', publishedAt: '', updatedAt: '', likeCount: 0 }], ownerReplied: true })]);
    let seenPrompt = '';
    let seenFiles: Record<string, string> = {};
    const fakeAsk = async (_ai: 'claude' | 'codex' | 'gemini', prompt: string, cwd: string) => {
      seenPrompt = prompt;
      seenFiles = Object.fromEntries(fs.readdirSync(cwd).map((name) => [name, fs.readFileSync(path.join(cwd, name), 'utf8')]));
      return '## Unanswered Questions\nNone yet.';
    };
    const result = await runTopicResearch('sdam', 'claude', 'What about dreams?', fakeAsk, videos());

    expect(seenPrompt).toContain('“SDAM”');
    expect(seenPrompt).toContain("own audience only");
    expect(seenPrompt).toContain('What about dreams?');
    expect(Object.keys(seenFiles).sort()).toEqual(['01 - Video bbbbbbbbbbb.md', '02 - Video aaaaaaaaaaa.md']);
    const longform = seenFiles['02 - Video aaaaaaaaaaa.md'];
    expect(longform).toContain('Do you dream in pictures?');
    expect(longform).toContain('John replied');
    expect(longform).toContain('  - John: Not really.');
    expect(longform).toContain('I cannot relive my memories.');
    expect(seenFiles['01 - Video bbbbbbbbbbb.md']).toContain('Not linked to a project');

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({ ai: 'claude', focus: 'What about dreams?', commentCount: 1, transcriptCount: 1, text: '## Unanswered Questions\nNone yet.' });
    expect(fs.existsSync(path.join(config.videoProjectsDir, RESEARCH_DIR, 'sdam.json'))).toBe(true);
    expect(readTopicResearch('sdam').reports[0].id).toBe(result.reports[0].id);
  });

  it('refuses to run for a topic with no videos and writes nothing', async () => {
    await expect(runTopicResearch('kink', 'claude', '', async () => 'x', videos())).rejects.toThrow('No videos are tagged Kink');
    expect(fs.existsSync(path.join(config.videoProjectsDir, RESEARCH_DIR))).toBe(false);
  });

  it('refuses a broken research file instead of overwriting it', async () => {
    const dir = path.join(config.videoProjectsDir, RESEARCH_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sdam.json'), '{ broken');
    await expect(runTopicResearch('sdam', 'gemini', '', async () => 'Report', videos())).rejects.toThrow('could not be read');
    expect(fs.readFileSync(path.join(dir, 'sdam.json'), 'utf8')).toBe('{ broken');
  });
});
