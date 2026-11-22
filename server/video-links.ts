// One answer to "which YouTube video belongs to which project folder?", for the whole app.
// It combines the upload records (data/youtube-uploads) with each video's Drive file Shorts\Longform URL.txt,
// the same two places the Video Projects card already reads when it links a longform.
import path from 'node:path';
import { listProjectVideos } from './projects.js';
import { readLongformUrl } from './shorts.js';
import { linkedVideos } from './youtube.js';
import { youtubeVideoId } from './youtube-video.js';

export interface VideoLink { piece: string; kind?: 'longform' | 'short'; sourceLongformPiece?: string }

/** YouTube video id -> the project piece folder it belongs to (and that piece's kind, when its folder is known). */
export function videoLinks(): Map<string, VideoLink> {
  const pieces = new Map<string, VideoLink>();
  let projects: ReturnType<typeof listProjectVideos> = [];
  try {
    projects = listProjectVideos();
    for (const { video } of projects) {
      const longform = video.pieces.find((p) => p.kind === 'longform');
      for (const p of video.pieces) {
        const link: VideoLink = { piece: p.path, kind: p.kind === 'longform' ? 'longform' : 'short' };
        if (p.kind === 'short' && longform) link.sourceLongformPiece = longform.path;
        pieces.set(p.path, link);
      }
    }
  } catch { /* Drive not running: kinds are guessed from length instead */ }

  const links = new Map<string, VideoLink>();
  const linkedPieces = new Set<string>();
  for (const { piece, videoId } of linkedVideos()) {
    links.set(videoId, pieces.get(piece) ?? { piece });
    linkedPieces.add(piece);
  }
  // A longform with no upload record may still have its address in the Drive file.
  for (const { video } of projects) {
    const oldPiece = path.posix.join(video.path, 'Longform');
    const piece = video.pieces.find((p) => p.kind === 'longform')?.path ?? oldPiece;
    if (linkedPieces.has(piece) || linkedPieces.has(oldPiece)) continue;
    try { links.set(youtubeVideoId(readLongformUrl(video.path)), { piece, kind: 'longform' }); } catch { /* no usable address */ }
  }
  return links;
}
