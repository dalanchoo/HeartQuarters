// Renaming and deleting video folders with their CapCut drafts. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { checkManageable, deleteFolder, manageInfo, openInCapCut, renameFolder, system } from './manage';
import { makeTree, removeTree } from './testing';

let tmp: string;
let saved: { videos: string; drafts: string; trash: string };
let capcutOpen = false;
const realCheck = system.isCapCutRunning;

const projects = () => path.join(tmp, 'Video Projects');
const drafts = () => path.join(tmp, 'Drafts');
const p = (...s: string[]) => path.join(projects(), ...s);
const read = (f: string) => fs.readFileSync(f, 'utf8');
const vp = () => projects().split(path.sep).join('/');

/** A draft's meta file, using `media` (a file path) like CapCut does. */
const meta = (name: string, media: string) =>
  JSON.stringify({
    draft_fold_path: `X:/Drafts/${name}`,
    draft_materials: [{ value: [{ file_Path: media }] }],
    draft_name: name,
  });

beforeEach(() => {
  tmp = makeTree({
    'Video Projects/--- LONGFORM TEMPLATE/Raw/': '',
    'Video Projects/022 - Worth Telling Them/Longform/Raw/a.mp4': 'video',
    'Video Projects/022 - Worth Telling Them/Shorts/022_S01 - One/Exports/s.mp4': 'short',
    'Video Projects/015 - NVC/015A - Part One/Longform/Raw/': '',
    'Video Projects/015 - NVC/015A - Part One/Shorts/015A_S01 - Short/Raw/': '',
    'Video Projects/999 - Shorts/2026/999-2026-01 - Alone/Raw/': '',
    'Drafts/placeholder.txt': '',
  });
  const media = `${projects().split(path.sep).join('/')}/022 - Worth Telling Them/Longform/Raw/a.mp4`;
  const add = (name: string, m = media) => {
    fs.mkdirSync(path.join(drafts(), name, 'Timelines', 'T1'), { recursive: true });
    fs.writeFileSync(path.join(drafts(), name, 'draft_meta_info.json'), meta(name, m));
    fs.writeFileSync(path.join(drafts(), name, 'Timelines', 'T1', 'draft_content.json'), JSON.stringify({ path: m }));
  };
  add('022 - Worth Telling Them(2)');
  add('022_S01 - One'); // a short cut from the long-form: uses its files too
  add('015 - NVC', 'none');
  add('015A - Part One', 'none');
  add('015A_S01 - Short(1)', 'none');
  add('Unrelated', 'none');
  add('--- LONGFORM TEMPLATE', 'none');

  saved = { videos: config.videoProjectsDir, drafts: config.capcutDraftsDir, trash: config.trashDir };
  config.videoProjectsDir = projects();
  config.capcutDraftsDir = drafts();
  config.trashDir = path.join(tmp, 'Trash');
  capcutOpen = false;
  system.isCapCutRunning = () => capcutOpen;
});

afterEach(() => {
  config.videoProjectsDir = saved.videos;
  config.capcutDraftsDir = saved.drafts;
  config.trashDir = saved.trash;
  system.isCapCutRunning = realCheck;
  removeTree(tmp);
});

describe('Open in CapCut', () => {
  const realStart = system.startCapCut;
  const realExe = config.capcutExe;
  let started = 0;

  beforeEach(() => {
    started = 0;
    system.startCapCut = () => {
      started++;
    };
    config.capcutExe = path.join(tmp, 'CapCut.exe');
    fs.writeFileSync(config.capcutExe, '');
    fs.mkdirSync(path.join(drafts(), 'TEST-open'), { recursive: true });
    fs.writeFileSync(path.join(drafts(), 'TEST-open', 'draft_meta_info.json'), '{}');
  });

  afterEach(() => {
    system.startCapCut = realStart;
    config.capcutExe = realExe;
  });

  it('starts CapCut and gives back the name to copy', () => {
    expect(openInCapCut('TEST-open')).toBe('TEST-open');
    expect(started).toBe(1);
  });

  it("doesn't start it for a project that isn't there, or a name reaching outside the drafts", () => {
    expect(() => openInCapCut('No such project')).toThrow();
    expect(() => openInCapCut('../TEST-open')).toThrow();
    expect(() => openInCapCut('')).toThrow();
    expect(started).toBe(0);
  });

  it("says so if CapCut isn't where the settings say", () => {
    config.capcutExe = path.join(tmp, 'missing.exe');
    expect(() => openInCapCut('TEST-open')).toThrow(/capcutExe/);
    expect(started).toBe(0);
  });
});

