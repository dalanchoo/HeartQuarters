import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { addAttachment, addIdea, addReference, attachmentFile, deleteAttachment, deleteIdea, deleteReference, extractHtmlTitle, IDEA_RESOURCES_DIR, IDEAS_FILE, ideaVideos, moveIdea, moveReference, readIdeas, updateAttachment, updateIdea, updateReference } from './video-ideas';

let root: string;
let saved: string;
let savedTrash: string;
const file = () => path.join(config.videoProjectsDir, IDEAS_FILE);
beforeEach(() => {
  root = makeTree({ 'Projects/001 - Video/': '' });
  saved = config.videoProjectsDir; config.videoProjectsDir = path.join(root, 'Projects');
  savedTrash = config.trashDir; config.trashDir = path.join(root, 'Trash');
});
afterEach(() => { config.videoProjectsDir = saved; config.trashDir = savedTrash; removeTree(root); });

describe('video ideas', () => {
  it('starts empty and creates the file on the first idea, newest at the top', () => {
    expect(readIdeas()).toEqual([]);
    expect(fs.existsSync(file())).toBe(false);
    addIdea('  SDAM and grief  ');
    const ideas = addIdea('Psychedelics and memory', 'Ask the group');
    expect(ideas.map(i => i.title)).toEqual(['Psychedelics and memory', 'SDAM and grief']);
    expect(ideas[0]).toMatchObject({ notes: 'Ask the group', status: 'raw' });
    expect(readIdeas()).toEqual(ideas);
  });

  it('edits title, notes and status, and refuses bad values', () => {
    const [idea] = addIdea('Old title');
    const [changed] = updateIdea(idea.id, { title: 'New title', notes: 'More', status: 'brainstorming' });
    expect(changed).toMatchObject({ title: 'New title', notes: 'More', status: 'brainstorming' });
    expect(updateIdea(idea.id, { notes: 'Only notes' })[0]).toMatchObject({ title: 'New title', status: 'brainstorming' });
    expect(() => updateIdea(idea.id, { status: 'famous' })).toThrow('valid status');
    expect(() => updateIdea(idea.id, { title: '   ' })).toThrow('title');
    expect(() => updateIdea('missing', { notes: 'x' })).toThrow('no longer');
    expect(() => addIdea('')).toThrow('title');
  });

  it('sets an idea as undecided, longform or short; older ideas without a format are undecided', () => {
    const [idea] = addIdea('Format test');
    expect(idea.format).toBe('undecided');
    expect(updateIdea(idea.id, { format: 'short' })[0].format).toBe('short');
    expect(updateIdea(idea.id, { format: 'undecided' })[0].format).toBe('undecided');
    expect(() => updateIdea(idea.id, { format: 'reel' })).toThrow('undecided, longform or short');
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, format: undefined }] }));
    expect(readIdeas()[0].format).toBe('undecided');
  });

  it('sets a category; new and older ideas are Unassigned', () => {
    const [idea] = addIdea('Topic');
    expect(idea.category).toBe('unassigned');
    expect(updateIdea(idea.id, { category: 'aphantasia' })[0].category).toBe('aphantasia');
    expect(() => updateIdea(idea.id, { category: 'cooking' })).toThrow('valid category');
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, category: undefined }] }));
    expect(readIdeas()[0].category).toBe('unassigned');
  });

  it('turns the old Thinking About It status and processed tick into Raw and Processed', () => {
    const [idea] = addIdea('Raw dump');
    expect(idea.status).toBe('raw');
    expect(updateIdea(idea.id, { status: 'processed' })[0].status).toBe('processed');
    const old = { ...idea, status: 'thinking' };
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [
      { ...old, id: 'a', processed: true },
      { ...old, id: 'b', processed: false },
      { ...old, id: 'c' },
      { ...old, id: 'd', status: 'brainstorming', processed: true },
    ] }));
    const read = readIdeas();
    expect(read.map((i) => i.status)).toEqual(['processed', 'raw', 'raw', 'brainstorming']);
    expect(read.every((i) => !('processed' in i))).toBe(true);
    expect(() => updateIdea('a', { status: 'thinking' })).toThrow('valid status');
  });

  it('puts ideas on and off the Up Next list; older ideas are not up next', () => {
    const [idea] = addIdea('Next one');
    expect(idea.upNext).toBe(false);
    expect(updateIdea(idea.id, { upNext: true })[0].upNext).toBe(true);
    expect(updateIdea(idea.id, { upNext: false })[0].upNext).toBe(false);
    expect(() => updateIdea(idea.id, { upNext: 'yes' })).toThrow('up next');
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, upNext: undefined }] }));
    expect(readIdeas()[0].upNext).toBe(false);
  });

  it('adds, edits, reorders and deletes references on one idea', () => {
    const [idea] = addIdea('With links');
    addReference(idea.id, { url: 'https://example.com/a', note: 'Study' });
    const ideas = addReference(idea.id, { url: 'http://example.com/b', note: 'Video' });
    const [a, b] = ideas[0].references;
    expect(ideas[0].references.map(r => r.note)).toEqual(['Study', 'Video']);
    expect(updateReference(idea.id, a.id, { note: 'Changed' })[0].references[0]).toEqual({ id: a.id, note: 'Changed', url: 'https://example.com/a' });
    expect(moveReference(idea.id, b.id, -1)[0].references.map(r => r.note)).toEqual(['Video', 'Changed']);
    expect(moveReference(idea.id, b.id, -1)[0].references.map(r => r.note)).toEqual(['Video', 'Changed']);
    expect(deleteReference(idea.id, b.id)[0].references.map(r => r.note)).toEqual(['Changed']);
    fs.writeFileSync(file(), JSON.stringify({ version: 1, ideas: [{ ...idea, references: undefined }] }));
    expect(readIdeas()[0].references).toEqual([]);
  });

  it('accepts web links and HeartQuarters video links, and rejects unsafe links', () => {
    const [idea] = addIdea('Links');
    expect(addReference(idea.id, { url: '#Videos/005%20-%20Ayahuasca', note: 'Day One' })[0].references[0].url)
      .toBe('#Videos/005%20-%20Ayahuasca');
    expect(() => addReference(idea.id, { url: '#Videos/' })).toThrow('valid video');
    expect(addReference(idea.id, { url: '#Substack/My%20Journey%2F2022-02%20%E2%80%93%20Kinbaku', note: '2022-02 – Kinbaku' })[0].references[1].url)
      .toBe('#Substack/My%20Journey%2F2022-02%20%E2%80%93%20Kinbaku');
    expect(() => addReference(idea.id, { url: '#Substack/' })).toThrow('valid Substack piece');
    expect(() => addReference(idea.id, { url: 'file:///C:/secret.txt' })).toThrow('https://');
    expect(() => addReference(idea.id, { url: 'javascript:alert(1)' })).toThrow('https://');
    expect(() => addReference(idea.id, { url: 'not a link' })).toThrow('https://');
    expect(readIdeas()[0].references).toHaveLength(2);
    expect(extractHtmlTitle('<html><head><title>The Journey&#39;s End &amp; Legacy</title></head></html>'))
      .toBe("The Journey's End & Legacy");
    expect(extractHtmlTitle('<meta property="og:title" content="From &ldquo;Substack&rdquo;">'))
      .toBe('From “Substack”');
  });

  it('moves ideas up and down and deletes one', () => {
    const [c] = addIdea('C'); addIdea('B'); const [a] = addIdea('A');
    expect(moveIdea(a.id, 1).map(i => i.title)).toEqual(['B', 'A', 'C']);
    expect(moveIdea(a.id, -1).map(i => i.title)).toEqual(['A', 'B', 'C']);
    expect(moveIdea(a.id, -1).map(i => i.title)).toEqual(['A', 'B', 'C']); // already at the top
    expect(moveIdea(a.id, 1, c.id).map(i => i.title)).toEqual(['C', 'B', 'A']); // swaps with visible neighbor
    expect(moveIdea(a.id, -1, c.id).map(i => i.title)).toEqual(['A', 'B', 'C']);
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

  it('attaches files (such as PDFs), deduplicates names, updates notes, and trashes on delete', () => {
    const [idea] = addIdea('SDAM Guide');
    const pdf = Buffer.from('%PDF-1.4\nhello');
    const first = addAttachment(idea.id, 'SDAM Guide.pdf', pdf, 'For people who just discovered SDAM');
    expect(first[0].attachments).toHaveLength(1);
    expect(first[0].attachments[0]).toMatchObject({ name: 'SDAM Guide.pdf', note: 'For people who just discovered SDAM', size: pdf.length });

    const second = addAttachment(idea.id, 'SDAM Guide.pdf', pdf, 'Updated version');
    expect(second[0].attachments.map(a => a.name)).toEqual(['SDAM Guide.pdf', 'SDAM Guide (2).pdf']);

    const attId = second[0].attachments[0].id;
    expect(fs.readFileSync(attachmentFile(idea.id, attId)).equals(pdf)).toBe(true);
    expect(updateAttachment(idea.id, attId, { note: 'Edited note' })[0].attachments[0].note).toBe('Edited note');

    const afterDelete = deleteAttachment(idea.id, attId);
    expect(afterDelete[0].attachments.map(a => a.name)).toEqual(['SDAM Guide (2).pdf']);
    expect(fs.existsSync(path.join(config.videoProjectsDir, IDEA_RESOURCES_DIR, idea.id, 'SDAM Guide.pdf'))).toBe(false);
    expect(fs.readdirSync(config.trashDir).some(d => d.startsWith('Idea Resources '))).toBe(true);
  });

  it('refuses unsafe attachment types and junctions', () => {
    const [idea] = addIdea('Unsafe attachments');
    expect(() => addAttachment(idea.id, 'shortcut.lnk', Buffer.from('x'))).toThrow('cannot be attached');
    expect(() => addAttachment(idea.id, 'empty.pdf', Buffer.alloc(0))).toThrow('empty');

    const elsewhere = path.join(root, 'Elsewhere'); fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(path.join(config.videoProjectsDir, IDEA_RESOURCES_DIR)), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(config.videoProjectsDir, IDEA_RESOURCES_DIR), 'junction');
    expect(() => addAttachment(idea.id, 'guide.pdf', Buffer.from('%PDF'))).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses to write through a shortcut or junction', () => {
    const elsewhere = path.join(root, 'Elsewhere'); fs.mkdirSync(elsewhere);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.symlinkSync(elsewhere, file(), 'junction');
    expect(() => addIdea('Sneaky')).toThrow();
    expect(() => readIdeas()).toThrow();
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('lists Drive video projects in ideaVideos even when no YouTube channel cache exists', () => {
    fs.mkdirSync(path.join(config.videoProjectsDir, '005 - Ayahuasca', '005B - Night One', 'Longform', 'Exports'), { recursive: true });
    fs.mkdirSync(path.join(config.videoProjectsDir, '005 - Ayahuasca', '005B - Night One', 'Shorts', '005B_S01 - Clip', 'Exports'), { recursive: true });
    process.env.HQ_CHANNEL_VIDEOS_FILE = path.join(root, 'missing-channel-videos.json');
    try {
      const list = ideaVideos();
      expect(list.map((v) => v.piece)).toEqual([
        '005 - Ayahuasca/005B - Night One/Longform',
        '005 - Ayahuasca/005B - Night One/Shorts/005B_S01 - Clip',
      ]);
      expect(list.map((v) => v.kind)).toEqual(['longform', 'short']);
    } finally {
      delete process.env.HQ_CHANNEL_VIDEOS_FILE;
    }
  });
});
