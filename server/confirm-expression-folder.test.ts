import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { confirmExpressionFolder } from './confirm-expression-folder';
import { readExpressionReferences, saveExpressionReferences } from './expression-references';
import { makeTree, removeTree } from './testing';

let tmp: string; let old: { expressions: string; projects: string; trash: string; refs?: string };
const photo = 'Attitude/Disapproval/Disapproval_001.jpg';
beforeEach(() => {
  tmp = makeTree({
    'Expressions/Attitude/Disapproval/Disapproval_001.jpg': 'photo',
    'Expressions/Attitude/Disapproval/Disapproval_001.txt': 'Disapproval, 80%, CONFIRMED\r\nSkepticism, 90%, UNCONFIRMED, codex=90%\r\nSmile, 76%, CONFIRMED\r\n',
    'Expressions/Attitude/Disapproval/Disapproval_001_extra.txt': 'extra',
    'Expressions/Attitude/Disapproval/Disapproval_004.png': 'other',
    'Expressions/Attitude/Disapproval/Disapproval_004.txt': 'other tags',
    'Expressions/Attitude/Skepticism/Skepticism_001.jpg': 'existing',
    'Projects/V/Longform/Packaging/Drafts/Choice.json': JSON.stringify({ photo }),
  });
  old = { expressions: config.expressionsDir, projects: config.videoProjectsDir, trash: config.trashDir, refs: process.env.HQ_EXPRESSION_REFS_FILE };
  config.expressionsDir = path.join(tmp, 'Expressions'); config.videoProjectsDir = path.join(tmp, 'Projects'); config.trashDir = path.join(tmp, 'Trash'); process.env.HQ_EXPRESSION_REFS_FILE = path.join(tmp, 'refs.json');
  saveExpressionReferences([photo, 'Attitude/Disapproval/Disapproval_004.png'], true);
});
afterEach(() => { config.expressionsDir = old.expressions; config.videoProjectsDir = old.projects; config.trashDir = old.trash; if (old.refs === undefined) delete process.env.HQ_EXPRESSION_REFS_FILE; else process.env.HQ_EXPRESSION_REFS_FILE = old.refs; removeTree(tmp); });
describe('confirming an expression folder', () => {
  it('moves the photo and all sidecars, fills the gap, updates references and keeps just the chosen expression confirmed', () => {
    const result = confirmExpressionFolder(photo, 'Skepticism', 90);
    expect(result.path).toBe('Attitude/Skepticism/Skepticism_002.jpg');
    const dir = path.join(tmp, 'Expressions/Attitude');
    expect(fs.readFileSync(path.join(dir, 'Skepticism/Skepticism_002.txt'), 'utf8')).toBe('Disapproval, 80%, UNCONFIRMED\r\nSkepticism, 90%, CONFIRMED, codex=90%\r\nSmile, 76%, CONFIRMED\r\n');
    expect(fs.readFileSync(path.join(dir, 'Skepticism/Skepticism_002_extra.txt'), 'utf8')).toBe('extra');
    expect(fs.readFileSync(path.join(dir, 'Disapproval/Disapproval_001.png'), 'utf8')).toBe('other');
    expect(readExpressionReferences().paths).toEqual([result.path, 'Attitude/Disapproval/Disapproval_001.png']);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'Projects/V/Longform/Packaging/Drafts/Choice.json'), 'utf8')).photo).toBe(result.path);
  });
  it('confirms the existing folder without moving and clears other expression confirmations', () => {
    const file = path.join(tmp, 'Expressions/Attitude/Disapproval/Disapproval_001.txt');
    fs.writeFileSync(file, 'Disapproval, 80%, UNCONFIRMED\nSkepticism, 90%, CONFIRMED\n');
    expect(confirmExpressionFolder(photo, 'Disapproval', 80).path).toBe(photo);
    expect(fs.readFileSync(file, 'utf8')).toBe('Disapproval, 80%, CONFIRMED\nSkepticism, 90%, UNCONFIRMED\n');
  });
  it('does not change files when the suggestion is stale or the folder name is ambiguous', () => {
    const file = path.join(tmp, 'Expressions/Attitude/Disapproval/Disapproval_001.txt'); const before = fs.readFileSync(file, 'utf8');
    expect(() => confirmExpressionFolder(photo, 'Skepticism', 88)).toThrow(/changed/);
    fs.mkdirSync(path.join(tmp, 'Expressions/Other/Skepticism'), { recursive: true });
    expect(() => confirmExpressionFolder(photo, 'Skepticism', 90)).toThrow(/one destination/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});
