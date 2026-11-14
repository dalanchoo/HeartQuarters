// Reading the Video Projects folder: layouts, versions, names with en-dashes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { listProjects, readProject } from './projects';
import { makeTree, removeTree } from './testing';

let tmp: string;
let original: string;

beforeAll(() => {
  tmp = makeTree({
    '--- LONGFORM TEMPLATE/Packaging/V01/YouTube.md': '',
    'Claude + CapCut/notes.txt': '',
    '022 - Worth Telling Them/Longform/Exports/022.mp4': 'video',
    '022 - Worth Telling Them/Longform/Packaging/Legacy/Metadata/YouTube.md': 'old',
    '022 - Worth Telling Them/Longform/Packaging/V05_Shock/YouTube.md': 'v5',
    '022 - Worth Telling Them/Longform/Packaging/V05_Shock/Thumbnail.png': 'png',
    '022 - Worth Telling Them/Longform/Packaging/V10/YouTube.md': 'v10',
    '022 - Worth Telling Them/Longform/Packaging/V10/Covers/Thumbnail.png': 'png',
    '022 - Worth Telling Them/Longform/Packaging/V10/Covers/Source/Layer.png': 'psd layer',
    '022 - Worth Telling Them/Longform/Packaging/V02/YouTube.md': 'v2',
    '022 - Worth Telling Them/Longform/Packaging/Drafts/Brief.md': 'brief',
    '022 - Worth Telling Them/Longform/Packaging/Drafts/ChatGPT 02/10.png': 'png',
    '022 - Worth Telling Them/Longform/Packaging/Drafts/ChatGPT 02/02.png': 'png',
    '022 - Worth Telling Them/Longform/Packaging/Drafts/ChatGPT 02/Requests.md': 'asked',
    '022 - Worth Telling Them/Longform/Packaging/Drafts/Gemini 01/01.png': 'png',
    '022 - Worth Telling Them/Shorts/022_S01 - First/Exports/s1.mp4': 'video',
    '022 - Worth Telling Them/Shorts/022_S02 - Second/Packaging/V01/TikTok.md': 'tt',
    '023 – En Dash Name/Longform/Exports/023.mp4': 'video',
    "024 - It's Got An Apostrophe/Longform/": '',
    '005 - Series/005A - Part One/Longform/Exports/a.mp4': 'video',
    '005 - Series/005B – Part Two/Longform/Packaging/V01/YouTube.md': 'b',
    '006 - Old Layout/Packaging/V01/YouTube.md': 'old layout',
    '999 - Shorts/2026/999-2026-01 - First One/Exports/a.mp4': 'video',
    '999 - Shorts/2026/999-2026-01 - First One/Packaging/V01/YouTube.md': 'Title:\nx\n\nTags:\ny',
    "999 - Shorts/2026/999-2026-02 - Isn't Done/Raw/raw.mp4": 'raw',
    "999 - Shorts/2026/999-2026-02 - Isn't Done/Packaging/V01/TikTok.md": 'tt',
  });
  original = config.videoProjectsDir;
  config.videoProjectsDir = tmp;
});

afterAll(() => {
  config.videoProjectsDir = original;
  removeTree(tmp);
});

describe('listProjects', () => {
  it('lists numbered folders, skipping templates and other folders', () => {
    expect(listProjects().map((p) => p.id)).toEqual([
      '005 - Series',
      '006 - Old Layout',
      '022 - Worth Telling Them',
      '023 – En Dash Name',
      "024 - It's Got An Apostrophe",
      '999 - Shorts',
    ]);
  });

  it('shows series parts as children', () => {
    const series = listProjects().find((x) => x.number === '005')!;
    expect(series.kind).toBe('series');
    expect(series.children.map((c) => [c.number, c.title, c.kind])).toEqual([
      ['005A', 'Part One', 'part'],
      ['005B', 'Part Two', 'part'],
    ]);
    expect(series.children[0].exported).toBe(true);
    expect(series.children[1].exported).toBe(false);
  });

  it('shows grouped standalone shorts: 999 - Shorts > 2026 > shorts', () => {
    const group = listProjects().find((x) => x.number === '999')!;
    expect(group.kind).toBe('group');
    expect(group.shortCount).toBe(2);
    const year = group.children[0];
    expect([year.title, year.kind, year.number]).toEqual(['2026', 'group', null]);
    expect(year.children.map((c) => [c.number, c.title, c.kind, c.exported])).toEqual([
      ['999-2026-01', 'First One', 'short', true],
      ['999-2026-02', "Isn't Done", 'short', false],
    ]);
  });

  it('treats ordinary projects as projects', () => {
    expect(listProjects().find((x) => x.number === '022')).toMatchObject({ kind: 'project', children: [] });
  });

  it('reads names with an en-dash', () => {
    const p = listProjects().find((x) => x.number === '023');
    expect(p?.title).toBe('En Dash Name');
    expect(p?.longformExported).toBe(true);
  });

  it('counts shorts and exports', () => {
    const p = listProjects().find((x) => x.number === '022');
    expect(p?.shortCount).toBe(2);
    expect(p?.longformExported).toBe(true);
  });

  it('explains clearly when the folder is missing', () => {
    config.videoProjectsDir = tmp + '-missing';
    try {
      expect(() => listProjects()).toThrow(/Is Google Drive running/);
    } finally {
      config.videoProjectsDir = tmp;
    }
  });
});

