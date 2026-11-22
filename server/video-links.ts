// One answer to "which YouTube video belongs to which project folder?", for the whole app.
// It combines the upload records (data/youtube-uploads) with each video's Drive file Shorts\Longform URL.txt,
// the same two places the Video Projects card already reads when it links a longform.
import path from 'node:path';
import { listProjectVideos } from './projects.js';
import { readLongformUrl } from './shorts.js';
import { linkedVideos } from './youtube.js';
import { youtubeVideoId } from './youtube-video.js';

export interface VideoLink { piece: string; kind?: 'longform' | 'short' }

/** YouTube video id -> the project piece folder it belongs to (and that piece's kind, when its folder is known). */
export function videoLinks(): Map<string, VideoLink> {
  const kinds = new Map<string, 'longform' | 'short'>();
  const videos: string[] = [];
  try {
    for (const { video } of listProjectVideos()) {
      videos.push(video.path);
      for (const p of video.pieces) kinds.set(p.path, p.kind === 'longform' ? 'longform' : 'short');
    }
  } catch { /* Drive not running: kinds are guessed from length instead */ }

  const links = new Map<string, VideoLink>();
  const linkedPieces = new Set<string>();
  for (const { piece, videoId } of linkedVideos()) {
    links.set(videoId, { piece, kind: kinds.get(piece) });
    linkedPieces.add(piece);
  }
  // A longform with no upload record may still have its address in the Drive file.
  for (const video of videos) {
    const piece = path.posix.join(video, 'Longform');
    if (linkedPieces.has(piece)) continue;
    try { links.set(youtubeVideoId(readLongformUrl(video)), { piece, kind: 'longform' }); } catch { /* no usable address */ }
  }
  return links;
}
