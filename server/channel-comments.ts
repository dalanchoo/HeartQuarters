// Downloaded YouTube comments per video, saved in Drive under Video Projects\_HeartQuarters\Comments\<videoId>.json.
import fs from 'node:fs';
import path from 'node:path';
import { readChannelVideos, refreshChannelVideos } from './channel-videos.js';
import { safeResolve } from './config.js';
import { makeFolder, readable, readText, writable, writeFile } from './safe-files.js';
import { youtubeAccessToken } from './youtube-auth.js';
import { QUOTA_USED_UP, youtubeFetch } from './youtube-quota.js';

export const COMMENTS_DIR = '_HeartQuarters/Comments';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const COMMENT_ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const COMMENT_TEXT_MAX = 10_000;
const MAX_PAGES = 10;
const SYNC_BATCH_SIZE = 5;

export type ModerationAction = 'hide' | 'spam' | 'delete';

export interface StoredReply {
  id: string;
  author: string;
  authorChannelId?: string;
  isOwner: boolean;
  text: string;
  publishedAt: string;
  updatedAt: string;
  likeCount: number;
}

export interface StoredCommentThread {
  id: string;
  topLevelCommentId: string;
  author: string;
  authorChannelId?: string;
  isOwner: boolean;
  text: string;
  publishedAt: string;
  updatedAt: string;
  likeCount: number;
  totalReplyCount: number;
  replies: StoredReply[];
  /** True when the channel owner wrote the top-level comment or at least one reply. */
  ownerReplied: boolean;
}

export interface VideoCommentsFile {
  version: 1;
  videoId: string;
  channelId?: string;
  syncedAt: string;
  disabled?: boolean;
  truncated?: boolean;
  threads: StoredCommentThread[];
}

export interface StoredCommentsSummary {
  files: VideoCommentsFile[];
  totalVideos: number;
  totalThreads: number;
  disabledVideos: number;
  lastSyncedAt: string | null;
}

export interface CommentsSyncResult {
  synced: number;
  disabled: number;
  failed: { videoId: string; error: string }[];
  totalThreads: number;
  syncedAt: string;
}

interface RawCommentSnippet {
  authorDisplayName?: string;
  authorChannelId?: { value?: string };
  textOriginal?: string;
  textDisplay?: string;
  publishedAt?: string;
  updatedAt?: string;
  likeCount?: number;
}

interface RawComment {
  id?: string;
  snippet?: RawCommentSnippet;
}

interface RawThread {
  id?: string;
  snippet?: {
    channelId?: string;
    totalReplyCount?: number;
    topLevelComment?: RawComment;
  };
  replies?: { comments?: RawComment[] };
}

type FetchFn = typeof youtubeFetch;

function checkVideoId(raw: unknown): string {
  if (typeof raw !== 'string' || !VIDEO_ID_RE.test(raw.trim())) {
    throw new Error('Choose a valid YouTube video.');
  }
  return raw.trim();
}

function commentsFolder(forWrite: boolean): string {
  const dir = safeResolve('projects', COMMENTS_DIR);
  if (forWrite) return makeFolder(dir);
  return readable(dir);
}

function commentsFile(videoId: string, forWrite: boolean): string {
  checkVideoId(videoId);
  const dir = commentsFolder(forWrite);
  const candidate = path.join(dir, `${videoId}.json`);
  return forWrite ? writable(candidate) : readable(candidate);
}

function normalizeReply(raw: RawComment, channelId?: string): StoredReply | null {
  const s = raw.snippet;
  if (!raw.id || !s) return null;
  const authorChannelId = s.authorChannelId?.value || undefined;
  return {
    id: raw.id,
    author: s.authorDisplayName ?? '',
    ...(authorChannelId ? { authorChannelId } : {}),
    isOwner: Boolean(channelId && authorChannelId && authorChannelId === channelId),
    text: s.textOriginal ?? s.textDisplay ?? '',
    publishedAt: s.publishedAt ?? '',
    updatedAt: s.updatedAt ?? s.publishedAt ?? '',
    likeCount: Number(s.likeCount ?? 0),
  };
}

function validStoredFile(data: unknown): data is VideoCommentsFile {
  const item = data as VideoCommentsFile;
  return Boolean(
    item
    && item.version === 1
    && typeof item.videoId === 'string'
    && VIDEO_ID_RE.test(item.videoId)
    && typeof item.syncedAt === 'string'
    && Array.isArray(item.threads),
  );
}

