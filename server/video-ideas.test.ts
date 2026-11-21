import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { addIdea, addReference, deleteIdea, deleteReference, IDEAS_FILE, moveIdea, moveReference, readIdeas, updateIdea, updateReference } from './video-ideas';

let root: string;
let saved: string;
const file = () => path.join(config.videoProjectsDir, IDEAS_FILE);
beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '' });
  saved = config.videoProjectsDir; config.videoProjectsDir = path.join(root, 'Projects');
});
afterEach(() => { config.videoProjectsDir = saved; removeTree(root); });

describe('video ideas', () => {
  it('starts empty and creates the file on the first idea, newest at the top', () => {
    expect(readIdeas()).toEqual([]);
    expect(fs.existsSync(file())).toBe(false);
    addIdea('  SDAM and grief  ');
    const ideas = addIdea('Psychedelics and memory', 'Ask the group');
    expect(ideas.map(i => i.title)).toEqual(['Psychedelics and memory', 'SDAM and grief']);
    expect(ideas[0]).toMatchObject({ notes: 'Ask the group', status: 'thinking' });
    expect(readIdeas()).toEqual(ideas);
  });

  it('edits title, notes and status, and refuses bad values', () => {
    const [idea] = addIdea('Old title');
    const [changed] = updateIdea(idea.id, { title: 'New title', notes: 'More', status: 'researching' });
    expect(changed).toMatchObject({ title: 'New title', notes: 'More', status: 'researching' });
    expect(updateIdea(idea.id, { notes: 'Only notes' })[0]).toMatchObject({ title: 'New title', status: 'researching' });
    expect(() => updateIdea(idea.id, { status: 'famous' })).toThrow('valid status');
    expect(() => updateIdea(idea.id, { title: '   ' })).toThrow('title');
    expect(() => updateIdea('missing', { notes: 'x' })).toThrow('no longer');
    expect(() => addIdea('')).toThrow('title');
  });

  it('sets an idea as longform or short, and treats older ideas without a format as longform', () => {
    const [idea] = addIdea('Format test');
    expect(idea.format).toBe('longform');
    expect(updateIdea(idea.id, { format: 'short' })[0].format).toBe('short');
    expect(() => updateIdea(idea.id, { format: 'reel' })).toThrow('longform or short');
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, format: undefined }] }));
    expect(readIdeas()[0].format).toBe('longform');
  });

  it('marks ideas processed or unprocessed; older ideas are unprocessed', () => {
    const [idea] = addIdea('Raw dump');
    expect(idea.processed).toBe(false);
    expect(updateIdea(idea.id, { processed: true })[0].processed).toBe(true);
    expect(() => updateIdea(idea.id, { processed: 'yes' })).toThrow('processed or unprocessed');
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, processed: undefined }] }));
    expect(readIdeas()[0].processed).toBe(false);
  });

  it('adds, edits, reorders and deletes references on one idea', () => {
    const [idea] = addIdea('With links');
    addReference(idea.id, { label: 'Study', url: 'https://example.com/a', note: 'First' });
    const ideas = addReference(idea.id, { label: 'Video', url: 'http://example.com/b', note: '' });
    const [a, b] = ideas[0].references;
    expect(ideas[0].references.map(r => r.label)).toEqual(['Study', 'Video']);
    expect(updateReference(idea.id, a.id, { note: 'Changed' })[0].references[0]).toMatchObject({ note: 'Changed', url: 'https://example.com/a' });
    expect(moveReference(idea.id, b.id, -1)[0].references.map(r => r.label)).toEqual(['Video', 'Study']);
    expect(moveReference(idea.id, b.id, -1)[0].references.map(r => r.label)).toEqual(['Video', 'Study']);
    expect(deleteReference(idea.id, b.id)[0].references.map(r => r.label)).toEqual(['Study']);
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, references: undefined }] }));
    expect(readIdeas()[0].references).toEqual([]);
  });

  it('only accepts web links for references', () => {
    const [idea] = addIdea('Links');
    expect(() => addReference(idea.id, { label: 'x', url: 'file:///C:/secret.txt' })).toThrow('https://');
    expect(() => addReference(idea.id, { label: 'x', url: 'javascript:alert(1)' })).toThrow('https://');
    expect(() => addReference(idea.id, { label: 'x', url: 'not a link' })).toThrow('https://');
    expect(readIdeas()[0].references).toEqual([]);
  });

  it('moves ideas up and down and deletes one', () => {
    addIdea('C'); addIdea('B'); const [a] = addIdea('A');
    expect(moveIdea(a.id, 1).map(i => i.title)).toEqual(['B', 'A', 'C']);
    expect(moveIdea(a.id, -1).map(i => i.title)).toEqual(['A', 'B', 'C']);
    expect(moveIdea(a.id, -1).map(i => i.title)).toEqual(['A', 'B', 'C']); // already at the top
    expect(() => moveIdea(a.id, 5)).toThrow();
    expect(deleteIdea(a.id).map(i => i.title)).toEqual(['B', 'C']);
  });

  it('never saves over a file that changed elsewhere or that it cannot read', () => {
    addIdea('Mine');
    fs.writeFileSync(file(), 'not json');
    expect(() => addIdea('Another')).toThrow('could not be read');
    expect(fs.readFileSync(file(), 'utf8')).toBe('not json');
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ id: 'x' }] }));
    expect(() => readIdeas()).toThrow('unexpected format');
  });

  it('refuses to write through a shortcut or junction', () => {
    const elsewhere = path.join(root, 'Elsewhere'); fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, file(), 'junction');
    expect(() => addIdea('Sneaky')).toThrow();
    expect(() => readIdeas()).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});
