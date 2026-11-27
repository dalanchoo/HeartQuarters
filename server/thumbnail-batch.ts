// Make All 6 Drafts: for each of a video's top 3 title/thumbnail pairs, picks the #1 photo (reusing a fresh saved
// ranking or running Photo Ranking with the chosen AI) and generates one draft with ChatGPT and one with Gemini.
import fs from 'node:fs';
import path from 'node:path';
import type { AiId } from './ai.js';
import { safeResolve } from './config.js';
import { rankPair, readSavedRanking, type RankingDeps } from './photo-ranking.js';
import { DRAFTS_FOLDER, PICKS_FILE, readPicks, type BriefPick } from './projects.js';
import { readable } from './safe-files.js';
import { makeImage, startThumbnailFor, type ImageAi, type MakeImage } from './thumbnails.js';

export interface BatchPairStatus {
  index: number;
  title: string;
  thumbnailText: string;
  state: 'pending' | 'ranking' | 'generating' | 'done' | 'skipped' | 'failed';
  photo?: string;
  reason?: string;
  conversations?: { ai: ImageAi; conversation: string }[];
}

export interface BatchThumbJob {
  piece: string;
  ai: AiId;
  ais: ImageAi[];
  state: 'working' | 'done' | 'failed';
  pairs: BatchPairStatus[];
  error?: string;
}

export interface BatchThumbDeps {
  ranking?: RankingDeps;
  make?: MakeImage;
}

const batchJobs = new Map<string, BatchThumbJob>();

/** The current or most recent batch thumbnail job for `piece`, or null. */
export function batchThumbJob(piece: string): BatchThumbJob | null {
  return batchJobs.get(piece) ?? null;
}

function draftsOf(piece: string): string {
  if (!piece) throw new Error('No video given.');
  const dir = safeResolve('projects', piece);
  if (!fs.existsSync(path.join(dir, 'Packaging'))) throw new Error(`"${piece}" has no Packaging folder.`);
  return path.join(dir, 'Packaging', DRAFTS_FOLDER);
}

/**
 * Picks the best photo for a pair: reuses its saved ranking if the offered photos haven't changed and it has at least
 * one photo; otherwise asks `ai` to rank the pair's candidates.
 */
async function bestPhotoForPair(piece: string, pick: BriefPick, ai: AiId, deps: RankingDeps): Promise<string | null> {
  const saved = readSavedRanking(piece, pick, deps);
  if (saved && !saved.changed && saved.ranked.length > 0) return saved.ranked[0].photo;
  const fresh = await rankPair(piece, pick, deps, ai);
  return fresh.ranked[0]?.photo ?? null;
}

/** Which image AIs to run for each pair; defaults to both ChatGPT and Gemini. */
export function parseBatchAis(value: unknown): ImageAi[] {
  if (value === undefined) return ['codex', 'gemini'];
  if (!Array.isArray(value)) throw new Error('Choose ChatGPT, Gemini, or both.');
  const list = [...new Set(value.filter((v): v is ImageAi => v === 'codex' || v === 'gemini'))];
  if (!list.length) throw new Error('Tick ChatGPT, Gemini, or both.');
  return list;
}

/**
 * Starts generating thumbnails for every pair in Picks.json using the selected `ais` (ChatGPT, Gemini, or both).
 * Runs one pair at a time (selected AIs in parallel per pair) so neither AI is hit with 3 image calls at once.
 */
export function startBatchThumbnails(piece: string, ai: AiId = 'claude', deps: BatchThumbDeps = {}, ais: ImageAi[] = ['codex', 'gemini']): { job: BatchThumbJob; finished: Promise<void> } {
  const selected = parseBatchAis(ais);
  const drafts = draftsOf(piece);
  if (batchJobs.get(piece)?.state === 'working') throw new Error('Already generating drafts for all pairs on this video.');
  const picks = readPicks(readable(path.join(drafts, PICKS_FILE)));
  if (!picks?.length) throw new Error('Write a brief and pick the top 3 pairs first.');
  const make = deps.make ?? makeImage;
  const rankingDeps = deps.ranking ?? {};
  const job: BatchThumbJob = {
    piece,
    ai,
    ais: selected,
    state: 'working',
    pairs: picks.map((p, index) => ({ index, title: p.title, thumbnailText: p.thumbnailText, state: 'pending' })),
  };
  batchJobs.set(piece, job);

  const finished = (async () => {
    for (const [i, pick] of picks.entries()) {
      const pair = job.pairs[i];
      pair.state = 'ranking';
      let photo: string | null = null;
      try {
        photo = await bestPhotoForPair(piece, pick, ai, rankingDeps);
      } catch (e) {
        pair.state = 'skipped';
        pair.reason = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (!photo) {
        pair.state = 'skipped';
        pair.reason = 'No eligible photo matched this pair.';
        continue;
      }
      pair.photo = photo;
      pair.state = 'generating';

      const started: { ai: ImageAi; conversation: string; finished: Promise<void> }[] = [];
      const startErrors: string[] = [];
      for (const imageAi of selected) {
        try {
          const { job: thumbJob, finished: thumbDone } = startThumbnailFor(piece, pick, photo, imageAi, make);
          started.push({ ai: imageAi, conversation: thumbJob.conversation, finished: thumbDone });
        } catch (e) {
          startErrors.push(`${imageAi}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      pair.conversations = started.map(({ ai: imageAi, conversation }) => ({ ai: imageAi, conversation }));
      const results = await Promise.allSettled(started.map(s => s.finished));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason instanceof Error ? r.reason.message : String(r.reason));
      const errors = [...startErrors, ...failed];
      if (errors.length === selected.length) {
        pair.state = 'failed';
        pair.reason = errors.join(' · ');
      } else {
        pair.state = 'done';
        if (errors.length) pair.reason = errors.join(' · ');
      }
    }
  })().then(
    () => {
      job.state = 'done';
    },
    (e: unknown) => {
      job.state = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
    },
  );
  return { job, finished };
}
