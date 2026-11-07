// Making new video folders from the templates, plus the CapCut draft.
// Uses fake folders only, never the real Drive.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { checkFolderName, createCapCutDraft, createVideoFolder, draftsForVideo, suggestPrefix } from './create';
import { makeTree, removeTree } from './testing';

const YEAR = new Date().getFullYear();
const META = '{"draft_fold_path":"X:/old/--- SHORTS TEMPLATE","draft_id":"OLD-ID","draft_materials":[],' +
  '"draft_name":"--- SHORTS TEMPLATE","draft_root_path":"X:/old","tm_draft_create":1,"tm_draft_modified":2}';

let tmp: string;
let saved: { videos: string; drafts: string };
const projects = () => path.join(tmp, 'Video Projects');
const drafts = () => path.join(tmp, 'Drafts');
const exists = (...p: string[]) => fs.existsSync(path.join(projects(), ...p));

beforeEach(() => {
  tmp = makeTree({
    'Video Projects/--- LONGFORM TEMPLATE/Packaging/V01/YouTube.md': 'Title:\n',
    'Video Projects/--- LONGFORM TEMPLATE/XXX - Topic - Script.docx': 'docx',
    'Video Projects/--- SHORTS TEMPLATE/Packaging/V01/TikTok.md': '',
    'Video Projects/--- STANDALONE SHORTS TEMPLATE/Raw/': '',
    'Video Projects/021 - Mountain Acid Trip/Longform/Exports/': '',
    'Video Projects/022 - Worth Telling Them/Longform/Exports/': '',
    'Video Projects/022 - Worth Telling Them/Shorts/022_S01 - One/Exports/': '',
    'Video Projects/022 - Worth Telling Them/Shorts/022_S03 - Three/Exports/': '',
    'Video Projects/015 - NVC/015A - Making It Worse/Longform/Exports/': '',
    [`Video Projects/999 - Shorts/${YEAR}/999-${YEAR}-22 - Emotional Dumping/Exports/`]: '',
    'Drafts/--- SHORTS TEMPLATE/draft_meta_info.json': META,
    'Drafts/--- SHORTS TEMPLATE/draft_content.json': '{"id":"x"}',
    'Drafts/022 - Worth Telling Them(2)/draft_meta_info.json': META.replaceAll('--- SHORTS TEMPLATE', '022 - Worth Telling Them(2)'),
    'Drafts/022 - Worth Telling Them(2)/Resources/audio.aac': 'the long-form audio',
    'Drafts/022 - Other Cut/draft_meta_info.json': META,
    'Drafts/022_S01 - One/draft_meta_info.json': META,
    'Drafts/Not A Draft/readme.txt': '',
  });
  saved = { videos: config.videoProjectsDir, drafts: config.capcutDraftsDir };
  config.videoProjectsDir = projects();
  config.capcutDraftsDir = drafts();
});

afterEach(() => {
  config.videoProjectsDir = saved.videos;
  config.capcutDraftsDir = saved.drafts;
  removeTree(tmp);
});

describe('suggestPrefix', () => {
  it('suggests the next number for each kind of folder', async () => {
    expect(suggestPrefix('top')).toBe('023 - '); // 999 doesn't count
    expect(suggestPrefix('part', '015 - NVC')).toBe('015B - ');
    expect(suggestPrefix('short', '022 - Worth Telling Them')).toBe('022_S04 - ');
    expect(suggestPrefix('short', '021 - Mountain Acid Trip')).toBe('021_S01 - ');
    expect(suggestPrefix('short', '015 - NVC/015A - Making It Worse')).toBe('015A_S01 - ');
    expect(suggestPrefix('standalone')).toBe(`999-${YEAR}-23 - `);
    expect(suggestPrefix('standalone', '', YEAR + 1)).toBe(`999-${YEAR + 1}-01 - `);
  });

  it('refuses parents of the wrong kind', async () => {
    expect(() => suggestPrefix('part', '022 - Worth Telling Them')).toThrow(/series/);
    expect(() => suggestPrefix('short', '015 - NVC')).toThrow(/shorts/);
    expect(() => suggestPrefix('short', '../outside')).toThrow();
  });
});

