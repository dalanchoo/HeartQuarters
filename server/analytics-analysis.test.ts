import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsAnalysis, analyticsSnapshots, startAnalyticsAnalysis, startAnalyticsSummary } from './analytics-analysis.js';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import type { AskAi } from './brief.js';
import { readChannelVideos } from './channel-videos.js';

vi.mock('./channel-videos.js', () => ({ readChannelVideos: vi.fn(() => null) }));
vi.mock('./video-links.js', () => ({
  videoLinks: () => new Map([
    ['abcdefghijk', { piece: '022 - Worth Telling Them/Longform' }],
    ['zyxwvutsrqp', { piece: '015 - NVC/015A - Making Conversations Worse/Shorts/015A_S05 - You Don\'t Know Why' }],
  ]),
}));

let root: string; let previous: string;
beforeEach(() => { root = makeTree({ 'Video/Longform/Analytics/2026-11-18/Stats.json': JSON.stringify({ downloadedAt: '2026-11-18', periods: [] }), 'Analytics/2026-11-18/Stats.json': JSON.stringify({ downloadedAt: '2026-11-18', reports: [] }) }); previous = config.videoProjectsDir; config.videoProjectsDir = root; });
afterEach(() => { config.videoProjectsDir = previous; removeTree(root); });

describe('analytics analysis', () => {
  it('uses the matching Channel catalog to ask every reviewer for ranked next steps', async () => {
    const stats = path.join(root, 'Analytics/2026-11-18/Stats.json');
    fs.writeFileSync(stats, JSON.stringify({ downloadedAt: '2026-11-18', channel: { id: 'own' }, reports: [] }));
    vi.mocked(readChannelVideos).mockReturnValueOnce({
      channel: { id: 'own', title: 'Heart Mind Fusion' }, updatedAt: '2026-11-23', trafficUpdatedAt: '2026-11-21',
      videos: [{
        id: 'abcdefghijk', title: 'Example SDAM Video', publishedAt: '2026-10-01', seconds: 400, privacy: 'public',
        piece: '022 - Worth Telling Them/Longform', kind: 'longform', kindGuessed: false, topic: 'sdam', topic2: 'unassigned',
        angle: 'story', angle2: 'unassigned', note: '', numbers: null, traffic: { searchViews: 314 },
      }],
    });
    const seen: { prompt: string; context: string }[] = [];
    const { job, finished } = startAnalyticsAnalysis('', '2026-11-18', async (_ai, prompt, cwd) => {
      seen.push({ prompt, context: fs.readFileSync(path.join(cwd, 'Context.txt'), 'utf8') });
      return 'Repackage `abcdefghijk`.';
    });
    await finished;
    expect(job.state).toBe('done');
    expect(seen).toHaveLength(5);
    for (const { prompt, context } of seen) {
      expect(prompt).toContain('Rank up to three concrete actions');
      expect(prompt).toContain('exact projectName');
      expect(prompt).toContain('thumbnail CTR with its impression count');
      expect(context).toContain('Example SDAM Video');
      expect(context).toContain('"searchViews":314');
      expect(context).toContain('2026-11-21');
      expect(context).toContain('"projectName":"022 - Worth Telling Them"');
      expect(context).not.toContain('/Longform');
    }
    for (const file of ['Claude.md', 'ChatGPT.md', 'Gemini.md', 'Recommendations.md', 'Summary.md']) {
      expect(fs.readFileSync(path.join(root, 'Analytics/2026-11-18/Analysis', job.id, file), 'utf8'))
        .toBe('Repackage 022 - Worth Telling Them.\n');
    }
  });

  it('resolves known IDs in saved reports while preserving watch links and the original file', async () => {
    const report = 'Repackage `abcdefghijk`. Compare abcdefghijk and unknownguid. [`zyxwvutsrqp`](https://youtu.be/zyxwvutsrqp).';
    const { job, finished } = startAnalyticsAnalysis('', '2026-11-18', async () => 'Earlier review');
    await finished;
    const file = path.join(root, 'Analytics/2026-11-18/Analysis', job.id, 'Summary.md');
    fs.writeFileSync(file, report);
    expect(analyticsAnalysis('', '2026-11-18')[0].summary)
      .toBe("Repackage 022 - Worth Telling Them. Compare 022 - Worth Telling Them and unknownguid. [015A\\_S05 - You Don't Know Why](https://youtu.be/zyxwvutsrqp).");
    expect(fs.readFileSync(file, 'utf8')).toBe(report);
  });

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
