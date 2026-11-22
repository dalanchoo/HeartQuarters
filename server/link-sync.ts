// Keeps each piece's Drive file (YouTube Link.txt) and the upload records in data/ in step.
// The Drive file is the one that counts: a missing file is filled in from the record, a missing or different record
// is rebuilt from the file. So deleting data/youtube-uploads loses nothing.
import { linkFileVideoId, saveLinkFile } from './link-files.js';
import { listProjectVideos } from './projects.js';
import { linkedVideos, restoreLinkRecord } from './youtube.js';

export function syncLinkFiles(): { written: number; restored: number } {
  const newest = new Map<string, string>(); // piece -> its newest finished video id (linkedVideos is oldest first)
  for (const { piece, videoId } of linkedVideos()) newest.set(piece, videoId);
  let written = 0; let restored = 0;
  for (const { video } of listProjectVideos()) {
    for (const piece of video.pieces) {
      if (piece.kind === 'reel') continue;
      const fromFile = linkFileVideoId(piece.path);
      const fromRecord = newest.get(piece.path);
      try {
        if (fromFile && fromFile !== fromRecord) { restoreLinkRecord(piece.path, fromFile); restored++; }
        else if (!fromFile && fromRecord && saveLinkFile(piece.path, fromRecord, false) === 'written') written++;
      } catch { /* one piece that can't be read or written must not stop the others */ }
    }
  }
  return { written, restored };
}
