import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { makeTree, removeTree } from './testing.js';
import { LIKENESS_FILE, STARRED_FILE, migrateReferenceFiles, readExpressionReferences, readLikenessReferences, saveLikenessReferences } from './expression-references.js';

let root: string; let previous: string; let old: string | undefined;
beforeEach(() => {
  root = makeTree({ 'Expressions/': '', 'data/expression-references.json': JSON.stringify(['Neutral/a.jpg']), 'data/likeness-references.json': JSON.stringify(['Neutral/b.jpg']) });
  previous = config.expressionsDir; config.expressionsDir = path.join(root, 'Expressions');
  old = process.env.HQ_LEGACY_DATA_DIR; process.env.HQ_LEGACY_DATA_DIR = path.join(root, 'data');
  delete process.env.HQ_EXPRESSION_REFS_FILE;
});
afterEach(() => { config.expressionsDir = previous; if (old === undefined) delete process.env.HQ_LEGACY_DATA_DIR; else process.env.HQ_LEGACY_DATA_DIR = old; removeTree(root); });

it('copies both lists from the data folder into the Expressions library, once, without removing the old files', () => {
  expect(migrateReferenceFiles()).toBe(2);
  expect(JSON.parse(fs.readFileSync(path.join(config.expressionsDir, STARRED_FILE), 'utf8'))).toEqual(['Neutral/a.jpg']);
  expect(JSON.parse(fs.readFileSync(path.join(config.expressionsDir, LIKENESS_FILE), 'utf8'))).toEqual(['Neutral/b.jpg']);
  expect(migrateReferenceFiles()).toBe(0);
  expect(fs.existsSync(path.join(root, 'data', 'expression-references.json'))).toBe(true);
});

it('never replaces a list that is already in Drive', () => {
  fs.writeFileSync(path.join(config.expressionsDir, STARRED_FILE), JSON.stringify(['Doubt/keep.jpg']));
  migrateReferenceFiles();
  expect(readExpressionReferences().paths).toEqual(['Doubt/keep.jpg']);
});

it('reads and saves in Drive, so deleting the data folder loses nothing', () => {
  saveLikenessReferences(['Neutral/c.jpg']);
  fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
  expect(readLikenessReferences()).toEqual(['Neutral/c.jpg']);
  expect(readExpressionReferences()).toEqual({ initialized: true, paths: ['Neutral/a.jpg'] });
});
