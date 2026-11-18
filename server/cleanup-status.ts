// Which pieces have something Clean Up would move to Trash, for the "Can Clean Up" badges on the Videos page
// (John, 2026-11-18). Working it out reads every video's CapCut projects, so it runs in the background, gives way to
// other requests between project files, and the page shows the last answer meanwhile. After the first run only the
// project files that changed are read again (cleanup.ts remembers the rest).
import fs from 'node:fs';
import { capcutLinksSlowly, cleanupPlan } from './cleanup.js';
import { safeResolve } from './config.js';
import { listProjectVideos } from './projects.js';

export interface PieceCleanup {
  /** Files Clean Up would move to Trash or into Intermediate. */
  files: number;
  /** Bytes that would go to Trash. */
  bytes: number;
  /**
   * Links in the video's CapCut projects to files that aren't there (Clean Up refuses while there are any). Counted
   * only when there are files to clean; otherwise 0.
   */
  missing: number;
}
export interface CleanupStatus {
  /** By piece: "<video>/Longform", "<video>/Shorts/<short>", and "<video>/Shorts" for Make Shorts' plan and graphs. */
  pieces: Record<string, PieceCleanup>;
  /** When the last full check finished (ms), or null before the first. */
  checkedAt: number | null;
  busy: boolean;
}

/** A check older than this starts a new one when the page asks. */
const FRESH_MS = 60_000;

let status: CleanupStatus = { pieces: {}, checkedAt: null, busy: false };
let stale = false;

/** The last answer; starts a new check in the background when it's old (or there's none yet). */
export function cleanupStatus(): CleanupStatus {
  if (!status.busy && (stale || status.checkedAt === null || Date.now() - status.checkedAt > FRESH_MS)) void refresh();
  return status;
}

/** After a cleanup: drop that piece's old answer and check again the next time the page asks. */
export function cleanupDone(piece: string) {
  const pieces = { ...status.pieces };
  delete pieces[piece];
  status = { ...status, pieces };
  stale = true;
}

/** Works out every piece's answer. Exported for the tests, which wait for it. */
export async function refresh(): Promise<void> {
  if (status.busy) return;
  status = { ...status, busy: true };
  stale = false;
  const pieces: Record<string, PieceCleanup> = {};
  try {
    for (const { projectId, video } of listProjectVideos()) {
      try {
        const links = await capcutLinksSlowly(projectId);
        const paths = video.pieces.filter((p) => p.kind !== 'reel').map((p) => p.path);
        if (fs.existsSync(safeResolve('projects', `${projectId}/Shorts`))) paths.push(`${projectId}/Shorts`);
        for (const piece of paths) {
          try {
            // What there would be to clean, setting the missing links aside: a video made by hand has nothing, and then
            // its old broken links don't matter (John, 2026-11-18). With files to clean, they block it.
            const plan = cleanupPlan(piece, { used: links.used, missing: [] });
            const files = plan.remove.length + plan.move.length;
            pieces[piece] = { files, bytes: plan.freed, missing: files ? links.missing.length : 0 };
          } catch {
            /* a piece that can't be listed gets no badge */
          }
        }
      } catch {
        /* a video that can't be read gets no badges */
      }
    }
    status = { pieces, checkedAt: Date.now(), busy: false };
  } catch {
    status = { ...status, busy: false };
  }
}
