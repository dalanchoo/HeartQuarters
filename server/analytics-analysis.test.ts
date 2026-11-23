import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsAnalysis, analyticsSnapshots, prepareVideoSnapshot, startAnalyticsAnalysis, startAnalyticsSummary, videoSnapshotNames } from './analytics-analysis.js';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import type { AskAi } from './brief.js';
import { readChannelVideos } from './channel-videos.js';
import { downloadLinkedVideoAnalytics } from './analytics.js';

vi.mock('./channel-videos.js', () => ({ readChannelVideos: vi.fn(() => null) }));
vi.mock('./analytics.js', () => ({ downloadLinkedVideoAnalytics: vi.fn() }));
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

  it('gives channel synthesis and summary the shortlisted video’s retention, transcript and packaging', async () => {
    const piece = '022 - Worth Telling Them/Longform';
    const videoId = 'abcdefghijk';
    const stats = path.join(root, 'Analytics/2026-11-18/Stats.json');
    fs.writeFileSync(stats, JSON.stringify({ downloadedAt: '2026-11-18', channel: { id: 'own' }, reports: [] }));
    const catalog = {
      channel: { id: 'own', title: 'Heart Mind Fusion' }, updatedAt: '2026-11-23', videos: [{
        id: videoId, title: 'Published title', publishedAt: '2026-10-01', seconds: 400, privacy: 'public',
        piece, kind: 'longform' as const, kindGuessed: false, topic: 'sdam' as const, topic2: 'unassigned' as const,
        angle: 'story' as const, angle2: 'unassigned' as const, note: '', numbers: null,
      }],
    };
    vi.mocked(readChannelVideos).mockReturnValueOnce(catalog);
    for (const [relative, content] of [
      ['Analytics/2026-11-18/Stats.json', JSON.stringify({ videoId, downloadedAt: new Date().toISOString(), periods: [{ retention: { rows: [[0.1, 0.4]] } }] })],
      ['Subtitles/subs.srt', 'Timed opening line'],
      ['Packaging/V01/YouTube.md', 'Local title'],
    ]) {
      const file = path.join(root, piece, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    let reads = 0;
    const { job, finished } = startAnalyticsAnalysis('', '2026-11-18', async (_ai, prompt, cwd) => {
      if (!prompt.includes('its listed files')) return `Repackage the video.\nEvidence IDs: ${videoId}, lmnopqrstuv`;
      expect(JSON.parse(fs.readFileSync(path.join(cwd, 'Evidence.json'), 'utf8'))).toMatchObject([{ id: videoId, publishedTitle: 'Published title' }]);
      expect(fs.readFileSync(path.join(cwd, `Evidence-${videoId}-Stats.json`), 'utf8')).toContain('[[0.1,0.4]]');
      expect(fs.readFileSync(path.join(cwd, `Evidence-${videoId}-Transcript.srt`), 'utf8')).toBe('Timed opening line');
      expect(fs.readFileSync(path.join(cwd, `Evidence-${videoId}-Packaging-YouTube.md`), 'utf8')).toBe('Local title');
      reads++;
      return 'Repackage the video.';
    });
    await finished;
    expect(job.state).toBe('done');
    expect(reads).toBe(2);
    expect(analyticsAnalysis('', '2026-11-18')[0]).toMatchObject({ evidenceIds: [videoId], claude: 'Repackage the video.\n' });
  });

  it('reuses recent stats for the selected YouTube ID and combines concurrent downloads for another ID', async () => {
    const piece = 'Video/Longform';
    const file = path.join(root, piece, 'Analytics/2026-11-18/Stats.json');
    fs.writeFileSync(file, JSON.stringify({ videoId: 'abcdefghijk', downloadedAt: new Date().toISOString(), periods: [] }));
    const download = vi.mocked(downloadLinkedVideoAnalytics);
    download.mockClear();
    download.mockResolvedValueOnce({ file: `${piece}/Analytics/2026-11-23/Stats.json`, missingRetention: [], emptyStatistics: [], unavailableBreakdowns: [], reach: { status: 'unavailable', note: 'No reach reports.' } });
    await expect(prepareVideoSnapshot(piece, 'abcdefghijk')).resolves.toBe('2026-11-18');
    expect(videoSnapshotNames(piece, 'lmnopqrstuv')).toEqual([]);
    await expect(Promise.all([prepareVideoSnapshot(piece, 'lmnopqrstuv'), prepareVideoSnapshot(piece, 'lmnopqrstuv')])).resolves.toEqual(['2026-11-23', '2026-11-23']);
    expect(download).toHaveBeenCalledTimes(1);
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
    expect(analyticsAnalysis('', '2026-11-18')[0]).toMatchObject({ claude: 'claude\n', codex: 'codex\n', gemini: null, recommendations: null, failure: 'Independent review (Gemini) failed.\n' });
    expect(fs.readFileSync(path.join(root, 'Analytics/2026-11-18/Analysis', job.id, 'Failure.txt'), 'utf8'))
      .toBe('Independent review (Gemini) failed.\n');
    const { finished: summary } = startAnalyticsSummary('', '2026-11-18', job.id, async () => 'A short summary');
    await summary;
    expect(analyticsAnalysis('', '2026-11-18')[0].summary).toBe('A short summary\n');
  });

  it('finishes a channel analysis without a screen polling it', async () => {
    let finishReviews!: (text: string) => void;
    const response = new Promise<string>(resolve => { finishReviews = resolve; });
    const { job, finished } = startAnalyticsAnalysis('', '2026-11-18', async () => response);
    expect(analyticsAnalysis('', '2026-11-18')[0].job?.state).toBe('working');

    finishReviews('Saved result');
    await finished;

    expect(analyticsAnalysis('', '2026-11-18')[0]).toMatchObject({
      id: job.id, job: { state: 'done' }, recommendations: 'Saved result\n', summary: 'Saved result\n', failure: null,
    });
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