describe('checkFolderName', () => {
  it('accepts normal names and trims spaces', async () => {
    expect(checkFolderName('  023 - What I Learned  ')).toBe('023 - What I Learned');
    expect(checkFolderName("010C - You're Overreacting")).toBe("010C - You're Overreacting");
  });

  it('refuses anything that is not a single safe folder name', async () => {
    for (const bad of ['', '   ', '../x', 'a/b', 'a\\b', 'C:x', 'what?', 'end.', 'CON', 'nul.txt', '..']) {
      expect(() => checkFolderName(bad), bad).toThrow();
    }
  });
});

describe('createVideoFolder', () => {
  it('makes a new top-level video with the longform template inside', async () => {
    const r = await createVideoFolder('top', '', '023 - New One');
    expect(r.showId).toBe('023 - New One');
    expect(exists('023 - New One', 'Longform', 'Packaging', 'V01', 'YouTube.md')).toBe(true);
    // The script gets the video's name.
    expect(exists('023 - New One', 'Longform', '023 - New One - Script.docx')).toBe(true);
    // The template itself is untouched.
    expect(exists('--- LONGFORM TEMPLATE', 'XXX - Topic - Script.docx')).toBe(true);
  });

  it('makes a new part inside a series', async () => {
    const r = await createVideoFolder('part', '015 - NVC', '015B - Listening');
    expect(r.showId).toBe('015 - NVC/015B - Listening');
    expect(exists('015 - NVC', '015B - Listening', 'Longform', 'Packaging')).toBe(true);
  });

  it("makes a short in the video's Shorts folder, creating it if needed", async () => {
    const r = await createVideoFolder('short', '021 - Mountain Acid Trip', '021_S01 - Cut In Half');
    expect(r.showId).toBe('021 - Mountain Acid Trip');
    expect(exists('021 - Mountain Acid Trip', 'Shorts', '021_S01 - Cut In Half', 'Packaging', 'V01', 'TikTok.md')).toBe(true);
  });

  it("makes a standalone short in this year's folder", async () => {
    const r = await createVideoFolder('standalone', '', `999-${YEAR}-23 - New`);
    expect(r.showId).toBe(`999 - Shorts/${YEAR}/999-${YEAR}-23 - New`);
    expect(exists('999 - Shorts', String(YEAR), `999-${YEAR}-23 - New`, 'Raw')).toBe(true);
  });

  it('never overwrites an existing folder', async () => {
    const marker = path.join(projects(), '022 - Worth Telling Them', 'Longform', 'Exports', 'keep.mp4');
    fs.writeFileSync(marker, 'mine');
    await expect(createVideoFolder('top', '', '022 - Worth Telling Them')).rejects.toThrow(/already exists/);
    await expect(createVideoFolder('short', '022 - Worth Telling Them', '022_S01 - One')).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(marker, 'utf8')).toBe('mine');
    expect(exists('022 - Worth Telling Them', 'Longform', 'Packaging')).toBe(false);
  });

  it('refuses names that would land somewhere else', async () => {
    await expect(createVideoFolder('top', '', '../Escaped')).rejects.toThrow();
    await expect(createVideoFolder('part', '../..', '015B - X')).rejects.toThrow();
    expect(fs.existsSync(path.join(tmp, 'Escaped'))).toBe(false);
  });

  it("doesn't make anything if the template is missing", async () => {
    fs.rmSync(path.join(projects(), '--- LONGFORM TEMPLATE'), { recursive: true });
    await expect(createVideoFolder('top', '', '023 - X')).rejects.toThrow(/template/);
    expect(exists('023 - X')).toBe(false);
  });
});

