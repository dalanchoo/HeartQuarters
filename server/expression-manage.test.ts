import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { applyExpressionChange, previewExpressionChange } from './expression-manage';
import { readExpressionReferences, saveExpressionReferences } from './expression-references';
import { resolveExpressionPhoto } from './expression-photo-path';
import { makeTree, removeTree } from './testing';

let tmp: string;
let old: { expressions: string; projects: string; trash: string; refs?: string };
const a = 'Communication/Listening/Listening_002.jpg';
const b = 'Communication/Listening/Listening_005.webp';
const choice = 'Video/Longform/Packaging/Drafts/Choice.json';
beforeEach(() => {
  tmp = makeTree({
    'Expressions/Communication/Listening/Listening_002.jpg': 'bad photo',
    'Expressions/Communication/Listening/Listening_002.txt': 'bad tags',
    'Expressions/Communication/Listening/Listening_002_GPT.txt': 'bad extra',
    'Expressions/Communication/Listening/Listening_005.webp': 'good photo',
    'Expressions/Communication/Listening/Listening_005.txt': 'good tags',
    'Expressions/Communication/Listening/Listening_005_GPT.txt': 'good extra',
    'Expressions/Positive/Joy/Joy_001.png': 'joy',
    [`Projects/${choice}`]: JSON.stringify({ photo: a, pick: {}, index: 0 }),
    'Projects/Video/Longform/Packaging/Drafts/ChatGPT 01/Conversation.json': JSON.stringify({ ai: 'codex', photo: b }),
  });
  old = { expressions: config.expressionsDir, projects: config.videoProjectsDir, trash: config.trashDir, refs: process.env.HQ_EXPRESSION_REFS_FILE };
  config.expressionsDir = path.join(tmp, 'Expressions'); config.videoProjectsDir = path.join(tmp, 'Projects'); config.trashDir = path.join(tmp, 'Trash');
  process.env.HQ_EXPRESSION_REFS_FILE = path.join(tmp, 'refs.json');
  saveExpressionReferences([a, b], true);
});
afterEach(() => { config.expressionsDir = old.expressions; config.videoProjectsDir = old.projects; config.trashDir = old.trash; if (old.refs === undefined) delete process.env.HQ_EXPRESSION_REFS_FILE; else process.env.HQ_EXPRESSION_REFS_FILE = old.refs; removeTree(tmp); });

describe('managing expression photos', () => {
  it('archives a deleted photo and its sidecars, fills the hole and preserves known references', () => {
    const plan = previewExpressionChange(a, null);
    expect(plan.changes).toEqual([{ from: a, to: null }, { from: b, to: 'Communication/Listening/Listening_002.webp' }]);
    expect(plan.links).toHaveLength(2);
    applyExpressionChange(a, null, plan.token);
    const folder = path.join(tmp, 'Expressions/Communication/Listening');
    expect(fs.readFileSync(path.join(folder, 'Listening_002.webp'), 'utf8')).toBe('good photo');
    expect(fs.readFileSync(path.join(folder, 'Listening_002_GPT.txt'), 'utf8')).toBe('good extra');
    expect(fs.existsSync(path.join(folder, 'Listening_005.webp'))).toBe(false);
    const picked = JSON.parse(fs.readFileSync(path.join(tmp, 'Projects', choice), 'utf8')).photo;
    expect(picked).toMatch(/^project:/);
    expect(fs.readFileSync(resolveExpressionPhoto(picked), 'utf8')).toBe('bad photo');
    const conversation = JSON.parse(fs.readFileSync(path.join(tmp, 'Projects/Video/Longform/Packaging/Drafts/ChatGPT 01/Conversation.json'), 'utf8'));
    expect(conversation.photo).toBe('Communication/Listening/Listening_002.webp');
    expect(readExpressionReferences().paths).toEqual(['Communication/Listening/Listening_002.webp']);
    const trash = fs.readdirSync(path.join(tmp, 'Trash'))[0];
    expect(fs.readFileSync(path.join(tmp, 'Trash', trash, 'Listening_002_GPT.txt'), 'utf8')).toBe('bad extra');
  });
  it('moves a photo with sidecars and updates references', () => {
    const plan = previewExpressionChange(a, 'Positive/Joy');
    applyExpressionChange(a, 'Positive/Joy', plan.token);
    expect(fs.readFileSync(path.join(tmp, 'Expressions/Positive/Joy/Joy_002_GPT.txt'), 'utf8')).toBe('bad extra');
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'Projects', choice), 'utf8')).photo).toBe('Positive/Joy/Joy_002.jpg');
    expect(readExpressionReferences().paths).toEqual(['Positive/Joy/Joy_002.jpg', 'Communication/Listening/Listening_002.webp']);
  });
  it('rolls back photo moves and sidecars if the confirmation update cannot be applied', () => {
    const plan = previewExpressionChange(a, 'Positive/Joy');
    expect(() => applyExpressionChange(a, 'Positive/Joy', plan.token, { before: 'stale sidecar', after: 'new tags' })).toThrow(/sidecar changed/i);
    expect(fs.readFileSync(path.join(tmp, 'Expressions', a), 'utf8')).toBe('bad photo');
    expect(fs.readFileSync(path.join(tmp, 'Expressions/Communication/Listening/Listening_002.txt'), 'utf8')).toBe('bad tags');
    expect(fs.readFileSync(path.join(tmp, 'Expressions', b), 'utf8')).toBe('good photo');
    expect(fs.existsSync(path.join(tmp, 'Expressions/Positive/Joy/Joy_002.jpg'))).toBe(false);
    expect(readExpressionReferences().paths).toEqual([a, b]);
  });
  it('uses the AI naming sequence when moving a photo marked as generated', () => {
    fs.writeFileSync(path.join(tmp, 'Expressions/Communication/Listening/Listening_002.txt'), 'AIGenerated, N/A, CONFIRMED\n');
    const plan = previewExpressionChange(a, 'Positive/Joy');
    expect(plan.changes[0].to).toBe('Positive/Joy/Joy_AI_001.jpg');
    applyExpressionChange(a, 'Positive/Joy', plan.token);
    expect(fs.existsSync(path.join(tmp, 'Expressions/Positive/Joy/Joy_AI_001_GPT.txt'))).toBe(true);
  });
  it('refuses stale previews and unsafe paths without changes', () => {
    const plan = previewExpressionChange(a, null);
    fs.writeFileSync(path.join(tmp, 'Expressions', a), 'changed photo');
    expect(() => applyExpressionChange(a, null, plan.token)).toThrow(/changed since/);
    expect(() => previewExpressionChange('../outside.jpg', null)).toThrow();
    expect(fs.existsSync(path.join(tmp, 'Expressions', b))).toBe(true);
  });
});
