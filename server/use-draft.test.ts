// Use Thumbnail / Use Title from a draft round: fake folders and a fake enlarger only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { getField, setField, useDraft, type Enlarge } from './use-draft';

let tmp: string;
const saved = { projects: '', expressions: '' };
const LONGFORM = '005 - Series/005A - One/Longform';
const SHORT = '005 - Series/005A - One/Shorts/005A_S01 - A';
const PICK = { title: 'Four People Pointed the Same Way', thumbnailText: 'Rope broke me open', accent: 'OPEN', expression: 'Positive > Relief', background: 'warm brown, a coil of rope', why: 'because', backedBy: ['Claude'] };
const pkg = (p: string) => path.join(tmp, 'Projects', p, 'Packaging');

beforeEach(() => {
  tmp = makeTree({
    [`Projects/${LONGFORM}/Packaging/V01/YouTube.md`]: 'Title:\nOld title\n\nDescription:\nLine one.\n\nLine two.\n\nTags:\na, b\n',
    [`Projects/${LONGFORM}/Packaging/V02/YouTube.md`]: 'Title:\nNewer title\n\nDescription:\nThe newest description.\n\nTags:\nc, d\n',
    [`Projects/${LONGFORM}/Packaging/Drafts/Brief.md`]: '# Brief',
    [`Projects/${LONGFORM}/Packaging/Drafts/ChatGPT 01/01.png`]: 'first',
    [`Projects/${LONGFORM}/Packaging/Drafts/ChatGPT 01/05.png`]: 'fifth',
    [`Projects/${LONGFORM}/Packaging/Drafts/ChatGPT 01/Requests.md`]: 'asked',
    [`Projects/${LONGFORM}/Packaging/Drafts/ChatGPT 01/References/03 - 1.png`]: 'ref',
    [`Projects/${LONGFORM}/Packaging/Drafts/ChatGPT 01/Conversation.json`]: JSON.stringify({ ai: 'codex', session: 's', photo: 'Positive/Relief/Relief_008.jpg', pick: PICK }),
    [`Projects/${SHORT}/Packaging/Drafts/Gemini 01/01.png`]: 'short',
    [`Projects/${SHORT}/Packaging/V01/YouTube.md`]: 'Title:\nShort title\n',
    [`Projects/${LONGFORM}/Packaging/V02/Thumbnail/Thumbnail.jpg`]: 'old thumb',
    [`Projects/${LONGFORM}/Packaging/V02/Notes.md`]: 'Made by hand.\n\nOn YouTube: not yet.\n',
    'Projects/--- SHORTS TEMPLATE/Packaging/V01/YouTube.md': '# YouTube Info\n\nTitle:\n\nDescription:\n\nVideo language:\nen-US\n',
    'Expressions/Positive/Relief/Relief_008.jpg': 'photo',
  });
  saved.projects = config.videoProjectsDir;
  saved.expressions = config.expressionsDir;
  config.videoProjectsDir = path.join(tmp, 'Projects');
  config.expressionsDir = path.join(tmp, 'Expressions');
});

afterEach(() => {
  config.videoProjectsDir = saved.projects;
  config.expressionsDir = saved.expressions;
  removeTree(tmp);
});

const grown: { width: number; height: number }[] = [];
const fakeGrow: Enlarge = async (source, out, width, height) => {
  grown.push({ width, height });
  fs.writeFileSync(out, `${fs.readFileSync(source, 'utf8')} at ${width}x${height}`);
};
const fakeMeasure = async () => ({ width: 1672, height: 941 });
beforeEach(() => {
  grown.length = 0;
});

describe('setField', () => {
  it('replaces a one-line field, fills an empty one, and adds a missing one, leaving the rest alone', () => {
    const text = 'Title:\nOld\n\nDescription:\nA.\n\nB.\n\nThumbnail text:\n\nTags:\nx\n';
    let out = setField(text, 'Title', 'New');
    out = setField(out, 'Thumbnail text', 'ROPE');
    out = setField(out, 'Thumbnail idea', 'calm');
    expect(out).toBe('Title:\nNew\n\nDescription:\nA.\n\nB.\n\nThumbnail text:\nROPE\n\nTags:\nx\n\nThumbnail idea:\ncalm\n');
    expect(setField('Title:\r\nOld\r\n', 'title', 'New')).toBe('Title:\r\nNew\r\n');
  });
});

describe('getField', () => {
  it('reads a one-line value, or nothing for an empty or missing field', () => {
    expect(getField('Title:\nOld\n\nTags:\nx\n', 'title')).toBe('Old');
    expect(getField('Title:\nTags:\nx\n', 'Title')).toBe('');
    expect(getField('Tags:\nx\n', 'Title')).toBe('');
  });
});

