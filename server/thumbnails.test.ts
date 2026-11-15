// Make Thumbnail and change requests: fake folders and a fake image AI only, so no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { changeThumbnail, firstRequest, isShort, nextConversationName, sessionFrom, startThumbnail, thumbJobs, type MakeImage } from './thumbnails';
import { makeTree, removeTree } from './testing';

let tmp: string;
const saved = { projects: '', expressions: '' };
const LONGFORM = '005 - Series/005A - One/Longform';
const drafts = () => path.join(tmp, 'Projects', LONGFORM, 'Packaging', 'Drafts');
const PICK = { title: 'Rope Broke Me Open', thumbnailText: 'Rope broke me open', accent: 'OPEN', expression: 'Positive > Relief', background: 'warm brown', why: 'because', backedBy: ['Claude'] };

beforeEach(() => {
  tmp = makeTree({
    [`Projects/${LONGFORM}/Packaging/V01/YouTube.md`]: '',
    [`Projects/${LONGFORM}/Packaging/Drafts/Brief.md`]: '# Brief',
    'Projects/022 - Other/Longform/Packaging/Drafts/Gemini 01/01.png': 'png',
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

const choose = (photo: string | null = 'Positive/Relief/Relief_008.jpg') =>
  fs.writeFileSync(path.join(drafts(), 'Choice.json'), JSON.stringify({ pick: PICK, index: 1, photo }));

/** A fake image AI: writes a small file where it's asked, and remembers what it was given. */
const calls: { ai: string; prompt: string; out: string; session?: string; photo?: string; refs?: string[] }[] = [];
const fakeMake: MakeImage = async (ai, prompt, cwd, out, opts) => {
  calls.push({ ai, prompt, out, ...opts });
  fs.writeFileSync(path.join(cwd, out), `image ${calls.length}`);
  return { image: path.join(cwd, out), session: opts.session ?? `session-${ai}` };
};
beforeEach(() => {
  calls.length = 0;
});

describe('Make Thumbnail', () => {
  it('uses a project-owned source photo after the library photo is removed', async () => {
    const local = `${LONGFORM}/Packaging/Drafts/Source/kept.jpg`;
    fs.mkdirSync(path.join(drafts(), 'Source'));
    fs.writeFileSync(path.join(tmp, 'Projects', local), 'kept');
    choose(`project:${local}`);
    const { job, finished } = startThumbnail(LONGFORM, 'codex', fakeMake);
    await finished;
    expect(job.state).toBe('done');
    expect(calls[0].photo).toBe(path.join(tmp, 'Projects', local));
  });
  it('needs a chosen pair and a photo first', () => {
    expect(() => startThumbnail(LONGFORM, 'codex', fakeMake)).toThrow(/Choose one of the top 3/);
    choose(null);
    expect(() => startThumbnail(LONGFORM, 'codex', fakeMake)).toThrow(/Pick a photo/);
    choose();
    expect(() => startThumbnail(LONGFORM, 'claude', fakeMake)).toThrow(/ChatGPT or Gemini/);
  });

  it('makes a new conversation folder with the image, the request and the conversation id', async () => {
    choose();
    const { job, finished } = startThumbnail(LONGFORM, 'codex', fakeMake);
    expect(job).toMatchObject({ conversation: `${LONGFORM}/Packaging/Drafts/ChatGPT 01`, state: 'working' });
    await finished;
    expect(job.state).toBe('done');
    const folder = path.join(drafts(), 'ChatGPT 01');
    expect(fs.readFileSync(path.join(folder, '01.png'), 'utf8')).toBe('image 1');
    expect(fs.readFileSync(path.join(folder, 'Requests.md'), 'utf8')).toContain('Photo: Positive/Relief/Relief_008.jpg');
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'Conversation.json'), 'utf8'))).toEqual({ ai: 'codex', session: 'session-codex', photo: 'Positive/Relief/Relief_008.jpg', pick: PICK });
    expect(calls[0].photo).toBe(path.join(tmp, 'Expressions', 'Positive', 'Relief', 'Relief_008.jpg'));
    expect(calls[0].prompt).toContain('ROPE BROKE ME OPEN');
    expect(thumbJobs(LONGFORM)).toHaveLength(1);
    expect(thumbJobs('022 - Other/Longform')).toHaveLength(0);
  });

  it('numbers conversations per AI and never reuses a folder', async () => {
    choose();
    fs.mkdirSync(path.join(drafts(), 'ChatGPT 02'));
    expect(nextConversationName(drafts(), 'codex')).toBe('ChatGPT 03');
    expect(nextConversationName(drafts(), 'gemini')).toBe('Gemini 01');
    const a = startThumbnail(LONGFORM, 'gemini', fakeMake);
    const b = startThumbnail(LONGFORM, 'gemini', fakeMake);
    await Promise.all([a.finished, b.finished]);
    expect(fs.readdirSync(drafts()).filter((f) => f.startsWith('Gemini')).sort()).toEqual(['Gemini 01', 'Gemini 02']);
  });

  it('records a failure and keeps the folder with what was asked', async () => {
    choose();
    const { job, finished } = startThumbnail(LONGFORM, 'codex', async () => {
      throw new Error('out of credits');
    });
    await finished;
    expect(job).toMatchObject({ state: 'failed', error: 'out of credits' });
    expect(fs.readdirSync(path.join(drafts(), 'ChatGPT 01'))).toEqual(['Requests.md']);
  });
});

