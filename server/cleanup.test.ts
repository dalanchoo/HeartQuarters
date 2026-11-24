// Clean Up: the rules for each kind of file, and a whole cleanup of a fake video with a fake CapCut project.
// Fake folders only; nothing is deleted, only moved to a fake Trash.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { classify, cleanupPlan, madeByHeartQuarters, pieceOf, runCleanup, SOURCE_MANIFEST } from './cleanup';
import { system } from './manage';
import { makeTree, removeTree } from './testing';

describe('the rules', () => {
  const remove = (rel: string, used = false) => classify(rel, used).action;
  it('always keeps Raw, Exports, versions, subtitles and anything not listed', () => {
    for (const rel of ['Longform/Raw/Take 1.mp4', 'Longform/Exports/old cut.mp4', 'Shorts/022_S01 - A/Exports/a.mp4', 'Longform/Packaging/V01/YouTube.md', 'Longform/Packaging/V01/Notes.md', 'Longform/Packaging/V02/Thumbnail/Thumbnail.png', 'Longform/Packaging/V01/Thumbnail/Source/thumb.psd', 'Longform/Subtitles/022-captions.srt', 'Longform/Subtitles/022-captions.words.json', 'Longform/B-Roll/clip.mp4', 'Longform/Audio/Music/a.wav', 'Longform/022 - Script.docx', 'Shorts/Longform URL.txt']) {
      expect([rel, remove(rel)]).toEqual([rel, 'keep']);
    }
  });
  it('removes what HeartQuarters and the AIs made, unless CapCut uses it', () => {
    for (const rel of ['Longform/AI/notes.md', 'Shorts/022_S01 - A/AI/capcut backups/x.json', 'Longform/Packaging/Drafts/Brief.md', 'Longform/Packaging/V01/Thumbnail/Backups/Replaced 1.png', 'Longform/Packaging/V01/Thumbnail/Source/Draft - ChatGPT 01 round 03.png', 'Longform/Packaging/V01/Thumbnail/Source/References - ChatGPT 01/03 - 1.png', 'Longform/Intermediate/Motion Graphics/unused.mov', 'Longform/Intermediate/Decisions.md', 'Shorts/Shorts Plan.json', 'Shorts/Retention Graph - before 2026-01-01 010101.png']) {
      expect([rel, remove(rel)]).toEqual([rel, 'remove']);
    }
    expect(remove('Longform/Intermediate/Motion Graphics/g01.mov', true)).toBe('keep');
  });
  it('moves a file CapCut uses out of AI into Intermediate', () => {
    expect(classify('Shorts/022_S01 - A/AI/broll/b.mp4', true)).toEqual({ action: 'move', to: 'Shorts/022_S01 - A/Intermediate/broll/b.mp4', why: 'used in CapCut, but kept in AI' });
  });
  it("knows HeartQuarters' own Source files by name or by its list, never John's", () => {
    expect(madeByHeartQuarters('Photo - Calm_004.jpg')).toBe(true);
    expect(madeByHeartQuarters('Requests.md')).toBe(true);
    expect(madeByHeartQuarters('Thumbnail.psd')).toBe(false);
    expect(classify('Longform/Packaging/V01/Thumbnail/Source/cut out.png', false, new Set(['cut out.png'])).action).toBe('remove');
  });
});

describe('which piece is cleaned', () => {
  it('is a longform or one Short, also in a series part', () => {
    expect(pieceOf('022 - V/Longform')).toEqual({ video: '022 - V', inVideo: 'Longform' });
    expect(pieceOf('022 - V/Shorts/022_S01 - A')).toEqual({ video: '022 - V', inVideo: 'Shorts/022_S01 - A' });
    expect(pieceOf('005 - Series/005A - Part/Longform')).toEqual({ video: '005 - Series/005A - Part', inVideo: 'Longform' });
    expect(pieceOf('022 - V/Shorts')).toEqual({ video: '022 - V', inVideo: 'Shorts' }); // Make Shorts' own files
    for (const bad of ['022 - V', 'Shorts', '022 - V/Longform/AI', '../x/Longform', '', '022 - V//Longform']) expect(() => pieceOf(bad)).toThrow(/longform, a Short or Make Shorts/);
  });
});

