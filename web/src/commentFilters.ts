// Pure helpers for filtering, sorting, and joining stored YouTube comments with channel video metadata.
import type { StoredCommentThread, StoredCommentsSummary } from '../../server/channel-comments';
import type { ChannelVideo } from '../../server/channel-videos';
import type { Topic } from '../../server/video-profile';

export type CommentStatusFilter = 'unresponded' | 'all' | 'responded';
export type CommentSortKey = 'newest' | 'likes' | 'replies';

export interface CommentFilterState {
  status: CommentStatusFilter;
  videoId: string;
  topic: 'all' | Topic;
  kind: 'all' | 'longform' | 'short';
  sort: CommentSortKey;
  text: string;
}

export const DEFAULT_COMMENT_FILTERS: CommentFilterState = {
  status: 'unresponded',
  videoId: 'all',
  topic: 'all',
  kind: 'all',
  sort: 'newest',
  text: '',
};

export interface CommentRow {
  videoId: string;
  videoTitle: string;
  videoThumbnail?: string;
  videoKind?: 'longform' | 'short';
  videoTopic?: Topic;
  videoTopic2?: Topic;
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
        videoThumbnail: video?.thumbnail,
        videoKind: video?.kind,
        videoTopic: video?.topic,
        videoTopic2: video?.topic2,
        thread,
      });
    }
  }
  return rows;
}

export function filterAndSortComments(rows: CommentRow[], filters: CommentFilterState): CommentRow[] {
  const query = filters.text.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (filters.status === 'unresponded' && row.thread.ownerReplied) return false;
    if (filters.status === 'responded' && !row.thread.ownerReplied) return false;
    if (filters.videoId !== 'all' && row.videoId !== filters.videoId) return false;
    if (filters.kind !== 'all' && row.videoKind !== filters.kind) return false;
    if (filters.topic !== 'all' && row.videoTopic !== filters.topic && row.videoTopic2 !== filters.topic) {
      return false;
    }
    if (query) {
      const hay = [
        row.thread.author,
        row.thread.text,
        row.videoTitle,
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
