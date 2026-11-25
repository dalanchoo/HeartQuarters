// Studio-style Channel -> Comments inbox with a reusable VideoSidebar on the left and comment threads on the right.
import { useEffect, useMemo, useState } from 'react';
import { getJson, postJson } from './api';
import type { CommentsSyncResult, ModerationAction, StoredCommentsSummary, VideoCommentsFile } from '../../server/channel-comments';
import type { ChannelVideo } from '../../server/channel-videos';
import { SidebarResizer } from './SidebarResizer';
import { ALL_VIDEO_FILTERS, VideoSidebar, type VideoSearchFilters } from './VideoFinder';
import {
  DEFAULT_COMMENT_FILTERS,
  filterAndSortComments,
  flattenComments,
  type CommentFilterState,
  type CommentSortKey,
  type CommentStatusFilter,
} from './commentFilters';
import { rowName } from './channelRows';

const commentsHash = (id: string) => `#Channel/Comments/${encodeURIComponent(id)}`;

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ChannelComments({ videos, videoId }: { videos?: ChannelVideo[]; videoId?: string }) {
  const [summary, setSummary] = useState<StoredCommentsSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<CommentsSyncResult | null>(null);
  const [error, setError] = useState('');
  const [videoFilters, setVideoFilters] = useState<VideoSearchFilters>(ALL_VIDEO_FILTERS);
  const [filters, setFilters] = useState<CommentFilterState>(() => ({
    ...DEFAULT_COMMENT_FILTERS,
    videoId: videoId && /^[\w-]{11}$/.test(videoId) ? videoId : 'all',
  }));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const selectedVideoId = videoId && /^[\w-]{11}$/.test(videoId) ? videoId : undefined;

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      videoId: selectedVideoId ?? 'all',
    }));
  }, [selectedVideoId]);

  useEffect(() => {
    getJson<StoredCommentsSummary>('/api/channel/comments').then(setSummary, (e) => setError((e as Error).message));
  }, []);

  const allRows = useMemo(() => flattenComments(summary, videos), [summary, videos]);
  const unrespondedCount = useMemo(() => allRows.filter((r) => !r.thread.ownerReplied).length, [allRows]);

  const threadCountsByVideo = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of summary?.files ?? []) counts.set(f.videoId, f.threads.length);
    return counts;
  }, [summary]);

  const sidebarVideos = useMemo(() => {
    if (!videos) return undefined;
    return videos.filter((v) => (threadCountsByVideo.get(v.id) ?? 0) > 0 || v.id === selectedVideoId);
  }, [videos, threadCountsByVideo, selectedVideoId]);

  const effectiveFilters = useMemo<CommentFilterState>(
    () => ({
      ...filters,
      kind: videoFilters.kind,
      topic: videoFilters.topic,
      angle: videoFilters.angle,
      videoId: selectedVideoId ?? 'all',
    }),
    [filters, videoFilters, selectedVideoId],
  );

  const visibleRows = useMemo(
    () => filterAndSortComments(allRows, effectiveFilters, sidebarVideos, videoFilters.text),
    [allRows, effectiveFilters, sidebarVideos, videoFilters.text],
  );

  const sync = async (singleVideoId?: string) => {
    setSyncing(true);
    setError('');
    try {
      const res = await postJson<CommentsSyncResult & { stored: StoredCommentsSummary }>(
        '/api/channel/comments/sync',
        singleVideoId ? { videoId: singleVideoId } : {},
      );
      setLastResult(res);
      setSummary(res.stored);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const postReply = async (targetVideoId: string, parentId: string) => {
    const text = replyText.trim();
    if (!text) return;
    setBusyId(parentId);
    setError('');
    try {
      const res = await postJson<{ file: VideoCommentsFile | null; stored: StoredCommentsSummary }>(
        '/api/channel/comments/reply',
        { videoId: targetVideoId, parentId, text },
      );
      setSummary(res.stored);
      setReplyOpenId(null);
      setReplyText('');
      setExpanded((prev) => ({ ...prev, [parentId]: true }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const moderate = async (targetVideoId: string, commentId: string, action: ModerationAction) => {
    const prompt =
      action === 'delete'
        ? 'Delete this comment from YouTube?'
        : action === 'spam'
          ? 'Mark this comment as spam / rejected on YouTube?'
          : 'Hide this comment (hold for review) on YouTube?';
    if (!window.confirm(prompt)) return;
    setBusyId(commentId);
    setError('');
    try {
      const res = await postJson<{ file: VideoCommentsFile | null; stored: StoredCommentsSummary }>(
        '/api/channel/comments/moderate',
        { videoId: targetVideoId, commentId, action },
      );
      setSummary(res.stored);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="channel-video-browser">
      <VideoSidebar
        videos={sidebarVideos}
        selectedId={selectedVideoId}
        filters={videoFilters}
        onFiltersChange={setVideoFilters}
        videoHref={commentsHash}
        allItem={{
          label: `All Videos (${allRows.length})`,
          href: '#Channel/Comments',
          active: !selectedVideoId,
        }}
        counts={threadCountsByVideo}
      />
      <SidebarResizer />
      <section className="channel-video-detail channel-comments">
        <div className="page-head">
          <div className="comments-title-group">
            <h2>Comments</h2>
            {summary && (
              <span className="muted small-text">
                {allRows.length.toLocaleString()} {allRows.length === 1 ? 'thread' : 'threads'} · {unrespondedCount.toLocaleString()} unresponded
                {summary.lastSyncedAt ? ` · Synced ${new Date(summary.lastSyncedAt).toLocaleString()}` : ''}
              </span>
            )}
          </div>
          <div className="comments-head-actions">
            {selectedVideoId && (
              <button type="button" className="small" disabled={syncing} onClick={() => void sync(selectedVideoId)}>
                {syncing ? 'Syncing…' : 'Sync This Video'}
              </button>
            )}
            <button type="button" className="small" disabled={syncing} onClick={() => void sync()}>
              {syncing ? 'Syncing Comments…' : 'Sync Comments'}
            </button>
          </div>
        </div>

        <div className="comments-filters">
          <select
            aria-label="Response Status"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as CommentStatusFilter }))}
          >
            <option value="unresponded">Unresponded</option>
            <option value="all">All Comments</option>
            <option value="responded">Responded</option>
          </select>

          <select
            aria-label="Sort Comments"
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as CommentSortKey }))}
          >
            <option value="newest">Newest</option>
            <option value="likes">Most Liked</option>
            <option value="replies">Most Replies</option>
          </select>

          <input
            type="search"
            aria-label="Search Comments"
            placeholder="Search comment text or author…"
            value={filters.text}
            onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
          />
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {lastResult && lastResult.failed.length > 0 && (
          <p className="error" role="alert">
            {lastResult.failed.length} {lastResult.failed.length === 1 ? 'video' : 'videos'} failed to sync ({lastResult.failed[0].error}).
          </p>
        )}
        {summary === null && !error && <p className="muted">Loading saved comments…</p>}
        {summary && allRows.length === 0 && !syncing && (
          <p className="muted">No comments downloaded yet. Click Sync Comments to save your YouTube comments to Drive.</p>
        )}
        {summary && allRows.length > 0 && visibleRows.length === 0 && (
          <p className="muted">No comments match these filters.</p>
        )}

        <div className="comments-list">
          {visibleRows.map(({ videoId: rowVideoId, videoTitle, videoPiece, videoThumbnail, thread }) => {
            const isRepliesOpen = !!expanded[thread.id];
            const isReplying = replyOpenId === thread.topLevelCommentId;
            const thumb = videoThumbnail && /^https:\/\/i\.ytimg\.com\//.test(videoThumbnail) ? videoThumbnail : undefined;
            const displayVideoName = rowName({ piece: videoPiece, title: videoTitle });
            return (
              <article key={`${rowVideoId}:${thread.id}`} className="comment-card">
                <div className="comment-main">
                  <div className="comment-meta">
                    <strong>{thread.author || 'Viewer'}</strong>
                    {thread.isOwner && <span className="comment-owner-badge">You</span>}
                    <span className="muted small-text">{formatDate(thread.publishedAt)}</span>
                    {thread.likeCount > 0 && <span className="muted small-text">· {thread.likeCount} likes</span>}
                  </div>
                  <div className="comment-text">{thread.text}</div>
                  <div className="comment-actions">
                    <button
                      type="button"
                      className="small"
                      disabled={busyId === thread.topLevelCommentId}
                      onClick={() => {
                        setReplyOpenId(isReplying ? null : thread.topLevelCommentId);
                        setReplyText('');
                      }}
                    >
                      {isReplying ? 'Cancel' : 'Reply'}
                    </button>
                    {thread.replies.length > 0 && (
                      <button
                        type="button"
                        className="small"
                        onClick={() => setExpanded((prev) => ({ ...prev, [thread.id]: !isRepliesOpen }))}
                      >
                        {isRepliesOpen ? '▼' : '▶'} {thread.replies.length} {thread.replies.length === 1 ? 'Reply' : 'Replies'}
                      </button>
                    )}
                    {thread.isOwner ? (
                      <button
                        type="button"
                        className="small"
                        disabled={busyId === thread.topLevelCommentId}
                        onClick={() => void moderate(rowVideoId, thread.topLevelCommentId, 'delete')}
                      >
                        Delete
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="small"
                          disabled={busyId === thread.topLevelCommentId}
                          onClick={() => void moderate(rowVideoId, thread.topLevelCommentId, 'hide')}
                        >
                          Hide
                        </button>
                        <button
                          type="button"
                          className="small"
                          disabled={busyId === thread.topLevelCommentId}
                          onClick={() => void moderate(rowVideoId, thread.topLevelCommentId, 'spam')}
                        >
                          Spam
                        </button>
                      </>
                    )}
                  </div>

                  {isReplying && (
                    <div className="comment-reply-box">
                      <textarea
                        rows={2}
                        aria-label={`Reply to ${thread.author || 'comment'}`}
                        placeholder="Write a reply…"
                        value={replyText}
                        disabled={busyId === thread.topLevelCommentId}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <div className="comment-reply-actions">
                        <button
                          type="button"
                          className="small"
                          disabled={busyId === thread.topLevelCommentId || !replyText.trim()}
                          onClick={() => void postReply(rowVideoId, thread.topLevelCommentId)}
                        >
                          {busyId === thread.topLevelCommentId ? 'Posting…' : 'Post Reply'}
                        </button>
                      </div>
                    </div>
                  )}

                  {isRepliesOpen && thread.replies.length > 0 && (
                    <div className="comment-replies">
                      {thread.replies.map((r) => (
                        <div key={r.id} className="comment-reply">
                          <div className="comment-meta">
                            <strong>{r.author || 'Viewer'}</strong>
                            {r.isOwner && <span className="comment-owner-badge">You</span>}
                            <span className="muted small-text">{formatDate(r.publishedAt)}</span>
                            {r.isOwner && (
                              <button
                                type="button"
                                className="small comment-reply-delete"
                                disabled={busyId === r.id}
                                onClick={() => void moderate(rowVideoId, r.id, 'delete')}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                          <div className="comment-text">{r.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="comment-video">
                  {thumb && (
                    <a className="comment-video-thumb-btn" href={commentsHash(rowVideoId)} title={`Filter to ${displayVideoName}`}>
                      <img src={thumb} alt={videoTitle} className="comment-video-thumb" />
                    </a>
                  )}
                  <div className="comment-video-info">
                    <a className="comment-video-title" href={commentsHash(rowVideoId)}>
                      {displayVideoName}
                    </a>
                    <a className="small-text" href={`#Channel/Video/${encodeURIComponent(rowVideoId)}`}>
                      Video Detail ↗
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
