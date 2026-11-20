import fs from 'node:fs';
import path from 'node:path';
import { appDir, safeResolve } from './config.js';
import { listProjectVideos, type Video } from './projects.js';
import { listDrafts, plainDraftName } from './create.js';
import { youtubeVideoId } from './youtube-video.js';
import { parseFields } from '../web/src/packaging.js';

export type LinkState = 'linked' | 'missing' | 'unknown';
/**
 * One video's place on the way to YouTube. capcut: a CapCut project with its name exists (the video folder's name for a
 * longform, the short's folder name for a short). exported: a file in Exports. packaged: the newest packaging version
 * has a thumbnail and a YouTube title. Being on YouTube is `link`.
 */
export interface VideoOverview { path: string; projectId: string; name: string; kind: 'longform' | 'short'; link: LinkState; videoId?: string; localThumbnail: boolean; titles?: string[]; capcut: boolean; exported: boolean; packaged: boolean; }
type RecordInfo = { piece?: string; status?: string; videoId?: string };
type SavedLink = { state: LinkState; id?: string };

/** Saved YouTube titles from each packaging version, for finding videos by a published or earlier title. */
function savedTitles(piece: Video['pieces'][number]): string[] {
  return [...new Set(piece.versions.flatMap(versionTitles))];
}

/** The YouTube titles saved in one packaging version. */
function versionTitles(version: Video['pieces'][number]['versions'][number]): string[] {
  const titles: string[] = [];
  for (const doc of version.docs) {
    if (!/^youtube.*\.md$/i.test(path.posix.basename(doc.name))) continue;
    try {
      const file = safeResolve('projects', doc.path);
      if (fs.statSync(file).size > 2_000_000) continue;
      const title = parseFields(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))?.find(field => field.label.toLowerCase() === 'title')?.value.trim();
      if (title) titles.push(title);
    } catch { /* A missing or unreadable version should not hide the project list. */ }
  }
  return titles;
}

/** Read upload records once, rather than once per project. An unreadable record is not proof of a missing link. */
export function readLinkRecords(dir: string): { jobs: RecordInfo[]; complete: boolean } {
  try {
    let complete = true;
    const jobs = fs.readdirSync(dir).filter((file) => /^[\da-f-]+\.json$/i.test(file)).flatMap((file) => {
      try { const job: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); if (!job || typeof job !== 'object' || typeof (job as RecordInfo).piece !== 'string' || typeof (job as RecordInfo).status !== 'string') throw new Error('Invalid upload record'); return [job as RecordInfo]; }
      catch { complete = false; return []; }
    });
    return { jobs, complete };
  } catch (e) { return { jobs: [], complete: (e as NodeJS.ErrnoException).code === 'ENOENT' }; }
}

export function makeVideoOverview(videos: { projectId: string; video: Video }[], records: { jobs: RecordInfo[]; complete: boolean }, savedUrl: (projectId: string) => SavedLink, capcutNames: Set<string> = new Set()): VideoOverview[] {
  const byPiece = new Map<string, RecordInfo[]>();
  for (const job of records.jobs) if (job.piece) byPiece.set(job.piece, [...(byPiece.get(job.piece) ?? []), job]);
  return videos.flatMap(({ projectId, video }) => video.pieces.filter((piece) => piece.kind !== 'reel').map((piece) => {
    const jobs = byPiece.get(piece.path) ?? [];
    const ids = new Set<string>();
    for (const job of jobs) { if (!job.videoId || !['done', 'uploading'].includes(job.status ?? '')) continue; try { ids.add(youtubeVideoId(job.videoId)); } catch { /* Bad records cannot establish a link. */ } }
    const saved = piece.kind === 'longform' ? savedUrl(projectId) : { state: 'missing' as LinkState };
    if (saved.id) ids.add(saved.id);
    const latest = piece.versions.at(-1);
    const uncertain = jobs.some((job) => job.status === 'unknown' || job.status === 'uploading' || (job.status === 'done' && !job.videoId)) || !records.complete || saved.state === 'unknown';
    return { path: piece.path, projectId, name: piece.name, kind: piece.kind as 'longform' | 'short', link: ids.size ? 'linked' : uncertain ? 'unknown' : 'missing', videoId: ids.size === 1 ? [...ids][0] : undefined, localThumbnail: (latest?.covers.length ?? 0) > 0, titles: savedTitles(piece),
      capcut: capcutNames.has(plainDraftName(piece.kind === 'longform' ? path.posix.basename(projectId) : piece.name).toLowerCase()),
      exported: piece.exports.length > 0,
      packaged: !!latest && latest.covers.length > 0 && versionTitles(latest).length > 0 };
  }));
}

function savedLongformLink(projectId: string): SavedLink {
  try {
    const file = safeResolve('projects', path.join(projectId, 'Shorts', 'Longform URL.txt'));
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!text) return { state: 'missing' };
    try { return { state: 'linked', id: youtubeVideoId(text) }; } catch { return { state: 'unknown' }; }
  } catch (e) { return { state: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown' }; }
}

export function videoOverview(): VideoOverview[] {
  let capcut = new Set<string>();
  try { capcut = new Set(listDrafts().map((d) => plainDraftName(d).toLowerCase())); } catch { /* CapCut's folder can't be read: no video shows a CapCut project. */ }
  return makeVideoOverview(listProjectVideos(), readLinkRecords(process.env.HQ_YOUTUBE_JOBS_DIR ?? path.join(appDir, 'data', 'youtube-uploads')), savedLongformLink, capcut);
}