describe('checkManageable', () => {
  it('allows video folders only', () => {
    for (const ok of [
      '022 - Worth Telling Them',
      '015 - NVC',
      '015 - NVC/015A - Part One',
      '022 - Worth Telling Them/Shorts/022_S01 - One',
      '015 - NVC/015A - Part One/Shorts/015A_S01 - Short',
      '999 - Shorts/2026/999-2026-01 - Alone',
    ]) {
      expect(() => checkManageable(ok), ok).not.toThrow();
    }
  });

  it('refuses templates, 999 - Shorts, year folders, insides of videos and escapes', () => {
    for (const bad of [
      '--- LONGFORM TEMPLATE',
      '999 - Shorts',
      '999 - Shorts/2026',
      '022 - Worth Telling Them/Longform',
      '022 - Worth Telling Them/Longform/Raw',
      '../Drafts',
      '022 - Worth Telling Them/../015 - NVC',
      '',
    ]) {
      expect(() => checkManageable(bad), bad).toThrow();
    }
  });
});

describe('manageInfo', () => {
  it("lists the folder's own drafts, and every draft of the videos inside it", () => {
    const info = manageInfo('015 - NVC');
    expect(info.ownDrafts).toEqual(['015 - NVC']);
    expect(info.allDrafts.sort()).toEqual(['015 - NVC', '015A - Part One', '015A_S01 - Short(1)']);
    expect(manageInfo('022 - Worth Telling Them').files).toBe(2);
  });
});