describe('cleaning up a video', () => {
  let tmp: string;
  let saved: { videos: string; drafts: string; trash: string };
  let capcutOpen = false;
  const realCheck = system.isCapCutRunning;
  const V = (...s: string[]) => path.join(tmp, 'Video Projects', '022 - V', ...s);
  const fwd = (p: string) => p.split(path.sep).join('/');

  beforeEach(() => {
    tmp = makeTree({
      'Video Projects/022 - V/Longform/Raw/take.mp4': 'raw',
      'Video Projects/022 - V/Longform/Exports/final.mp4': 'export',
      'Video Projects/022 - V/Longform/Intermediate/Motion Graphics/used.mov': 'used render',
      'Video Projects/022 - V/Longform/Intermediate/Motion Graphics/unused.mov': 'old render',
      'Video Projects/022 - V/Longform/Intermediate/Motion Graphics/Source/index.html': 'source',
      'Video Projects/022 - V/Longform/AI/notes.md': 'notes',
      'Video Projects/022 - V/Longform/AI/broll/graded.mp4': 'used from AI',
      'Video Projects/022 - V/Longform/Packaging/V01/YouTube.md': 'Title:\nT\n',
      'Video Projects/022 - V/Longform/Packaging/V01/Thumbnail/Thumbnail.png': 'thumb',
      'Video Projects/022 - V/Longform/Packaging/V01/Thumbnail/Source/mine.psd': 'psd',
      'Video Projects/022 - V/Longform/Packaging/V01/Thumbnail/Source/Photo - Calm_004.jpg': 'photo copy',
      'Video Projects/022 - V/Longform/Packaging/Drafts/Brief.md': 'brief',
      'Video Projects/022 - V/Shorts/Shorts Plan.json': '{}',
      'Video Projects/022 - V/Shorts/022_S01 - A/AI/frame.jpg': 'frame',
      'Video Projects/022 - V/Shorts/022_S01 - A/Exports/a.mp4': 'short export',
    });
    const used = [V('Longform', 'Intermediate', 'Motion Graphics', 'used.mov'), V('Longform', 'AI', 'broll', 'graded.mp4'), V('Longform', 'Raw', 'take.mp4')].map(fwd);
    const draft = path.join(tmp, 'Drafts', '022 - V');
    fs.mkdirSync(path.join(draft, 'Timelines', 'T1'), { recursive: true });
    fs.writeFileSync(path.join(draft, 'draft_meta_info.json'), JSON.stringify({ draft_materials: [{ value: used.map((p) => ({ file_Path: p })) }] }));
    fs.writeFileSync(path.join(draft, 'Timelines', 'T1', 'draft_content.json'), JSON.stringify({ materials: { videos: used.map((p) => ({ path: p })) } }));
    saved = { videos: config.videoProjectsDir, drafts: config.capcutDraftsDir, trash: config.trashDir };
    config.videoProjectsDir = path.join(tmp, 'Video Projects');
    config.capcutDraftsDir = path.join(tmp, 'Drafts');
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

  it('lists what would go and what would move for the longform, changing nothing', () => {
    fs.writeFileSync(V('Shorts', 'Retention Graph.png'), 'graph');
    const plan = cleanupPlan('022 - V/Longform');
    expect(plan.piece).toBe('022 - V/Longform');
    expect(plan.remove.map((i) => i.path.replace('022 - V/', '')).sort()).toEqual([
      'Longform/AI/notes.md',
      'Longform/Intermediate/Motion Graphics/Source/index.html',
      'Longform/Intermediate/Motion Graphics/unused.mov',
      'Longform/Packaging/Drafts/Brief.md',
      'Longform/Packaging/V01/Thumbnail/Source/Photo - Calm_004.jpg',
    ]);
    expect(plan.move).toEqual([{ path: '022 - V/Longform/AI/broll/graded.mp4', to: '022 - V/Longform/Intermediate/broll/graded.mp4', size: 12, why: 'used in CapCut, but kept in AI' }]);
    expect(plan.removeFolders.map((p) => p.replace('022 - V/', ''))).toEqual([
      'Longform/AI',
      'Longform/AI/broll',
      'Longform/Intermediate/Motion Graphics/Source',
      'Longform/Packaging/Drafts',
    ]);
    expect(fs.existsSync(V('Longform', 'AI', 'notes.md'))).toBe(true);
  });

  it("Make Shorts' cleanup takes only the Shorts Plan and the retention graphs", () => {
    fs.writeFileSync(V('Shorts', 'Retention Graph.png'), 'graph');
    fs.writeFileSync(V('Shorts', 'Retention Graph - before 2026-11-15 000647.png'), 'old graph');
    const plan = cleanupPlan('022 - V/Shorts');
    expect(plan.remove.map((i) => i.path).sort()).toEqual(['022 - V/Shorts/Retention Graph - before 2026-11-15 000647.png', '022 - V/Shorts/Retention Graph.png', '022 - V/Shorts/Shorts Plan.json']);
    const done = runCleanup('022 - V/Shorts', plan.token);
    expect(done.removed).toBe(3);
    expect(fs.readFileSync(path.join(done.trash, '022 - V', 'Shorts', 'Shorts Plan.json'), 'utf8')).toBe('{}');
    expect(fs.existsSync(V('Shorts', '022_S01 - A', 'AI', 'frame.jpg'))).toBe(true); // nothing inside a Short
  });

  it('a Short is cleaned on its own', () => {
    expect(cleanupPlan('022 - V/Shorts/022_S01 - A').remove.map((i) => i.path)).toEqual(['022 - V/Shorts/022_S01 - A/AI/frame.jpg']);
  });

  it('moves the list to Trash, keeps the rest, and points CapCut at the moved file', () => {
    const plan = cleanupPlan('022 - V/Longform');
    const done = runCleanup('022 - V/Longform', plan.token);
    expect(done).toMatchObject({ removed: 5, moved: 1 });
    expect(fs.existsSync(V('Shorts', 'Shorts Plan.json'))).toBe(true); // kept, for Make Shorts
    expect(fs.existsSync(V('Shorts', '022_S01 - A', 'AI', 'frame.jpg'))).toBe(true); // the Short's own cleanup takes that
    // Kept.
    for (const f of [['Longform', 'Raw', 'take.mp4'], ['Longform', 'Exports', 'final.mp4'], ['Longform', 'Intermediate', 'Motion Graphics', 'used.mov'], ['Longform', 'Packaging', 'V01', 'YouTube.md'], ['Longform', 'Packaging', 'V01', 'Thumbnail', 'Thumbnail.png'], ['Longform', 'Packaging', 'V01', 'Thumbnail', 'Source', 'mine.psd'], ['Shorts', '022_S01 - A', 'Exports', 'a.mp4']]) {
      expect([f.join('/'), fs.existsSync(V(...f))]).toEqual([f.join('/'), true]);
    }
    // Moved, and CapCut points at the new place; its old text is kept in Trash.
    expect(fs.readFileSync(V('Longform', 'Intermediate', 'broll', 'graded.mp4'), 'utf8')).toBe('used from AI');
    const content = fs.readFileSync(path.join(tmp, 'Drafts', '022 - V', 'Timelines', 'T1', 'draft_content.json'), 'utf8');
    expect(content).toContain('Longform/Intermediate/broll/graded.mp4');
    expect(content).not.toContain('Longform/AI/');
    expect(fs.existsSync(path.join(done.trash, 'CapCut Drafts (before)', '022 - V', 'Timelines', 'T1', 'draft_content.json'))).toBe(true);
    // Removed: in Trash under the same folders, and the emptied folders gone.
    expect(fs.readFileSync(path.join(done.trash, '022 - V', 'Longform', 'Packaging', 'Drafts', 'Brief.md'), 'utf8')).toBe('brief');
    expect(fs.existsSync(V('Longform', 'AI'))).toBe(false);
    expect(fs.existsSync(V('Longform', 'Packaging', 'Drafts'))).toBe(false);
    expect(fs.existsSync(V('Longform', 'Packaging', 'V01', 'Thumbnail', 'Source'))).toBe(true);
  });

  it('refuses while CapCut is open, or when the files changed since the list was made', () => {
    const plan = cleanupPlan('022 - V/Longform');
    capcutOpen = true;
    expect(() => runCleanup('022 - V/Longform', plan.token)).toThrow(/Close CapCut/);
    capcutOpen = false;
    fs.writeFileSync(V('Longform', 'AI', 'new.txt'), 'new');
    expect(() => runCleanup('022 - V/Longform', plan.token)).toThrow(/changed since the list was made/);
    expect(fs.existsSync(V('Longform', 'AI', 'notes.md'))).toBe(true);
  });

  it("uses HeartQuarters' list of what it added to Source", () => {
    fs.writeFileSync(V('Longform', 'Packaging', 'V01', 'Thumbnail', 'Source', 'enlarged.png'), 'x');
    fs.writeFileSync(V('Longform', 'Packaging', 'V01', 'Thumbnail', 'Source', SOURCE_MANIFEST), JSON.stringify(['enlarged.png']));
    const paths = cleanupPlan('022 - V/Longform').remove.map((i) => i.path);
    expect(paths).toContain('022 - V/Longform/Packaging/V01/Thumbnail/Source/enlarged.png');
    expect(paths).not.toContain('022 - V/Longform/Packaging/V01/Thumbnail/Source/mine.psd');
  });

  it('lists nothing, and refuses, while a CapCut project has a missing link', () => {
    const content = path.join(tmp, 'Drafts', '022 - V', 'Timelines', 'T1', 'draft_content.json');
    const gone = fwd(V('Longform', 'Intermediate', 'Motion Graphics', 'renamed.mov'));
    fs.writeFileSync(content, fs.readFileSync(content, 'utf8').replace('"videos":[', `"videos":[{"path":"${gone}"},`));
    const plan = cleanupPlan('022 - V/Longform');
    expect(plan.missing).toEqual([`022 - V: ${gone}`]);
    expect(plan.remove).toEqual([]);
    expect(() => runCleanup('022 - V/Longform', plan.token)).toThrow(/1 missing link\. Fix it in CapCut first/);
    expect(fs.existsSync(V('Longform', 'Intermediate', 'Motion Graphics', 'unused.mov'))).toBe(true);
  });

  it("ignores stale links in Google Drive's numbered copies, like template (1).json", () => {
    const gone = fwd(V('Longform', 'AI', 'Motion Graphics', 'old.mov'));
    fs.writeFileSync(path.join(tmp, 'Drafts', '022 - V', 'template (1).json'), JSON.stringify({ path: gone }));
    expect(cleanupPlan('022 - V/Longform').missing).toEqual([]);
  });

  it("ignores old paths in CapCut's proxy list, draft_agency_config.json", () => {
    const gone = fwd(V('Longform', 'Video', 'Raw', 'take.mkv'));
    fs.writeFileSync(path.join(tmp, 'Drafts', '022 - V', 'draft_agency_config.json'), JSON.stringify({ marterials: [{ source_path: gone }] }));
    expect(cleanupPlan('022 - V/Longform').missing).toEqual([]);
  });

  it('resolves internal subdraft links inside the current CapCut draft when the draft was renamed from an older working name', () => {
    const subDir = path.join(tmp, 'Drafts', '022 - V', 'subdraft', '121B5324');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'sub_draft_config.json'), '{}');
    const oldDraftLink = `${fwd(path.join(tmp, 'Drafts', '022 - Old Working Name'))}/subdraft/121B5324/sub_draft_config.json`;
    fs.writeFileSync(path.join(subDir, 'draft_content.json'), JSON.stringify({ path: oldDraftLink }));
    expect(cleanupPlan('022 - V/Longform').missing).toEqual([]);
  });

  it("checks a Short's own project too, even when its links all point somewhere else", () => {
    const draft = path.join(tmp, 'Drafts', '022_S01 - A');
    fs.mkdirSync(draft, { recursive: true });
    const elsewhere = fwd(path.join(tmp, 'Video Projects', '021 - Old', 'Longform', 'Raw', 'take.mp4'));
    fs.writeFileSync(path.join(draft, 'draft_meta_info.json'), JSON.stringify({ draft_materials: [{ value: [{ file_Path: elsewhere }] }] }));
    fs.writeFileSync(path.join(draft, 'draft_content.json'), JSON.stringify({ materials: { videos: [{ path: elsewhere }] } }));
    expect(cleanupPlan('022 - V/Shorts/022_S01 - A').missing).toEqual([`022_S01 - A: ${elsewhere}`]);
  });

  it('keeps and relinks CapCut paths stored with escaped backslashes or different drive-letter case', () => {
    const content = path.join(tmp, 'Drafts', '022 - V', 'Timelines', 'T1', 'draft_content.json');
    const meta = path.join(tmp, 'Drafts', '022 - V', 'draft_meta_info.json');
    const winUsed = V('Longform', 'AI', 'broll', 'graded.mp4').replace(/^[A-Z]:/, (m) => m.toLowerCase());
    const winMotion = V('Longform', 'Intermediate', 'Motion Graphics', 'used.mov').replace(/^[A-Z]:/, (m) => m.toLowerCase());
    fs.writeFileSync(meta, JSON.stringify({ draft_materials: [{ value: [{ file_Path: winUsed }] }] }));
    fs.writeFileSync(content, JSON.stringify({ materials: { videos: [{ path: winUsed }, { path: winMotion }] } }));
    const plan = cleanupPlan('022 - V/Longform');
    const done = runCleanup('022 - V/Longform', plan.token);
    expect(done.moved).toBe(1);
    const updated = fs.readFileSync(content, 'utf8');
    expect(updated).toContain('Intermediate\\\\broll\\\\graded.mp4');
    expect(updated).not.toContain('AI\\\\broll');
  });

  it('refuses Clean Up if a CapCut draft metadata file cannot be read', () => {
    const unreadable = path.join(tmp, 'Drafts', 'Other Draft');
    fs.mkdirSync(path.join(unreadable, 'draft_meta_info.json'), { recursive: true });
    expect(() => cleanupPlan('022 - V/Longform')).toThrow(/Couldn't read CapCut project "Other Draft"/);
  });

  it('stays inside the Video Projects folder', () => {
    expect(() => cleanupPlan('../outside/Longform')).toThrow();
    expect(() => cleanupPlan('')).toThrow();
  });
});
