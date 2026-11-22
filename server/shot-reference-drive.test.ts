import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import { SHOT_REFERENCES_FOLDER, migrateShotReferences, shotReferences } from './shot-reference.js';

const ID = '11111111-2222-3333-4444-555555555555';
let root: string; let previous: string; let old: string | undefined; let oldRefs: string | undefined;
const job = { shotId: ID, state: 'ready', prompt: 'p', createdAt: '2026-11-01T00:00:00Z' };
beforeEach(() => {
  root = makeTree({
    'Expressions/': '',
    [`data/shot-references/${ID}/job.json`]: JSON.stringify(job),
    [`data/shot-references/${ID}/reference-001.png`]: 'picture-one',
    [`data/shot-references/${ID}/reference.png`]: 'older-picture',
    [`data/shot-references/${ID}/work-abc/candidate.png`]: 'scratch',
  });
  previous = config.expressionsDir; config.expressionsDir = path.join(root, 'Expressions');
  old = process.env.HQ_LEGACY_DATA_DIR; process.env.HQ_LEGACY_DATA_DIR = path.join(root, 'data');
  oldRefs = process.env.HQ_SHOT_REFERENCES; delete process.env.HQ_SHOT_REFERENCES;
});
afterEach(() => {
  config.expressionsDir = previous;
  if (old === undefined) delete process.env.HQ_LEGACY_DATA_DIR; else process.env.HQ_LEGACY_DATA_DIR = old;
  if (oldRefs !== undefined) process.env.HQ_SHOT_REFERENCES = oldRefs;
  removeTree(root);
});
const inDrive = (name: string) => path.join(config.expressionsDir, SHOT_REFERENCES_FOLDER, ID, name);

it('copies the job file and pictures into the Expressions library, but not scratch folders, and keeps the old files', () => {
  expect(migrateShotReferences()).toBe(3);
  expect(fs.readFileSync(inDrive('reference-001.png'), 'utf8')).toBe('picture-one');
  expect(fs.existsSync(inDrive('work-abc'))).toBe(false);
  expect(fs.existsSync(path.join(root, 'data', 'shot-references', ID, 'reference-001.png'))).toBe(true);
  expect(migrateShotReferences()).toBe(0);
});

it('never replaces a picture already in Drive', () => {
  fs.mkdirSync(path.dirname(inDrive('x')), { recursive: true });
  fs.writeFileSync(inDrive('reference-001.png'), 'already-here');
  migrateShotReferences();
  expect(fs.readFileSync(inDrive('reference-001.png'), 'utf8')).toBe('already-here');
});

it('lists the shots from Drive, so deleting the data folder loses nothing', () => {
  const first = shotReferences();
  fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
  const after = shotReferences();
  expect(after[ID].pictures).toEqual(['reference-001.png', 'reference.png']);
  expect(after).toEqual(first);
});
