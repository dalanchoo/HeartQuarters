import { describe, expect, it } from 'vitest';
import { reachTotals, summarizeSnapshot } from './analytics-summary';

const header = (name: string) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' });
const statsColumns = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage', 'likes', 'comments', 'shares', 'subscribersGained', 'subscribersLost'].map(header);

describe('reach totals', () => {
  it('adds impressions and weights CTR by impressions', () => {
    const totals = reachTotals({ days: [
      { start: '2026-11-02T08:00:00Z', end: '2026-11-03T08:00:00Z', rows: [{ video_id: 'abc', video_thumbnail_impressions: '1000', video_thumbnail_impressions_ctr: '0.05' }] },
      { start: '2026-11-01T07:00:00Z', end: '2026-11-02T08:00:00Z', rows: [{ video_id: 'abc', video_thumbnail_impressions: '10', video_thumbnail_impressions_ctr: '0.5' }, { video_id: 'other', video_thumbnail_impressions: '999', video_thumbnail_impressions_ctr: '0.9' }] },
    ] }, 'abc')!;
    expect(totals.impressions).toBe(1010);
    expect(totals.ctrPercent).toBeCloseTo(((1000 * 0.05 + 10 * 0.5) / 1010) * 100);
    expect(totals.from).toBe('2026-11-01T07:00:00Z');
    expect(totals.to).toBe('2026-11-03T08:00:00Z');
    expect(totals.days).toBe(2);
  });
  it('has nothing to add while YouTube is still preparing the reports', () => {
    expect(reachTotals({ status: 'pending', days: [] })).toBeNull();
    expect(reachTotals(undefined)).toBeNull();
  });
  it('gives no CTR when there were no impressions', () => {
    expect(reachTotals({ days: [{ start: 'a', end: 'b', rows: [{ video_thumbnail_impressions: '0', video_thumbnail_impressions_ctr: '0' }] }] })!.ctrPercent).toBeNull();
  });
});

describe('snapshot summary', () => {
  it('reads each period, retention and the breakdowns by column name', () => {
    const summary = summarizeSnapshot({
      videoId: 'abc',
      periods: [{ period: { name: 'First Week', start: '2026-11-01', end: '2026-11-07', complete: true },
        statistics: { columns: statsColumns, rows: [[120, 90, 45, 62.5, 7, 2, 1, 5, 1]] },
        retention: { columns: [header('elapsedVideoTimeRatio'), header('audienceWatchRatio')], rows: [[0.5, 0.4], [0.01, 1.1]] } }],
      breakdowns: [
        { name: 'Traffic Sources', report: { columns: [header('insightTrafficSourceType'), header('views'), header('estimatedMinutesWatched')], rows: [['YT_SEARCH', 30, 5], ['SHORTS', 90, 40], ['NEW_THING', 0, 0]] } },
        { name: 'Countries', report: { columns: [header('country'), header('views')], rows: [] } },
      ],
      reach: { status: 'pending', note: 'Preparing.', days: [] },
    });
    expect(summary.periods[0]).toMatchObject({ views: 120, watchHours: 1.5, averageViewSeconds: 45, averageViewPercent: 62.5, likes: 7, comments: 2, shares: 1, subscribersNet: 4 });
    expect(summary.periods[0].retention).toEqual([{ at: 0.01, watching: 1.1 }, { at: 0.5, watching: 0.4 }]);
    expect(summary.trafficSources).toEqual([{ label: 'Shorts Feed', views: 90, share: 0.75 }, { label: 'YouTube Search', views: 30, share: 0.25 }]);
    expect(summary.countries).toEqual([]);
    expect(summary.reach).toBeNull();
    expect(summary.reachStatus).toBe('pending');
  });
  it('copes with a period YouTube returned no rows for', () => {
    const summary = summarizeSnapshot({ periods: [{ period: { name: 'First 2 Days', start: 'a', end: 'b', complete: true }, statistics: { columns: statsColumns, rows: [] }, retention: null }] });
    expect(summary.periods[0]).toMatchObject({ views: null, watchHours: null, subscribersNet: null, retention: [] });
  });
});
