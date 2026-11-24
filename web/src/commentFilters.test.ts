import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMENT_FILTERS,
  filterAndSortComments,
  flattenComments,
} from './commentFilters';
import type { StoredCommentsSummary } from '../../server/channel-comments';
import type { ChannelVideo } from '../../server/channel-videos';

const videos: ChannelVideo[] = [
  {
    id: 'vid-sdam-01',
    title: 'Living With SDAM',
    publishedAt: '2026-10-01T00:00:00Z',
    seconds: 500,
    privacy: 'public',
    kind: 'longform',
    kindGuessed: false,
    piece: '003 - SDAM/Longform',
    numbers: null,
    topic: 'sdam',
    topic2: 'unassigned',
    angle: 'story',
    angle2: 'unassigned',
    note: '',
  },
  {
    id: 'vid-aph-002',
    title: 'Aphantasia Short',
    publishedAt: '2026-11-01T00:00:00Z',
    seconds: 45,
    privacy: 'public',
    kind: 'short',
    kindGuessed: false,
    piece: '002 - Aphantasia/Shorts/S01',
    numbers: null,
    topic: 'aphantasia',
    topic2: 'unassigned',
    angle: 'explainer',
    angle2: 'unassigned',
    note: '',
  },
];

const summary: StoredCommentsSummary = {
  totalVideos: 2,
  totalThreads: 3,
  disabledVideos: 0,
  lastSyncedAt: '2026-11-24T15:00:00Z',
  files: [
    {
      version: 1,
      videoId: 'vid-sdam-01',
      syncedAt: '2026-11-24T15:00:00Z',
      threads: [
        {
          id: 't1',
          topLevelCommentId: 't1',
          author: 'Alice',
          isOwner: false,
          text: 'Do you remember birthdays?',
          publishedAt: '2026-11-20T10:00:00Z',
          updatedAt: '2026-11-20T10:00:00Z',
          likeCount: 5,
          totalReplyCount: 0,
          replies: [],
          ownerReplied: false,
        },
        {
          id: 't2',
          topLevelCommentId: 't2',
          author: 'Bob',
          isOwner: false,
          text: 'Thanks for making this.',
          publishedAt: '2026-11-21T10:00:00Z',
          updatedAt: '2026-11-21T10:00:00Z',
          likeCount: 12,
          totalReplyCount: 1,
          replies: [
            {
              id: 'r1',
              author: 'Heart Mind Fusion',
              isOwner: true,
              text: 'Glad it helped!',
              publishedAt: '2026-11-21T12:00:00Z',
              updatedAt: '2026-11-21T12:00:00Z',
              likeCount: 1,
            },
          ],
          ownerReplied: true,
        },
      ],
    },
    {
      version: 1,
      videoId: 'vid-aph-002',
      syncedAt: '2026-11-24T15:00:00Z',
      threads: [
        {
          id: 't3',
          topLevelCommentId: 't3',
          author: 'Carol',
          isOwner: false,
          text: 'I cannot visualize anything either.',
          publishedAt: '2026-11-22T10:00:00Z',
          updatedAt: '2026-11-22T10:00:00Z',
          likeCount: 2,
          totalReplyCount: 0,
          replies: [],
          ownerReplied: false,
        },
      ],
    },
  ],
};

describe('channelComments helpers', () => {
  it('filters by response status, topic, format, video, and search text', () => {
    const rows = flattenComments(summary, videos);
    expect(rows).toHaveLength(3);

    expect(filterAndSortComments(rows, DEFAULT_COMMENT_FILTERS).map((r) => r.thread.id)).toEqual(['t3', 't1']);
    expect(
      filterAndSortComments(rows, { ...DEFAULT_COMMENT_FILTERS, status: 'responded' }).map((r) => r.thread.id),
    ).toEqual(['t2']);
    expect(
      filterAndSortComments(rows, { ...DEFAULT_COMMENT_FILTERS, status: 'all', topic: 'sdam' }).map((r) => r.thread.id),
    ).toEqual(['t2', 't1']);
    expect(
      filterAndSortComments(rows, { ...DEFAULT_COMMENT_FILTERS, status: 'all', kind: 'short' }).map((r) => r.thread.id),
    ).toEqual(['t3']);
    expect(
      filterAndSortComments(rows, { ...DEFAULT_COMMENT_FILTERS, status: 'all', text: 'birthdays' }).map((r) => r.thread.id),
    ).toEqual(['t1']);
    expect(
      filterAndSortComments(rows, { ...DEFAULT_COMMENT_FILTERS, status: 'all', sort: 'likes' }).map((r) => r.thread.id),
    ).toEqual(['t2', 't1', 't3']);
  });
});