describe('renameFolder', () => {
  it('renames the folder and its draft, keeps "(2)", and fixes links in every draft that uses its files', () => {
    const r = renameFolder('022 - Worth Telling Them', '022 - Worth Saying', ['022 - Worth Telling Them(2)']);
    expect(r.showId).toBe('022 - Worth Saying');
    expect(fs.existsSync(p('022 - Worth Saying', 'Longform', 'Raw', 'a.mp4'))).toBe(true);
    expect(fs.existsSync(p('022 - Worth Telling Them'))).toBe(false);

    const renamed = path.join(drafts(), '022 - Worth Saying(2)');
    const m = JSON.parse(read(path.join(renamed, 'draft_meta_info.json')));
    expect(m.draft_name).toBe('022 - Worth Saying(2)');
    expect(m.draft_fold_path).toBe(renamed.split(path.sep).join('/'));
    const newMedia = `${vp()}/022 - Worth Saying/Longform/Raw/a.mp4`;
    expect(m.draft_materials[0].value[0].file_Path).toBe(newMedia);
    expect(JSON.parse(read(path.join(renamed, 'Timelines', 'T1', 'draft_content.json'))).path).toBe(newMedia);
    // The short's draft (not renamed) has its links fixed too.
    expect(JSON.parse(read(path.join(drafts(), '022_S01 - One', 'Timelines', 'T1', 'draft_content.json'))).path).toBe(newMedia);
  });

  it('keeps fixing links past a draft it cannot read, and names that draft', () => {
    // There, but unreadable: a folder where the file should be.
    fs.rmSync(path.join(drafts(), 'Unrelated', 'draft_meta_info.json'));
    fs.mkdirSync(path.join(drafts(), 'Unrelated', 'draft_meta_info.json'));
    const result = renameFolder('022 - Worth Telling Them', '022 - Renamed', []);
    const link = `${vp()}/022 - Renamed/Longform/Raw/a.mp4`;
    expect(read(path.join(drafts(), '022_S01 - One', 'Timelines', 'T1', 'draft_content.json'))).toContain(link);
    expect(read(path.join(drafts(), '022 - Worth Telling Them(2)', 'draft_meta_info.json'))).toContain(link);
    expect(result.message).toMatch(/Updated the links in 2 CapCut drafts/);
    expect(result.message).toMatch(/may still point at the old name: "Unrelated"/);
    expect(fs.readdirSync(path.join(drafts(), '022_S01 - One')).filter((n) => n.endsWith('.hq-tmp'))).toEqual([]);
  });

  it('leaves drafts alone if they are not ticked (but still fixes links)', () => {
    renameFolder('022 - Worth Telling Them', '022 - Worth Saying', []);
    expect(fs.existsSync(path.join(drafts(), '022 - Worth Telling Them(2)'))).toBe(true);
  });

  it('renames a short and goes back to its video', () => {
    const r = renameFolder('022 - Worth Telling Them/Shorts/022_S01 - One', '022_S01 - First', ['022_S01 - One']);
    expect(r.showId).toBe('022 - Worth Telling Them');
    expect(fs.existsSync(p('022 - Worth Telling Them', 'Shorts', '022_S01 - First', 'Exports', 's.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(drafts(), '022_S01 - First'))).toBe(true);
  });

  it('refuses while CapCut is open, changing nothing', () => {
    capcutOpen = true;
    expect(() => renameFolder('022 - Worth Telling Them', '022 - X', [])).toThrow(/close CapCut/i);
    expect(fs.existsSync(p('022 - Worth Telling Them'))).toBe(true);
  });

  it('refuses names that would hide the folder, clash, or point elsewhere', () => {
    expect(() => renameFolder('022 - Worth Telling Them', 'No Number', [])).toThrow(/number/);
    expect(() => renameFolder('015 - NVC/015A - Part One', 'Part One', [])).toThrow(/part/);
    expect(() => renameFolder('022 - Worth Telling Them', '015 - NVC', [])).toThrow(/already exists/);
    expect(() => renameFolder('022 - Worth Telling Them', '../022 - X', [])).toThrow();
    expect(() => renameFolder('022 - Worth Telling Them', '022 - X', ['Unrelated'])).toThrow(/isn't one/);
    expect(fs.existsSync(p('022 - Worth Telling Them'))).toBe(true);
    expect(fs.existsSync(path.join(drafts(), 'Unrelated'))).toBe(true);
  });
});

describe('deleteFolder', () => {
  it('moves the folder and the ticked drafts into the trash, not deleting anything', () => {
    const r = deleteFolder('015 - NVC', ['015 - NVC', '015A_S01 - Short(1)']);
    expect(r.showId).toBe('');
    expect(fs.existsSync(p('015 - NVC'))).toBe(false);
    const [slot] = fs.readdirSync(config.trashDir);
    expect(slot).toMatch(/ - 015 - NVC$/);
    const inTrash = path.join(config.trashDir, slot);
    expect(fs.existsSync(path.join(inTrash, '015 - NVC', '015A - Part One', 'Longform'))).toBe(true);
    expect(fs.existsSync(path.join(inTrash, 'CapCut Drafts', '015 - NVC', 'draft_meta_info.json'))).toBe(true);
    expect(fs.existsSync(path.join(inTrash, 'CapCut Drafts', '015A_S01 - Short(1)'))).toBe(true);
    // Not ticked: stays where it is.
    expect(fs.existsSync(path.join(drafts(), '015A - Part One'))).toBe(true);
  });

  it('goes back to the video after deleting a short or a part', () => {
    expect(deleteFolder('022 - Worth Telling Them/Shorts/022_S01 - One', []).showId).toBe('022 - Worth Telling Them');
    expect(deleteFolder('015 - NVC/015A - Part One', []).showId).toBe('015 - NVC');
  });

  it('only moves drafts that belong to the folder, and refuses non-video folders', () => {
    expect(() => deleteFolder('022 - Worth Telling Them', ['Unrelated'])).toThrow(/isn't one/);
    expect(() => deleteFolder('022 - Worth Telling Them', ['--- LONGFORM TEMPLATE'])).toThrow(/isn't one/);
    expect(() => deleteFolder('999 - Shorts', [])).toThrow();
    expect(() => deleteFolder('--- LONGFORM TEMPLATE', [])).toThrow();
    expect(fs.existsSync(p('022 - Worth Telling Them'))).toBe(true);
    expect(fs.existsSync(config.trashDir)).toBe(false);
  });

  it('needs CapCut closed only when drafts are moved', () => {
    capcutOpen = true;
    expect(() => deleteFolder('022 - Worth Telling Them', ['022 - Worth Telling Them(2)'])).toThrow(/close CapCut/i);
    expect(fs.existsSync(p('022 - Worth Telling Them'))).toBe(true);
    expect(() => deleteFolder('022 - Worth Telling Them', [])).not.toThrow();
  });
});