describe('readProject', () => {
  it('lists packaging versions oldest first: Legacy, then by number', () => {
    const longform = readProject('022 - Worth Telling Them').videos[0].pieces[0];
    expect(longform.versions.map((v) => v.name)).toEqual(['Legacy', 'V02', 'V05_Shock', 'V10']);
    expect(longform.packagingVersion).toBe('V10');
  });

  it('finds files anywhere in a version, but skips Source folders', () => {
    const longform = readProject('022 - Worth Telling Them').videos[0].pieces[0];
    const v10 = longform.versions.find((v) => v.name === 'V10')!;
    expect(v10.covers.map((c) => c.name)).toEqual(['Covers/Thumbnail.png']);
    const legacy = longform.versions.find((v) => v.name === 'Legacy')!;
    expect(legacy.docs.map((d) => d.name)).toEqual(['Metadata/YouTube.md']);
  });

  it('reads the Drafts folder: the brief and each AI conversation, and never counts it as a version', () => {
    const longform = readProject('022 - Worth Telling Them').videos[0].pieces[0];
    expect(longform.versions.map((v) => v.name)).not.toContain('Drafts');
    const drafts = longform.drafts!;
    expect(drafts.path).toBe('022 - Worth Telling Them/Longform/Packaging/Drafts');
    expect(drafts.brief?.name).toBe('Brief.md');
    expect(drafts.conversations.map((c) => c.name)).toEqual(['ChatGPT 02', 'Gemini 01']);
    expect(drafts.conversations[0].images.map((i) => i.name)).toEqual(['02.png', '10.png']);
    expect(drafts.conversations[0].requests?.name).toBe('Requests.md');
    expect(drafts.conversations[1].requests).toBeNull();
  });

  it('has no drafts when there is no Drafts folder', () => {
    const p = readProject('005 - Series');
    expect(p.videos[1].pieces[0].drafts).toBeNull();
  });

  it('splits series projects into their parts (hyphen or en-dash)', () => {
    const p = readProject('005 - Series');
    expect(p.videos.map((v) => v.name)).toEqual(['005A - Part One', '005B – Part Two']);
  });

  it('understands the old layout with no Longform folder', () => {
    const piece = readProject('006 - Old Layout').videos[0].pieces[0];
    expect(piece.kind).toBe('longform');
    expect(piece.packagingVersion).toBe('V01');
  });

  it('copes with an empty project', () => {
    const p = readProject("024 - It's Got An Apostrophe");
    expect(p.videos[0].pieces[0].versions).toEqual([]);
    expect(p.longformExported).toBe(false);
  });

  it('opens one part of a series by its path', () => {
    const part = readProject('005 - Series/005B – Part Two');
    expect(part).toMatchObject({ kind: 'part', number: '005B', title: 'Part Two' });
    expect(part.videos[0].pieces[0].packagingVersion).toBe('V01');
  });

  it('opens a standalone short, treating its packaging as a short', () => {
    const short = readProject('999 - Shorts/2026/999-2026-01 - First One');
    expect(short.kind).toBe('short');
    const piece = short.videos[0].pieces[0];
    expect([piece.kind, piece.name, piece.exports.length]).toEqual(['short', '999-2026-01 - First One', 1]);
  });

  it('opens a group folder with its contents', () => {
    const year = readProject('999 - Shorts/2026');
    expect(year.kind).toBe('group');
    expect(year.children).toHaveLength(2);
  });

  it('refuses names that are not project folders', () => {
    expect(() => readProject('999 - Shorts/../006 - Old Layout')).toThrow();
    expect(() => readProject('Claude + CapCut')).toThrow();
    expect(() => readProject('999 - Shorts/2026/Nope')).toThrow(/not found/);
    expect(() => readProject('../secret')).toThrow();
    expect(() => readProject('022 - Worth Telling Them/../..')).toThrow();
  });
});
