import { describe, expect, it } from 'vitest';
import { groupPlannedShorts } from './shortsGrouping';
import type { PlannedShort } from './api';

describe('grouping proposed shorts', () => {
  it('keeps unfinished, running, copying and failed shorts visible and groups completed ones', () => {
    const row = (id: string, made?: string): PlannedShort => ({ id, title: id, start: 0, end: 30, made });
    const rows = [row('S01', 'one'), row('S02'), row('S03', 'three'), row('S04', 'four'), row('S05', 'five')];
    const builds = { S03: { status: 'running' as const }, S04: { status: 'failed' as const } };
    const groups = groupPlannedShorts(rows, builds, 'S05');
    expect(groups.ready.map(row => row.id)).toEqual(['S02', 'S03', 'S04', 'S05']);
    expect(groups.made.map(row => row.id)).toEqual(['S01']);
    expect(rows.map(row => row.id)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05']);
  });
});