describe('createCapCutDraft', () => {
  it('copies the template draft and gives it its own name, path and id', async () => {
    const r = await createCapCutDraft('022_S04 - New', 'short');
    expect(r.created).toBe(true);
    const dir = path.join(drafts(), '022_S04 - New');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'draft_meta_info.json'), 'utf8'));
    expect(meta.draft_name).toBe('022_S04 - New');
    expect(meta.draft_fold_path).toBe(dir.split(path.sep).join('/'));
    expect(meta.draft_root_path).toBe(drafts().split(path.sep).join('/'));
    expect(meta.draft_id).not.toBe('OLD-ID');
    expect(meta.tm_draft_modified).toBeGreaterThan(2);
    expect(fs.existsSync(path.join(dir, 'draft_content.json'))).toBe(true);
    // The template draft is untouched.
    expect(fs.readFileSync(path.join(drafts(), '--- SHORTS TEMPLATE', 'draft_meta_info.json'), 'utf8')).toBe(META);
  });

  it('leaves an existing draft alone', async () => {
    fs.mkdirSync(path.join(drafts(), 'Taken'));
    fs.writeFileSync(path.join(drafts(), 'Taken', 'draft_meta_info.json'), 'mine');
    const r = await createCapCutDraft('Taken', 'short');
    expect(r.created).toBe(false);
    expect(fs.readFileSync(path.join(drafts(), 'Taken', 'draft_meta_info.json'), 'utf8')).toBe('mine');
  });

  it('explains what to do when there is no template draft yet', async () => {
    const r = await createCapCutDraft('023 - New', 'longform');
    expect(r.created).toBe(false);
    expect(r.message).toMatch(/--- LONGFORM TEMPLATE/);
    expect(fs.existsSync(path.join(drafts(), '023 - New'))).toBe(false);
  });

  it('is part of making a new video folder', async () => {
    const r = await createVideoFolder('standalone', '', `999-${YEAR}-23 - New`);
    expect(r.capcut.created).toBe(true);
    expect(fs.existsSync(path.join(drafts(), `999-${YEAR}-23 - New`, 'draft_meta_info.json'))).toBe(true);
  });
});

describe('copying an existing CapCut draft (shorts cut from a long-form)', () => {
  it("finds the video's own draft first, ignoring CapCut's (1), (2)...", () => {
    const all = ['022_S01 - One', '022 - Other Cut', '022 - Worth Telling Them(2)', 'Not A Draft', '023 - X'];
    expect(draftsForVideo('022 - Worth Telling Them', all)).toEqual(['022 - Worth Telling Them(2)', '022 - Other Cut']);
    expect(draftsForVideo('015 - NVC/015A - Making It Worse', ['015A - Making It Worse(3)', '015 - NVC'])).toEqual([
      '015A - Making It Worse(3)',
    ]);
  });

  it('duplicates the chosen draft, with everything in it, under the new name', async () => {
    const r = await createVideoFolder('short', '022 - Worth Telling Them', '022_S04 - Cut', '022 - Worth Telling Them(2)');
    expect(r.capcut.created).toBe(true);
    const dir = path.join(drafts(), '022_S04 - Cut');
    expect(fs.readFileSync(path.join(dir, 'Resources', 'audio.aac'), 'utf8')).toBe('the long-form audio');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'draft_meta_info.json'), 'utf8'));
    expect(meta.draft_name).toBe('022_S04 - Cut');
    // The long-form's draft is untouched.
    const original = JSON.parse(fs.readFileSync(path.join(drafts(), '022 - Worth Telling Them(2)', 'draft_meta_info.json'), 'utf8'));
    expect(original.draft_name).toBe('022 - Worth Telling Them(2)');
  });

  it('refuses a draft that does not exist or a path instead of a name, before making anything', async () => {
    await expect(createVideoFolder('short', '022 - Worth Telling Them', '022_S04 - X', 'Not A Draft')).rejects.toThrow(/no CapCut draft/);
    await expect(createVideoFolder('short', '022 - Worth Telling Them', '022_S04 - X', '../Drafts')).rejects.toThrow();
    expect(exists('022 - Worth Telling Them', 'Shorts', '022_S04 - X')).toBe(false);
  });
});
