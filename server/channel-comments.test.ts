import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMENTS_DIR,
  listStoredComments,
  readVideoComments,
  syncAllChannelComments,
  syncVideoComments,
} from './channel-comments';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { QUOTA_USED_UP } from './youtube-quota';

let root: string;
let savedProjects: string;

beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '' });
  savedProjects = config.videoProjectsDir;
  config.videoProjectsDir = path.join(root, 'Projects');
});

afterEach(() => {
  config.videoProjectsDir = savedProjects;
  removeTree(root);
});

const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = 'abc12345678';

function rawThread(
  id: string,
  channelId: string,
  authorChannelId: string,
  author: string,
  text: string,
  replies: { id: string; authorChannelId: string; author: string; text: string }[] = [],
  totalReplyCount = replies.length,
) {
  return {
    id,
    snippet: {
      channelId,
      totalReplyCount,
      topLevelComment: {
        id,
        snippet: {
          authorDisplayName: author,
          authorChannelId: { value: authorChannelId },
          textOriginal: text,
          publishedAt: '2026-11-20T10:00:00Z',
          updatedAt: '2026-11-20T10:00:00Z',
          likeCount: 3,
        },
      },
    },
    replies: replies.length
      ? {
          comments: replies.map((r) => ({
            id: r.id,
            snippet: {
              authorDisplayName: r.author,
              authorChannelId: { value: r.authorChannelId },
              textOriginal: r.text,
              publishedAt: '2026-11-20T11:00:00Z',
              updatedAt: '2026-11-20T11:00:00Z',
              likeCount: 1,
            },
          })),
        }
      : undefined,
  };
}

describe('channel comments sync', () => {
  it('starts empty before any comments are synced', () => {
    expect(readVideoComments(VIDEO_A)).toBeNull();
    expect(listStoredComments()).toEqual({
      files: [],
      totalVideos: 0,
      totalThreads: 0,
      disabledVideos: 0,
      lastSyncedAt: null,
    });
    expect(fs.existsSync(path.join(config.videoProjectsDir, COMMENTS_DIR))).toBe(false);
  });

  it('syncs paginated threads, marks owner replies, and fetches extra replies when truncated', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('commentThreads') && !url.includes('pageToken=')) {
        return Response.json({
          nextPageToken: 'page2',
          items: [
            rawThread(
              't1',
              'UCjohn',
              'UCviewer1',
              'Viewer One',
              'I relate to SDAM so much.',
              [{ id: 'r1', authorChannelId: 'UCjohn', author: 'Heart Mind Fusion', text: 'Thank you for sharing!' }],
              1,
            ),
            rawThread(
              't2',
              'UCjohn',
              'UCviewer2',
              'Viewer Two',
              'Can you make a follow-up?',
              [{ id: 'r2', authorChannelId: 'UCother', author: 'Other', text: 'Me too!' }],
              2,
            ),
          ],
        });
      }
      if (url.includes('commentThreads') && url.includes('pageToken=page2')) {
        return Response.json({
          items: [rawThread('t3', 'UCjohn', 'UCjohn', 'Heart Mind Fusion', 'Pinned note from me.')],
        });
      }
      if (url.includes('/comments?') && url.includes('parentId=t2')) {
        return Response.json({
          items: [
            {
              id: 'r2',
              snippet: {
                authorDisplayName: 'Other',
                authorChannelId: { value: 'UCother' },
                textOriginal: 'Me too!',
                publishedAt: '2026-11-20T11:00:00Z',
                likeCount: 0,
              },
            },
            {
              id: 'r3',
              snippet: {
                authorDisplayName: 'Heart Mind Fusion',
                authorChannelId: { value: 'UCjohn' },
                textOriginal: 'Adding it to my list!',
                publishedAt: '2026-11-20T12:00:00Z',
                likeCount: 2,
              },
            },
          ],
        });
      }
      return new Response('Not found', { status: 404 });
    });

    const saved = await syncVideoComments(VIDEO_A, {
      token: 'tok',
      fetcher,
      now: new Date('2026-11-24T15:00:00Z'),
    });

    expect(saved.threads).toHaveLength(3);
    expect(saved.threads[0].ownerReplied).toBe(true);
    expect(saved.threads[1].replies).toHaveLength(2);
    expect(saved.threads[1].ownerReplied).toBe(true);
    expect(saved.threads[2].isOwner).toBe(true);
    expect(saved.threads[2].ownerReplied).toBe(true);
    expect(readVideoComments(VIDEO_A)).toEqual(saved);

    const summary = listStoredComments();
    expect(summary.totalVideos).toBe(1);
    expect(summary.totalThreads).toBe(3);
    expect(summary.lastSyncedAt).toBe('2026-11-24T15:00:00.000Z');
  });

  it('records disabled comments without failing and syncs multiple videos', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes(`videoId=${VIDEO_A}`)) {
        return Response.json({
          items: [rawThread('t1', 'UCjohn', 'UCviewer', 'Viewer', 'Unanswered question')],
        });
      }
      if (url.includes(`videoId=${VIDEO_B}`)) {
        return new Response(JSON.stringify({ error: { errors: [{ reason: 'commentsDisabled' }] } }), { status: 403 });
      }
      return new Response('Not found', { status: 404 });
    });

    const result = await syncAllChannelComments({
      videoIds: [VIDEO_A, VIDEO_B],
      token: 'tok',
      fetcher,
      now: new Date('2026-11-24T15:10:00Z'),
    });

    expect(result).toEqual({
      synced: 2,
      disabled: 1,
      failed: [],
      totalThreads: 1,
      syncedAt: '2026-11-24T15:10:00.000Z',
    });
    expect(readVideoComments(VIDEO_B)?.disabled).toBe(true);
    expect(readVideoComments(VIDEO_A)?.threads[0].ownerReplied).toBe(false);
  });

  it('stops gracefully when YouTube quota is exhausted', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 });
    });

    const result = await syncAllChannelComments({
      videoIds: [VIDEO_A],
      token: 'tok',
      fetcher,
    });

    expect(result.synced).toBe(0);
    expect(result.failed).toEqual([{ videoId: VIDEO_A, error: QUOTA_USED_UP }]);
  });

  it('rejects invalid video IDs and junctions', async () => {
    await expect(syncVideoComments('../escape', { token: 'tok' })).rejects.toThrow('valid YouTube video');
    expect(() => readVideoComments('bad')).toThrow('valid YouTube video');

    const elsewhere = path.join(root, 'Elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(config.videoProjectsDir, COMMENTS_DIR), 'junction');
    expect(() => listStoredComments()).toThrow();
    await expect(syncVideoComments(VIDEO_A, { token: 'tok' })).rejects.toThrow();
  });
});
