// Pure helpers for filtering, sorting, and joining stored YouTube comments with channel video metadata.
import type { StoredCommentThread, StoredCommentsSummary } from '../../server/channel-comments';
import type { ChannelVideo } from '../../server/channel-videos';
import { channelRows } from './channelRows';
import { ALL_VIDEO_FACETS, type VideoFacets } from './VideoFinder';

export type CommentStatusFilter = 'unresponded' | 'all' | 'responded';
export type CommentSortKey = 'newest' | 'likes' | 'replies';

export interface CommentFilterState extends VideoFacets {
  status: CommentStatusFilter;
  videoId: string;
  sort: CommentSortKey;
  text: string;
}

export const DEFAULT_COMMENT_FILTERS: CommentFilterState = {
  ...ALL_VIDEO_FACETS,
  status: 'unresponded',
  videoId: 'all',
  sort: 'newest',
  text: '',
};

export interface CommentRow {
  videoId: string;
  videoTitle: string;
  videoPiece: string | null;
  videoThumbnail?: string;
  thread: StoredCommentThread;
}

export function flattenComments(
  summary: StoredCommentsSummary | null,
  videos: ChannelVideo[] | undefined,
): CommentRow[] {
  if (!summary) return [];
  const byId = new Map((videos ?? []).map((v) => [v.id, v]));
  const rows: CommentRow[] = [];
  for (const file of summary.files) {
    const video = byId.get(file.videoId);
    for (const thread of file.threads) {
      rows.push({
        videoId: file.videoId,
        videoTitle: video?.title ?? file.videoId,
        videoPiece: video?.piece ?? null,
        videoThumbnail: video?.thumbnail,
        thread,
      });
    }
  }
  return rows;
}

export function filterAndSortComments(
  rows: CommentRow[],
  filters: CommentFilterState,
  videos?: ChannelVideo[],
  videoText = '',
): CommentRow[] {
  const facetFiltering = filters.kind !== 'all' || filters.topic !== 'all' || filters.angle !== 'all' || !!videoText.trim();
  const allowedVideoIds =
    facetFiltering && videos
      ? new Set(channelRows(videos, { kind: filters.kind, topic: filters.topic, angle: filters.angle, text: videoText }, 'publishedAt', true).map((v) => v.id))
      : null;

  const query = filters.text.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (filters.status === 'unresponded' && row.thread.ownerReplied) return false;
    if (filters.status === 'responded' && !row.thread.ownerReplied) return false;
    if (filters.videoId !== 'all' && row.videoId !== filters.videoId) return false;
    if (allowedVideoIds && !allowedVideoIds.has(row.videoId)) return false;
    if (query) {
      const hay = [
        row.thread.author,
        row.thread.text,
        row.videoTitle,
        row.videoPiece ?? '',
        ...row.thread.replies.map((r) => `${r.author} ${r.text}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (filters.sort === 'likes') {
      return b.thread.likeCount - a.thread.likeCount || b.thread.publishedAt.localeCompare(a.thread.publishedAt);
    }
    if (filters.sort === 'replies') {
      return b.thread.totalReplyCount - a.thread.totalReplyCount || b.thread.publishedAt.localeCompare(a.thread.publishedAt);
    }
    return b.thread.publishedAt.localeCompare(a.thread.publishedAt);
  });
}