describe('change requests', () => {
  it('go to the same conversation, and the result is saved as the next image', async () => {
    choose();
    await startThumbnail(LONGFORM, 'codex', fakeMake).finished;
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    const { finished } = changeThumbnail(LONGFORM, conversation, 'make the text bigger', fakeMake);
    await finished;
    expect(calls[1]).toMatchObject({ session: 'session-codex', out: '02.png' });
    expect(calls[1].photo).toBeUndefined();
    expect(calls[1].prompt).toContain('make the text bigger');
    const folder = path.join(drafts(), 'ChatGPT 01');
    expect(fs.readFileSync(path.join(folder, '02.png'), 'utf8')).toBe('image 2');
    expect(fs.readFileSync(path.join(folder, '01.png'), 'utf8')).toBe('image 1');
    expect(fs.readFileSync(path.join(folder, 'Requests.md'), 'utf8')).toContain('## 02 (change request from John)\n\nmake the text bigger');
  });

  it('sends pasted images and other drafts as references, and keeps them in the References folder', async () => {
    choose();
    await startThumbnail(LONGFORM, 'codex', fakeMake).finished;
    fs.mkdirSync(path.join(drafts(), 'Gemini 01'));
    fs.writeFileSync(path.join(drafts(), 'Gemini 01', '01.png'), 'gemini rope');
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('pasted')]).toString('base64');
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    await changeThumbnail(LONGFORM, conversation, 'the rope like this', fakeMake, { pasted: [png], drafts: [`${LONGFORM}/Packaging/Drafts/Gemini 01/01.png`] }).finished;
    const refs = path.join(drafts(), 'ChatGPT 01', 'References');
    expect(fs.readdirSync(refs).sort()).toEqual(['02 - 1.png', '02 - 2.png']);
    expect(fs.readFileSync(path.join(refs, '02 - 2.png'), 'utf8')).toBe('gemini rope');
    expect(calls[1].refs).toEqual([path.join(refs, '02 - 1.png'), path.join(refs, '02 - 2.png')]);
    expect(calls[1].prompt).toContain('2 reference images');
    expect(fs.readFileSync(path.join(drafts(), 'ChatGPT 01', 'Requests.md'), 'utf8')).toContain('Reference images: References/02 - 1.png, References/02 - 2.png');
  });

  it('refuses references that are not images, too many, or images from outside this video', async () => {
    choose();
    await startThumbnail(LONGFORM, 'codex', fakeMake).finished;
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    const text = Buffer.from('not an image').toString('base64');
    expect(() => changeThumbnail(LONGFORM, conversation, 'x', fakeMake, { pasted: [text] })).toThrow(/PNG, JPEG or WebP/);
    expect(() => changeThumbnail(LONGFORM, conversation, 'x', fakeMake, { pasted: ['not base64!'] })).toThrow(/could not be read/);
    expect(() => changeThumbnail(LONGFORM, conversation, 'x', fakeMake, { drafts: ['022 - Other/Longform/Packaging/Drafts/Gemini 01/01.png'] })).toThrow(/this video's draft images/);
    expect(() => changeThumbnail(LONGFORM, conversation, 'x', fakeMake, { drafts: [`${LONGFORM}/Packaging/Drafts/Brief.md`] })).toThrow(/this video's draft images/);
    expect(() => changeThumbnail(LONGFORM, conversation, 'x', fakeMake, { drafts: ['a', 'b', 'c', 'd', 'e'] })).toThrow(/at most 4/);
    expect(fs.existsSync(path.join(drafts(), 'ChatGPT 01', 'References'))).toBe(false);
  });

  it("refuses an empty request, another video's draft, and a draft with no conversation", async () => {
    choose();
    fs.mkdirSync(path.join(drafts(), 'ChatGPT 05'));
    expect(() => changeThumbnail(LONGFORM, `${LONGFORM}/Packaging/Drafts/ChatGPT 05`, ' ', fakeMake)).toThrow(/Say what to change/);
    expect(() => changeThumbnail(LONGFORM, '022 - Other/Longform/Packaging/Drafts/Gemini 01', 'x', fakeMake)).toThrow(/isn't one of this video's drafts/);
    expect(() => changeThumbnail(LONGFORM, `${LONGFORM}/Packaging/Drafts/ChatGPT 05`, 'x', fakeMake)).toThrow(/no conversation to continue/);
    expect(() => changeThumbnail(LONGFORM, '../outside', 'x', fakeMake)).toThrow();
  });

  it('refuses a second request while the AI is still working on that draft', async () => {
    choose();
    let release!: () => void;
    const slow: MakeImage = (...args) => new Promise((r) => (release = () => r(fakeMake(...args))));
    const { finished } = startThumbnail(LONGFORM, 'codex', slow);
    expect(() => changeThumbnail(LONGFORM, `${LONGFORM}/Packaging/Drafts/ChatGPT 01`, 'x', fakeMake)).toThrow(/still working/);
    release();
    await finished;
  });
});

describe('small helpers', () => {
  it('tells a Short from a longform', () => {
    expect(isShort('022 - X/Shorts/022_S01 - A')).toBe(true);
    expect(isShort('999 - Shorts/2026/999-2026-01 - A')).toBe(true);
    expect(isShort('022 - X/Longform')).toBe(false);
  });

  it('asks for portrait for a Short and keeps the bottom-right clear for a longform', () => {
    const choice = { pick: PICK, index: 0, photo: 'p.jpg' };
    expect(firstRequest(choice, true, '01.png')).toContain('9:16 portrait');
    expect(firstRequest(choice, false, '01.png')).toContain('bottom-right corner');
  });

  it("reads the conversation's id from the AI's JSON lines", () => {
    expect(sessionFrom('noise\n{"type":"thread.started","thread_id":"abc"}\n', 'thread_id')).toBe('abc');
    expect(sessionFrom('{"conversation_id":"g1"}', 'conversation_id')).toBe('g1');
    expect(sessionFrom('nothing', 'thread_id')).toBe('');
  });
});
