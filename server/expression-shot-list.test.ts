import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { addExpressionShots, deleteShot, INITIAL_SHOTS, parseShotSuggestion, readShotList, seedShotList, setShotDone, shotHasSuggestion, SHOT_LIST_FILE } from './expression-shot-list';
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
    const seeded = seedShotList(); expect(seeded.map(s => s.sources[0].text)).toEqual(INITIAL_SHOTS);
    expect(seeded[0]).toMatchObject({ category: 'Positive/Relief', alsoFits: ['Composure/Resolute', 'Positive/Warmth'] });
    const before = fs.readFileSync(path.join(config.expressionsDir, SHOT_LIST_FILE), 'utf8');
    expect(() => seedShotList()).toThrow();
    expect(fs.readFileSync(path.join(config.expressionsDir, SHOT_LIST_FILE), 'utf8')).toBe(before);
  });
  it('adds checked suggestions, deduplicates them, retains sources and can mark shots done', () => {
    seedShotList();
    const expression = 'Composure > Calm (open eyes, gentle smile)';
    const result = addExpressionShots('Video/Longform', [{ expression, context: 'Top 1' }, { expression: ` ${expression.toUpperCase()} `, context: 'Idea 2' }]);
    expect(result).toHaveLength(4); expect(result[3].sources.map(s => s.context)).toEqual(['Top 1', 'Idea 2']);
    expect(result[3]).toMatchObject({ category: 'Composure/Calm', description: 'Open eyes, gentle smile.' });
    expect(setShotDone(result[3].id, true)[3].done).toBe(true);
    // Suggested again by a video: a look already photographed stays done.
    expect(addExpressionShots('Video/Longform', [{ expression, context: 'Top 1' }])[3].done).toBe(true);
    expect(setShotDone(result[3].id, false)[3].done).toBe(false);
    expect(readShotList()).toHaveLength(4);
  });
  it('splits a suggestion into its main folder, other folders and a plain description', () => {
    expect(parseShotSuggestion('Positive > Relief, Composure > Calm (a tired, soft smile: as he is now)')).toEqual({ category: 'Positive/Relief', alsoFits: ['Composure/Calm'], description: 'A tired, soft smile: as he is now.' });
    expect(parseShotSuggestion('Positive > Contentment or Composure > Acceptance. Calm and at peace with it, not sad.')).toEqual({ category: 'Positive/Contentment', alsoFits: ['Composure/Acceptance'], description: 'Calm and at peace with it, not sad.' });
    expect(parseShotSuggestion('Cognitive > Curiosity, Doubt > Skepticism')).toMatchObject({ category: 'Cognitive/Curiosity', alsoFits: ['Doubt/Skepticism'] });
    expect(parseShotSuggestion('A warm look')).toEqual({ category: '', alsoFits: [], description: 'A warm look.' });
  });
  it('reads an old one-line list as unsorted looks and saves it in the new format on the next change', () => {
    const file = path.join(config.expressionsDir, SHOT_LIST_FILE);
    fs.writeFileSync(file, JSON.stringify({ version: 1, shots: [{ id: 'a', expression: 'Composure > Calm (steady)', sources: [], addedAt: 'x', done: false }] }));
    const [shot] = readShotList();
    expect(shot).toMatchObject({ id: 'a', category: 'Composure/Calm', description: 'Steady.' });
    expect(shotHasSuggestion(shot, ' composure > calm (STEADY) ')).toBe(true);
    setShotDone('a', true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ version: 2, shots: [{ id: 'a', done: true }] });
  });
  it('deletes only the chosen shot and refuses an unknown one', () => {
    const [first, second, third] = seedShotList();
    expect(deleteShot(second.id).map(s => s.id)).toEqual([first.id, third.id]);
    expect(readShotList()).toHaveLength(2);
    expect(() => deleteShot(second.id)).toThrow(/no longer on the list/);
    expect(() => deleteShot(42)).toThrow(/valid shot/);
  });
  it('never overwrites an unreadable list or accepts a path outside projects', () => {
    const file = path.join(config.expressionsDir, SHOT_LIST_FILE); fs.writeFileSync(file, 'not json');
    expect(() => addExpressionShots('Video/Longform', [{ expression: 'Calm', context: '' }])).toThrow(/Nothing was changed/);
    expect(fs.readFileSync(file, 'utf8')).toBe('not json');
    expect(() => addExpressionShots('../../elsewhere', [{ expression: 'Calm', context: '' }])).toThrow(/outside/);
  });
});
