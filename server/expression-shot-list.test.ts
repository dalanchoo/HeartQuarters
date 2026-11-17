import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { addExpressionShots, INITIAL_SHOTS, readShotList, seedShotList, setShotDone, SHOT_LIST_FILE } from './expression-shot-list';
import { makeTree, removeTree } from './testing';

let root: string;
let saved: { projects: string; expressions: string };
beforeEach(() => {
  root = makeTree({ 'Projects/Video/Longform/Packaging/': '', 'Expressions/': '' });
  saved = { projects: config.videoProjectsDir, expressions: config.expressionsDir };
  config.videoProjectsDir = path.join(root, 'Projects'); config.expressionsDir = path.join(root, 'Expressions');
});
afterEach(() => { config.videoProjectsDir = saved.projects; config.expressionsDir = saved.expressions; removeTree(root); });

describe('expression shot list', () => {
  it('seeds all three examples exactly once without replacing an existing file', () => {
    const seeded = seedShotList(); expect(seeded.map(s => s.expression)).toEqual(INITIAL_SHOTS);
    const before = fs.readFileSync(path.join(config.expressionsDir, SHOT_LIST_FILE), 'utf8');
    expect(() => seedShotList()).toThrow();
    expect(fs.readFileSync(path.join(config.expressionsDir, SHOT_LIST_FILE), 'utf8')).toBe(before);
  });
  it('adds checked suggestions, deduplicates them, retains sources and can mark shots done', () => {
    seedShotList();
    const expression = 'Composure > Calm (open eyes, gentle smile)';
    const result = addExpressionShots('Video/Longform', [{ expression, context: 'Top 1' }, { expression: ` ${expression.toUpperCase()} `, context: 'Idea 2' }]);
    expect(result).toHaveLength(4); expect(result[3].sources).toEqual([{ piece: 'Video/Longform', context: 'Top 1' }, { piece: 'Video/Longform', context: 'Idea 2' }]);
    expect(setShotDone(result[3].id, true)[3].done).toBe(true);
    expect(addExpressionShots('Video/Longform', [{ expression, context: 'Top 1' }])[3].done).toBe(false);
    expect(setShotDone(result[3].id, false)[3].done).toBe(false);
    expect(readShotList()).toHaveLength(4);
  });
  it('never overwrites an unreadable list or accepts a path outside projects', () => {
    const file = path.join(config.expressionsDir, SHOT_LIST_FILE); fs.writeFileSync(file, 'not json');
    expect(() => addExpressionShots('Video/Longform', [{ expression: 'Calm', context: '' }])).toThrow(/Nothing was changed/);
    expect(fs.readFileSync(file, 'utf8')).toBe('not json');
    expect(() => addExpressionShots('../../elsewhere', [{ expression: 'Calm', context: '' }])).toThrow(/outside/);
  });
});
