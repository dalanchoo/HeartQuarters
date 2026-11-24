// The newest downloaded stats of one video, for the video list: a glance at how each video is doing.
// Only reads Stats.json files already in the video's Analytics folder; never asks YouTube.
import fs from 'node:fs';
import { safeResolve } from './config.js';
import { analyticsSnapshots } from './analytics-analysis.js';
import { summarizeSnapshot, type SnapshotLike } from './analytics-summary.js';

export interface LatestStats {
  /** The Analytics folder it came from, e.g. "2026-11-21 (3)". */
  snapshot: string;
  downloadedAt: string;
  /** Lifetime to date, as of the download. */
  views: number | null;
  averageViewPercent: number | null;
  impressions: number | null;
  ctrPercent: number | null;
  reachFrom: string | null;
  reachTo: string | null;
}

// Parsing every video's Stats.json each time the list loads would be slow on Drive, so each file's result is kept
// until the file changes (same size and modification time).
const kept = new Map<string, { size: number; mtimeMs: number; stats: LatestStats }>();

export function latestStats(piece: string): LatestStats | undefined {
  let snapshot: string | undefined;
  try { snapshot = analyticsSnapshots(piece)[0]; } catch { return undefined; }
  if (!snapshot) return undefined;
  try {
    const file = safeResolve('projects', `${piece}/Analytics/${snapshot}/Stats.json`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) return undefined;
    const old = kept.get(file);
    if (old && old.size === stat.size && old.mtimeMs === stat.mtimeMs) return old.stats;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as SnapshotLike;
    const summary = summarizeSnapshot(data);
    const lifetime = summary.periods.at(-1);
    const stats: LatestStats = {
      snapshot, downloadedAt: typeof data.downloadedAt === 'string' ? data.downloadedAt : '',
      views: lifetime?.views ?? null, averageViewPercent: lifetime?.averageViewPercent ?? null,
      impressions: summary.reach?.impressions ?? null, ctrPercent: summary.reach?.ctrPercent ?? null,
      reachFrom: summary.reach?.from ?? null, reachTo: summary.reach?.to ?? null,
    };
    kept.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, stats });
    return stats;
  } catch {
    return undefined; // A damaged or unreadable Stats.json just shows no numbers.
  }
}