describe('using a draft in the selected version', () => {
  const draft = `${LONGFORM}/Packaging/Drafts/ChatGPT 01/05.png`;
  const v2 = () => path.join(pkg(LONGFORM), 'V02');
  it('uses the preserved project photo when its library original was removed', async () => {
    const local = `${LONGFORM}/Packaging/Drafts/Source/kept.jpg`;
    fs.mkdirSync(path.join(pkg(LONGFORM), 'Drafts', 'Source'));
    fs.writeFileSync(path.join(tmp, 'Projects', local), 'preserved');
    fs.writeFileSync(path.join(pkg(LONGFORM), 'Drafts', 'ChatGPT 01', 'Conversation.json'), JSON.stringify({ ai: 'codex', session: 's', photo: `project:${local}`, pick: PICK }));
    await useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: false }, fakeGrow, fakeMeasure);
    expect(fs.readFileSync(path.join(v2(), 'Thumbnail', 'Source', 'Photo - kept.jpg'), 'utf8')).toBe('preserved');
  });
  it('Use Both: full-size thumbnail, the pair in YouTube.md, the old thumbnail kept, and a note', async () => {
    const result = await useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: true }, fakeGrow, fakeMeasure);
    expect(result.done).toBe('V02 now uses this thumbnail and title.');
    expect(fs.readFileSync(path.join(v2(), 'Thumbnail', 'Thumbnail.png'), 'utf8')).toBe('fifth at 3840x2160');
    expect(fs.existsSync(path.join(v2(), 'Thumbnail', 'Thumbnail.jpg'))).toBe(false);
    const source = fs.readdirSync(path.join(v2(), 'Thumbnail', 'Source'));
    const [replaced] = fs.readdirSync(path.join(v2(), 'Thumbnail', 'Backups'));
    expect(replaced).toMatch(/^Replaced \d{4}-\d\d-\d\d \d{6} - Thumbnail\.jpg$/);
    expect(fs.readFileSync(path.join(v2(), 'Thumbnail', 'Backups', replaced), 'utf8')).toBe('old thumb');
    expect(source.some((f) => f.startsWith('Replaced'))).toBe(false);
    expect(source).toEqual(expect.arrayContaining(['Brief.md', 'Draft - ChatGPT 01 round 05.png', 'Photo - Relief_008.jpg', 'References - ChatGPT 01', 'Requests - ChatGPT 01.md']));
    const youtube = fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8');
    expect(youtube).toContain('Title:\nFour People Pointed the Same Way\n');
    expect(youtube).toContain('The newest description.'); // the rest is untouched
    expect(youtube).toContain('Thumbnail text:\nROPE BROKE ME OPEN');
    const notes = fs.readFileSync(path.join(v2(), 'Notes.md'), 'utf8');
    expect(notes).toMatch(/^Made by hand\.\n\nOn YouTube: not yet\.\n\n\d{4}-\d\d-\d\d: used from the drafts\./);
    expect(notes).toContain('Made at 1672 x 941');
    expect(notes).toContain('(it was "Newer title")');
    // Other versions and the draft are untouched.
    expect(fs.readFileSync(path.join(pkg(LONGFORM), 'V01', 'YouTube.md'), 'utf8')).toContain('Old title');
    expect(fs.existsSync(path.join(pkg(LONGFORM), 'Drafts', 'ChatGPT 01', '05.png'))).toBe(true);
  });

  it('Use Title changes only the title; Use Thumbnail leaves the title alone', async () => {
    await useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V01`, { thumbnail: false, title: true }, fakeGrow, fakeMeasure);
    expect(fs.readFileSync(path.join(pkg(LONGFORM), 'V01', 'YouTube.md'), 'utf8')).toBe('Title:\nFour People Pointed the Same Way\n\nDescription:\nLine one.\n\nLine two.\n\nTags:\na, b\n');
    expect(fs.existsSync(path.join(pkg(LONGFORM), 'V01', 'Thumbnail'))).toBe(false);
    expect(grown).toEqual([]);
    await useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: false }, fakeGrow, fakeMeasure);
    expect(fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8')).toContain('Title:\nNewer title\n');
  });

  it("makes a Short's cover portrait", async () => {
    await useDraft(SHORT, `${SHORT}/Packaging/Drafts/Gemini 01/01.png`, `${SHORT}/Packaging/V01`, { thumbnail: true, title: false }, fakeGrow, fakeMeasure);
    expect(grown).toEqual([{ width: 2160, height: 3840 }]);
  });

  it("refuses other videos' drafts or versions, and a title nobody knows", async () => {
    const tryIt = (image: string, version = `${LONGFORM}/Packaging/V02`) => useDraft(LONGFORM, image, version, { thumbnail: true, title: false }, fakeGrow, fakeMeasure);
    await expect(tryIt(`${LONGFORM}/Packaging/Drafts/Brief.md`)).rejects.toThrow(/draft images/);
    await expect(tryIt(`${LONGFORM}/Packaging/Drafts/ChatGPT 01/References/03 - 1.png`)).rejects.toThrow(/draft images/);
    await expect(tryIt(`${SHORT}/Packaging/Drafts/Gemini 01/01.png`)).rejects.toThrow(/draft images/);
    await expect(tryIt('../../outside.png')).rejects.toThrow();
    await expect(tryIt(draft, `${SHORT}/Packaging/V01`)).rejects.toThrow(/version in this video/);
    await expect(tryIt(draft, `${LONGFORM}/Packaging/Drafts`)).rejects.toThrow(/version in this video/);
    await expect(useDraft(SHORT, `${SHORT}/Packaging/Drafts/Gemini 01/01.png`, `${SHORT}/Packaging/V01`, { thumbnail: false, title: true }, fakeGrow, fakeMeasure)).rejects.toThrow(/title isn't known/);
    await expect(useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: false, title: false }, fakeGrow, fakeMeasure)).rejects.toThrow(/Choose/);
    expect(grown).toEqual([]);
  });

  it('refuses a Backups junction that points outside, without moving the old thumbnail there (code review #1)', async () => {
    const outside = path.join(tmp, 'Outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(v2(), 'Thumbnail', 'Backups'), 'junction');
    await expect(useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: false }, fakeGrow, fakeMeasure)).rejects.toThrow(/outside|shortcut or junction/);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.readFileSync(path.join(v2(), 'Thumbnail', 'Thumbnail.jpg'), 'utf8')).toBe('old thumb');
    expect(grown).toEqual([]); // stopped before anything was made
    expect(fs.existsSync(path.join(v2(), 'Thumbnail', 'Thumbnail.new.png'))).toBe(false);
  });

  it('refuses a YouTube.md that is a link to a file elsewhere', async () => {
    const outside = path.join(tmp, 'outside-youtube.md');
    fs.writeFileSync(outside, 'Title:\nNot this one\n');
    fs.rmSync(path.join(pkg(LONGFORM), 'V01', 'YouTube.md'));
    fs.symlinkSync(outside, path.join(pkg(LONGFORM), 'V01', 'YouTube.md'), 'file');
    await expect(useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V01`, { thumbnail: false, title: true }, fakeGrow, fakeMeasure)).rejects.toThrow();
    expect(fs.readFileSync(outside, 'utf8')).toBe('Title:\nNot this one\n');
  });

  it('leaves the old thumbnail in place when enlarging fails', async () => {
    const broken: Enlarge = async () => {
      throw new Error('ffmpeg failed');
    };
    await expect(useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: true }, broken, fakeMeasure)).rejects.toThrow(/ffmpeg failed/);
    // The Source folder it had just made is removed again: the version is exactly as it was.
    expect(fs.readdirSync(path.join(v2(), 'Thumbnail')).sort()).toEqual(['Thumbnail.jpg']);
    expect(fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8')).toContain('Newer title');
  });

  it('puts everything back when the last step fails (code review #4)', async () => {
    const before = {
      youtube: fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8'),
      notes: fs.readFileSync(path.join(v2(), 'Notes.md'), 'utf8'),
    };
    // Notes.md is written last; a read-only one makes that step fail after everything else is done.
    fs.chmodSync(path.join(v2(), 'Notes.md'), 0o444);
    try {
      await expect(useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: true }, fakeGrow, fakeMeasure)).rejects.toThrow(/Nothing was changed: what was done so far was put back/);
    } finally {
      fs.chmodSync(path.join(v2(), 'Notes.md'), 0o666);
    }
    expect(fs.readdirSync(path.join(v2(), 'Thumbnail')).sort()).toEqual(['Thumbnail.jpg']);
    expect(fs.readFileSync(path.join(v2(), 'Thumbnail', 'Thumbnail.jpg'), 'utf8')).toBe('old thumb');
    expect(fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8')).toBe(before.youtube);
    expect(fs.readFileSync(path.join(v2(), 'Notes.md'), 'utf8')).toBe(before.notes);
  });

  it('puts the thumbnail back when installing the new one fails', async () => {
    const before = fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8');
    // A folder where the new Thumbnail.png would go makes the swap fail after the old one has moved to Backups.
    fs.mkdirSync(path.join(v2(), 'Thumbnail', 'Thumbnail.png'));
    await expect(useDraft(LONGFORM, draft, `${LONGFORM}/Packaging/V02`, { thumbnail: true, title: true }, fakeGrow, fakeMeasure)).rejects.toThrow(/Nothing was changed/);
    expect(fs.readFileSync(path.join(v2(), 'Thumbnail', 'Thumbnail.jpg'), 'utf8')).toBe('old thumb');
    expect(fs.existsSync(path.join(v2(), 'Thumbnail', 'Backups'))).toBe(false);
    expect(fs.existsSync(path.join(v2(), 'Thumbnail', 'Thumbnail.new.png'))).toBe(false);
    expect(fs.readFileSync(path.join(v2(), 'YouTube.md'), 'utf8')).toBe(before);
  });
});
