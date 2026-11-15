// Make Version from a draft round: fake folders and a fake enlarger only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { makeVersionFromDraft, setField, type Enlarge } from './version-from-draft';

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

describe('Make Version from a draft', () => {
  it('makes the next version with the newest YouTube.md, the pair, the full-size image and its sources', async () => {
    const result = await makeVersionFromDraft(LONGFORM, `${LONGFORM}/Packaging/Drafts/ChatGPT 01/05.png`, fakeGrow, fakeMeasure);
    expect(result).toEqual({ name: 'V03', path: `${LONGFORM}/Packaging/V03` });
    const v = path.join(pkg(LONGFORM), 'V03');
    const youtube = fs.readFileSync(path.join(v, 'YouTube.md'), 'utf8');
    expect(youtube).toContain('Title:\nFour People Pointed the Same Way\n');
    expect(youtube).toContain('The newest description.'); // copied from V02, the newest
    expect(youtube).toContain('Thumbnail text:\nROPE BROKE ME OPEN');
    expect(fs.readFileSync(path.join(v, 'Thumbnail', 'Thumbnail.png'), 'utf8')).toBe('fifth at 3840x2160');
    expect(fs.readdirSync(path.join(v, 'Thumbnail', 'Source')).sort()).toEqual(['Brief.md', 'Draft - ChatGPT 01 round 05.png', 'Photo - Relief_008.jpg', 'References', 'Requests.md']);
    const notes = fs.readFileSync(path.join(v, 'Notes.md'), 'utf8');
    expect(notes).toContain('from draft ChatGPT 01, round 05');
    expect(notes).toContain('made at 1672 x 941 and enlarged to 3840 x 2160');
    expect(notes).toContain('On YouTube: not yet.');
    // Nothing that existed was changed.
    expect(fs.readFileSync(path.join(pkg(LONGFORM), 'V02', 'YouTube.md'), 'utf8')).toContain('Newer title');
    expect(fs.existsSync(path.join(pkg(LONGFORM), 'Drafts', 'ChatGPT 01', '05.png'))).toBe(true);
  });

  it("makes a Short's cover portrait, starting from the Shorts template when there's no version yet", async () => {
    const result = await makeVersionFromDraft(SHORT, `${SHORT}/Packaging/Drafts/Gemini 01/01.png`, fakeGrow, fakeMeasure);
    expect(result.name).toBe('V01');
    expect(grown).toEqual([{ width: 2160, height: 3840 }]);
    const youtube = fs.readFileSync(path.join(pkg(SHORT), 'V01', 'YouTube.md'), 'utf8');
    expect(youtube).toContain('Video language:\nen-US');
    expect(fs.readFileSync(path.join(pkg(SHORT), 'V01', 'Notes.md'), 'utf8')).toContain('Title: unchanged');
  });

  it('refuses anything that is not one of this video\'s numbered draft images', async () => {
    const tryIt = (image: string) => makeVersionFromDraft(LONGFORM, image, fakeGrow, fakeMeasure);
    await expect(tryIt(`${LONGFORM}/Packaging/Drafts/Brief.md`)).rejects.toThrow(/draft images/);
    await expect(tryIt(`${LONGFORM}/Packaging/Drafts/ChatGPT 01/References/03 - 1.png`)).rejects.toThrow(/draft images/);
    await expect(tryIt(`${SHORT}/Packaging/Drafts/Gemini 01/01.png`)).rejects.toThrow(/draft images/);
    await expect(tryIt(`${LONGFORM}/Packaging/Drafts/ChatGPT 01/09.png`)).rejects.toThrow(/draft images/);
    await expect(tryIt('../../outside.png')).rejects.toThrow();
    expect(fs.readdirSync(pkg(LONGFORM)).sort()).toEqual(['Drafts', 'V01', 'V02']);
  });

  it('removes the half-made version when enlarging fails', async () => {
    const broken: Enlarge = async () => {
      throw new Error('ffmpeg failed');
    };
    await expect(makeVersionFromDraft(LONGFORM, `${LONGFORM}/Packaging/Drafts/ChatGPT 01/05.png`, broken, fakeMeasure)).rejects.toThrow(/ffmpeg failed/);
    expect(fs.readdirSync(pkg(LONGFORM)).sort()).toEqual(['Drafts', 'V01', 'V02']);
  });
});