/** Reads the saved comments file for one video, or returns null if not synced yet. */
export function readVideoComments(rawVideoId: unknown): VideoCommentsFile | null {
  const videoId = checkVideoId(rawVideoId);
  const dir = commentsFolder(false);
  if (!fs.existsSync(dir)) return null;
  const candidate = path.join(dir, `${videoId}.json`);
  if (!fs.existsSync(candidate)) return null;
  const raw = readText(commentsFile(videoId, false));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`The comments file for ${videoId} could not be read.`);
  }
  if (!validStoredFile(parsed)) {
    throw new Error(`The comments file for ${videoId} has an unexpected format.`);
  }
  return parsed;
}

/** Lists all saved video comment files from Drive. */
export function listStoredComments(): StoredCommentsSummary {
  const dir = commentsFolder(false);
  if (!fs.existsSync(dir)) {
    return { files: [], totalVideos: 0, totalThreads: 0, disabledVideos: 0, lastSyncedAt: null };
  }
  const files: VideoCommentsFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const match = /^([A-Za-z0-9_-]{11})\.json$/.exec(name);
    if (!match) continue;
    try {
      const file = readVideoComments(match[1]);
      if (file) files.push(file);
    } catch {
      // Skip unreadable or malformed cache files while keeping the rest available.
    }
  }
  let totalThreads = 0;
  let disabledVideos = 0;
  let lastSyncedAt: string | null = null;
  for (const f of files) {
    totalThreads += f.threads.length;
    if (f.disabled) disabledVideos++;
    if (!lastSyncedAt || f.syncedAt > lastSyncedAt) lastSyncedAt = f.syncedAt;
  }
  return { files, totalVideos: files.length, totalThreads, disabledVideos, lastSyncedAt };
}

