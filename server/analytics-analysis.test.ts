import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyticsAnalysis, analyticsSnapshots, startAnalyticsAnalysis, startAnalyticsSummary } from './analytics-analysis.js';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import type { AskAi } from './brief.js';

let root: string; let previous: string;
beforeEach(() => { root = makeTree({ 'Video/Longform/Analytics/2026-11-18/Stats.json': JSON.stringify({ downloadedAt: '2026-11-18', periods: [] }), 'Analytics/2026-11-18/Stats.json': JSON.stringify({ downloadedAt: '2026-11-18', reports: [] }) }); previous = config.videoProjectsDir; config.videoProjectsDir = root; });
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });

describe('analytics analysis', () => {
  it('gives each AI only the same stats, then combines all three reviews and saves them alongside the snapshot', async () => {
    const seen: string[][] = [];
    const ask: AskAi = async (ai, _prompt, cwd) => { const files = fs.readdirSync(cwd).sort(); seen.push(files); return `${ai} review ${files.length}`; };
    expect(analyticsSnapshots('Video/Longform')).toEqual(['2026-11-18']);
    const { job, finished } = startAnalyticsAnalysis('Video/Longform', '2026-11-18', ask);
    await finished;
    expect(job.state).toBe('done');
    expect(seen.slice(0, 3)).toEqual([['Context.txt', 'Stats.json'], ['Context.txt', 'Stats.json'], ['Context.txt', 'Stats.json']]);
    expect(seen[3]).toEqual(['ChatGPT.md', 'Claude.md', 'Context.txt', 'Gemini.md', 'Stats.json']);
    expect(seen[4]).toEqual(['ChatGPT.md', 'Claude.md', 'Context.txt', 'Gemini.md', 'Recommendations.md', 'Stats.json']);
    const result = analyticsAnalysis('Video/Longform', '2026-11-18')[0];
    expect(result).toMatchObject({ claude: 'claude review 2\n', codex: 'codex review 2\n', gemini: 'gemini review 2\n', recommendations: 'claude review 5\n', summary: 'claude review 6\n' });
    expect(() => startAnalyticsSummary('Video/Longform', '2026-11-18', job.id, ask)).toThrow('already has a summary');
    expect(fs.readFileSync(path.join(root, 'Video/Longform/Analytics/2026-11-18/Stats.json'), 'utf8')).toContain('periods');
  });
  it('keeps successful reviews and does not synthesize when one AI fails', async () => {
    const calls: string[] = [];
    const { job, finished } = startAnalyticsAnalysis('', '2026-11-18', async ai => { calls.push(ai); if (ai === 'gemini') throw new Error('Unavailable'); return ai; });
    await finished;
    expect(calls).toHaveLength(3); expect(job.state).toBe('failed'); expect(job.models.gemini.error).toBe('Unavailable');
    expect(analyticsAnalysis('', '2026-11-18')[0]).toMatchObject({ claude: 'claude\n', codex: 'codex\n', gemini: null, recommendations: null });
    const { finished: summary } = startAnalyticsSummary('', '2026-11-18', job.id, async () => 'A short summary');
    await summary;
    expect(analyticsAnalysis('', '2026-11-18')[0].summary).toBe('A short summary\n');
  });
  it('rejects paths outside the snapshots', () => {
    expect(() => startAnalyticsAnalysis('../outside', '2026-11-18')).toThrow();
    expect(() => startAnalyticsAnalysis('', '../2026-11-18')).toThrow();
  });
  it('gives each reviewer manually supplied CTR with its period, and rejects malformed values', async () => {
    const contexts: string[] = [];
    const ask: AskAi = async (_ai, _prompt, cwd) => { contexts.push(fs.readFileSync(path.join(cwd, 'Context.txt'), 'utf8')); return 'review'; };
    const { finished } = startAnalyticsAnalysis('Video/Longform', '2026-11-18', ask, { ctr: 3.2, impressions: 500, period: 'Lifetime' });
    await finished;
    expect(contexts).toHaveLength(5);
    expect(contexts.every(value => value.includes('3.2%') && value.includes('Lifetime') && value.includes('Manually supplied'))).toBe(true);
    expect(() => startAnalyticsAnalysis('Video/Longform', '2026-11-18', ask, { ctr: 120, impressions: null, period: 'Lifetime' })).toThrow();
  });
});
