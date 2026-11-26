import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { listWriting, readWriting, saveSubstackLink, SUBSTACK_LINK_FILE } from './writing';
import { makeTree, removeTree } from './testing';

let tmp: string;
let oldDir: string;

beforeAll(() => {
  tmp = makeTree({
    'Writing/My Journey/2026-02 – Story/Drafts/v1.docx': 'doc',
    'Writing/My Journey/2026-02 – Story/Drafts/~$v1.docx': 'lock',
    'Writing/My Journey/2026-02 – Story/Drafts/good.gdoc': JSON.stringify({ doc_id: 'Abc_123-xyz' }),
    'Writing/My Journey/2026-02 – Story/Drafts/bad.gdoc': JSON.stringify({ doc_id: 'bad/../../evil' }),
    'Writing/My Journey/2026-02 – Story/Substack Metadata/Preview.png': 'preview',
    'Writing/My Journey/2026-02 – Story/Substack Metadata 2.png': 'not-preview',
    'Writing/My Journey/2026-02 – Story/photo.jpg': 'photo',
    'Writing/My Reflections/Other/Drafts/a.docx': 'doc',
  });
  oldDir = config.writingDir;
  config.writingDir = path.join(tmp, 'Writing');
});

afterAll(() => {
  config.writingDir = oldDir;
  removeTree(tmp);
});

describe('Substack writing reader', () => {
  it('lists pieces by section and classifies metadata previews and valid Google Doc IDs', () => {
    const sections = listWriting();
    expect(sections[0].pieces.map((p) => p.id)).toEqual(['My Journey/2026-02 – Story']);
    const detail = readWriting('My Journey/2026-02 – Story');
    expect(detail.previews.map((p) => p.name)).toEqual(['Substack Metadata/Preview.png']);
    expect(detail.images.map((p) => p.name)).toEqual(['photo.jpg', 'Substack Metadata 2.png']);
    expect(detail.googleDocs).toEqual([{ name: 'good', url: 'https://docs.google.com/document/d/Abc_123-xyz/edit' }]);
  });

  it('rejects backslash traversals, dot paths, and unknown sections', () => {
    expect(() => readWriting('My Journey/..\\My Reflections\\Other')).toThrow(/Not a writing folder/);
    expect(() => readWriting('My Journey/.')).toThrow(/Not a writing folder/);
    expect(() => readWriting('My Journey/..')).toThrow(/Not a writing folder/);
    expect(() => readWriting('Other/Piece')).toThrow(/Not a writing folder/);
  });

  it('saves and updates Substack Link.txt in the piece folder', () => {
    const id = 'My Journey/2026-02 – Story';
    expect(readWriting(id).substackUrl).toBeNull();

    const first = 'https://heartmindfusion.substack.com/p/first-story';
    expect(saveSubstackLink(id, `  ${first}  `)).toEqual({ substackUrl: first });
    const linkPath = path.join(config.writingDir, 'My Journey', '2026-02 – Story', SUBSTACK_LINK_FILE);
    expect(fs.readFileSync(linkPath, 'utf8')).toBe(`${first}\n`);
    expect(readWriting(id).substackUrl).toBe(first);

    const updated = 'https://heartmindfusion.substack.com/p/updated-story';
    expect(saveSubstackLink(id, updated)).toEqual({ substackUrl: updated });
    expect(readWriting(id).substackUrl).toBe(updated);
  });

  it('rejects empty, invalid, or unsafe Substack links and unknown folders', () => {
    const id = 'My Journey/2026-02 – Story';
    expect(() => saveSubstackLink(id, '   ')).toThrow(/Enter a Substack link/);
    expect(() => saveSubstackLink(id, 'not a url')).toThrow(/valid Substack link/);
    expect(() => saveSubstackLink(id, 'javascript:alert(1)')).toThrow(/valid Substack link/);
    expect(() => saveSubstackLink('Other/Piece', 'https://heartmindfusion.substack.com/p/test')).toThrow(/Not a writing folder/);
  });

  it('refuses to write Substack Link.txt through a junction', () => {
    const elsewhere = path.join(tmp, 'Elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    const linked = path.join(config.writingDir, 'My Reflections', 'Other', SUBSTACK_LINK_FILE);
    fs.symlinkSync(elsewhere, linked, 'junction');
    expect(() => saveSubstackLink('My Reflections/Other', 'https://heartmindfusion.substack.com/p/test')).toThrow(/shortcut or junction/);
  });
});