async function fetchAllReplies(
  token: string,
  parentId: string,
  channelId: string | undefined,
  fetcher: FetchFn,
): Promise<StoredReply[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    parentId,
    maxResults: '100',
    textFormat: 'plainText',
  });
  const res = await fetcher(`https://www.googleapis.com/youtube/v3/comments?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: RawComment[] };
  return (data.items ?? []).map((c) => normalizeReply(c, channelId)).filter((r): r is StoredReply => r !== null);
}

/** Downloads comment threads (and replies) for one YouTube video without writing to Drive. */
export async function fetchVideoComments(
  token: string,
  rawVideoId: unknown,
  fetcher: FetchFn = youtubeFetch,
  now = new Date(),
): Promise<VideoCommentsFile> {
  const videoId = checkVideoId(rawVideoId);
  const threads: StoredCommentThread[] = [];
  let channelId: string | undefined;
  let pageToken = '';
  let pages = 0;
  let truncated = false;

  do {
    const params = new URLSearchParams({
      part: 'snippet,replies',
      videoId,
      maxResults: '100',
      order: 'time',
      textFormat: 'plainText',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetcher(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      const body = await res.text().catch(() => '');
      if (/commentsDisabled/.test(body)) {
        return { version: 1, videoId, syncedAt: now.toISOString(), disabled: true, threads: [] };
      }
      if (/quotaExceeded|dailyLimitExceeded/.test(body)) {
        throw new Error(QUOTA_USED_UP);
      }
      throw new Error(`YouTube refused to list comments (${res.status}).`);
    }
    if (!res.ok) {
      throw new Error(`YouTube returned ${res.status} when listing comments.`);
    }

    const data = (await res.json()) as { items?: RawThread[]; nextPageToken?: string };
    for (const item of data.items ?? []) {
      const top = item.snippet?.topLevelComment;
      const topSnippet = top?.snippet;
      if (!item.id || !top?.id || !topSnippet) continue;
      channelId ??= item.snippet?.channelId;
      const itemChannelId = item.snippet?.channelId ?? channelId;
      const authorChannelId = topSnippet.authorChannelId?.value || undefined;
      const isOwner = Boolean(itemChannelId && authorChannelId && authorChannelId === itemChannelId);
      const totalReplyCount = Number(item.snippet?.totalReplyCount ?? 0);
      let replies = (item.replies?.comments ?? [])
        .map((c) => normalizeReply(c, itemChannelId))
        .filter((r): r is StoredReply => r !== null);
      if (totalReplyCount > replies.length) {
        const full = await fetchAllReplies(token, top.id, itemChannelId, fetcher);
        if (full.length >= replies.length) replies = full;
      }
      const ownerReplied = isOwner || replies.some((r) => r.isOwner);
      threads.push({
        id: item.id,
        topLevelCommentId: top.id,
        author: topSnippet.authorDisplayName ?? '',
        ...(authorChannelId ? { authorChannelId } : {}),
        isOwner,
        text: topSnippet.textOriginal ?? topSnippet.textDisplay ?? '',
        publishedAt: topSnippet.publishedAt ?? '',
        updatedAt: topSnippet.updatedAt ?? topSnippet.publishedAt ?? '',
        likeCount: Number(topSnippet.likeCount ?? 0),
        totalReplyCount: Math.max(totalReplyCount, replies.length),
        replies,
        ownerReplied,
      });
    }

    pageToken = data.nextPageToken ?? '';
    pages++;
    if (pageToken && pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
  } while (pageToken);

  return {
    version: 1,
    videoId,
    ...(channelId ? { channelId } : {}),
    syncedAt: now.toISOString(),
    ...(truncated ? { truncated: true } : {}),
    threads,
  };
}

/** Downloads and saves comments for one YouTube video into Drive. */
export async function syncVideoComments(
  rawVideoId: unknown,
  deps?: { token?: string; fetcher?: FetchFn; now?: Date },
): Promise<VideoCommentsFile> {
  const videoId = checkVideoId(rawVideoId);
  const token = deps?.token ?? (await youtubeAccessToken());
  const file = await fetchVideoComments(token, videoId, deps?.fetcher, deps?.now);
  writeFile(commentsFile(videoId, true), JSON.stringify(file, null, 2) + '\n');
  return file;
}

let syncAllInProgress: Promise<CommentsSyncResult> | undefined;

async function runSyncAll(deps?: {
  videoIds?: string[];
  token?: string;
  fetcher?: FetchFn;
  now?: Date;
}): Promise<CommentsSyncResult> {
  let ids = deps?.videoIds;
  if (!ids) {
    const catalog = readChannelVideos() ?? (await refreshChannelVideos());
    ids = catalog.videos.map((v) => v.id);
  }
  const uniqueIds = [...new Set(ids.map(checkVideoId))];
  if (!uniqueIds.length) {
    throw new Error('No channel videos found. Refresh YouTube Data first.');
  }

  const token = deps?.token ?? (await youtubeAccessToken());
  const now = deps?.now ?? new Date();
  let synced = 0;
  let disabled = 0;
  let totalThreads = 0;
  const failed: { videoId: string; error: string }[] = [];

  for (let i = 0; i < uniqueIds.length; i += SYNC_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + SYNC_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => syncVideoComments(id, { token, fetcher: deps?.fetcher, now })),
    );
    let quotaHit = false;
    results.forEach((res, idx) => {
      const videoId = batch[idx];
      if (res.status === 'fulfilled') {
        synced++;
        if (res.value.disabled) disabled++;
        totalThreads += res.value.threads.length;
      } else {
        const message = res.reason instanceof Error ? res.reason.message : String(res.reason);
        failed.push({ videoId, error: message });
        if (message === QUOTA_USED_UP) quotaHit = true;
      }
    });
    if (quotaHit) break;
  }

  return { synced, disabled, failed, totalThreads, syncedAt: now.toISOString() };
}

/** Syncs comments for all channel videos (or a provided list) into Drive. Concurrent calls share the active run. */
export function syncAllChannelComments(deps?: {
  videoIds?: string[];
  token?: string;
  fetcher?: FetchFn;
  now?: Date;
}): Promise<CommentsSyncResult> {
  if (syncAllInProgress) return syncAllInProgress;
  syncAllInProgress = runSyncAll(deps).finally(() => {
    syncAllInProgress = undefined;
  });
  return syncAllInProgress;
}

function checkCommentId(raw: unknown): string {
  if (typeof raw !== 'string' || !COMMENT_ID_RE.test(raw.trim())) {
    throw new Error('Choose a valid comment.');
  }
  return raw.trim();
}

function recomputeThreadFlags(thread: StoredCommentThread): StoredCommentThread {
  const ownerReplied = thread.isOwner || thread.replies.some((r) => r.isOwner);
  return {
    ...thread,
    totalReplyCount: Math.max(thread.totalReplyCount, thread.replies.length),
    ownerReplied,
  };
}

/** Posts a reply to a top-level comment on YouTube and updates the saved Drive file if present. */
export async function replyToComment(
  rawVideoId: unknown,
  rawParentId: unknown,
  rawText: unknown,
  deps?: { token?: string; fetcher?: FetchFn; now?: Date },
): Promise<VideoCommentsFile | null> {
  const videoId = checkVideoId(rawVideoId);
  const parentId = checkCommentId(rawParentId);
  if (typeof rawText !== 'string') throw new Error('Type a reply first.');
  const text = rawText.trim();
  if (!text) throw new Error('Type a reply first.');
  if (text.length > COMMENT_TEXT_MAX) throw new Error('That reply is too long.');

  const token = deps?.token ?? (await youtubeAccessToken());
  const fetcher = deps?.fetcher ?? youtubeFetch;
  const res = await fetcher('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        parentId,
        textOriginal: text,
      },
    }),
  });
  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    if (/quotaExceeded|dailyLimitExceeded/.test(body)) throw new Error(QUOTA_USED_UP);
    throw new Error('YouTube refused to post that reply. Check that your YouTube connection has permission.');
  }
  if (!res.ok) {
    throw new Error(`YouTube returned ${res.status} when posting your reply.`);
  }

  const created = (await res.json()) as RawComment;
  const now = (deps?.now ?? new Date()).toISOString();
  const reply: StoredReply = {
    id: created.id ?? `local-${Date.now()}`,
    author: created.snippet?.authorDisplayName ?? 'Heart Mind Fusion',
    ...(created.snippet?.authorChannelId?.value ? { authorChannelId: created.snippet.authorChannelId.value } : {}),
    isOwner: true,
    text: created.snippet?.textOriginal ?? text,
    publishedAt: created.snippet?.publishedAt ?? now,
    updatedAt: created.snippet?.updatedAt ?? created.snippet?.publishedAt ?? now,
    likeCount: Number(created.snippet?.likeCount ?? 0),
  };

  const existing = readVideoComments(videoId);
  if (!existing) return null;
  const updated: VideoCommentsFile = {
    ...existing,
    threads: existing.threads.map((t) => {
      if (t.topLevelCommentId !== parentId && t.id !== parentId) return t;
      return recomputeThreadFlags({
        ...t,
        totalReplyCount: t.totalReplyCount + 1,
        replies: [...t.replies, reply],
      });
    }),
  };
  writeFile(commentsFile(videoId, true), JSON.stringify(updated, null, 2) + '\n');
  return updated;
}

/** Hides, marks as spam, or deletes a comment on YouTube and updates the saved Drive file if present. */
export async function moderateComment(
  rawVideoId: unknown,
  rawCommentId: unknown,
  rawAction: unknown,
  deps?: { token?: string; fetcher?: FetchFn },
): Promise<VideoCommentsFile | null> {
  const videoId = checkVideoId(rawVideoId);
  const commentId = checkCommentId(rawCommentId);
  if (rawAction !== 'hide' && rawAction !== 'spam' && rawAction !== 'delete') {
    throw new Error('Choose hide, spam, or delete.');
  }
  const action: ModerationAction = rawAction;
  const token = deps?.token ?? (await youtubeAccessToken());
  const fetcher = deps?.fetcher ?? youtubeFetch;

  let res: Response;
  if (action === 'delete') {
    const params = new URLSearchParams({ id: commentId });
    res = await fetcher(`https://www.googleapis.com/youtube/v3/comments?${params}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    const params = new URLSearchParams({
      id: commentId,
      moderationStatus: action === 'hide' ? 'heldForReview' : 'rejected',
    });
    res = await fetcher(`https://www.googleapis.com/youtube/v3/comments/setModerationStatus?${params}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    if (/quotaExceeded|dailyLimitExceeded/.test(body)) throw new Error(QUOTA_USED_UP);
    throw new Error('YouTube refused to update that comment. Check your YouTube permissions.');
  }
  if (!res.ok) {
    throw new Error(`YouTube returned ${res.status} when updating that comment.`);
  }

  const existing = readVideoComments(videoId);
  if (!existing) return null;
  const updated: VideoCommentsFile = {
    ...existing,
    threads: existing.threads
      .filter((t) => t.topLevelCommentId !== commentId && t.id !== commentId)
      .map((t) => {
        const nextReplies = t.replies.filter((r) => r.id !== commentId);
        if (nextReplies.length === t.replies.length) return t;
        return recomputeThreadFlags({
          ...t,
          totalReplyCount: Math.max(0, t.totalReplyCount - 1),
          replies: nextReplies,
        });
      }),
  };
  writeFile(commentsFile(videoId, true), JSON.stringify(updated, null, 2) + '\n');
  return updated;
}
