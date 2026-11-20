// "Comment Posted": whether John has posted his own top-level comment on a video (the one he then pins in Studio).
// YouTube doesn't tell apps which comment is pinned, so this is the closest check there is. 1 unit per video.
import { youtubeAccessToken } from './youtube-auth.js';
import { youtubeFetch } from './youtube-quota.js';
import { youtubeVideoId } from './youtube-video.js';

/** posted: a top-level comment by the video's own channel exists. disabled: comments are turned off on the video. */
export interface CommentCheck {
  posted: boolean;
  disabled?: boolean;
  /** The channel's own comments, newest first, so a card can compare them with the file's Pinned Comment. */
  texts?: string[];
}

interface Thread { snippet?: { channelId?: string; topLevelComment?: { snippet?: { authorChannelId?: { value?: string }; textOriginal?: string; textDisplay?: string } } } }

/** The channel's own top-level comments among `threads` (a comment is the owner's when its author is the video's channel). */
export function ownComments(threads: Thread[]): string[] {
  return threads.flatMap((t) => {
    const c = t.snippet?.topLevelComment?.snippet;
    return c?.authorChannelId?.value && c.authorChannelId.value === t.snippet?.channelId ? [c.textOriginal ?? c.textDisplay ?? ''] : [];
  });
}

async function checkOne(token: string, id: string): Promise<CommentCheck> {
  // The 100 most relevant threads: a pinned comment comes first, and the owner's comments rank high.
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(id)}&maxResults=100&order=relevance&textFormat=plainText`;
  const res = await youtubeFetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403) {
    const body = await res.text();
    if (/commentsDisabled/.test(body)) return { posted: false, disabled: true };
    throw new Error(`YouTube refused to list comments (${res.status}).`);
  }
  if (!res.ok) throw new Error(`YouTube returned ${res.status} when listing comments.`);
  const data = (await res.json()) as { items?: Thread[] };
  const texts = ownComments(data.items ?? []);
  return { posted: texts.length > 0, texts };
}

/** Up to 50 videos at a time, a few in parallel. A video whose check fails gets no entry. */
export async function checkOwnComments(value: unknown): Promise<Record<string, CommentCheck>> {
  const ids = String(value ?? '').split(',').filter(Boolean).map(youtubeVideoId);
  if (!ids.length || ids.length > 50) throw new Error('Check between 1 and 50 videos at a time.');
  const token = await youtubeAccessToken();
  const result: Record<string, CommentCheck> = {};
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      try { result[id] = await checkOne(token, id); } catch { /* left out: the screen shows it as not confirmed */ }
    }));
  }
  return result;
}
