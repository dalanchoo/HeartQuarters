import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { listWriting, readWriting } from './writing';
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
});
