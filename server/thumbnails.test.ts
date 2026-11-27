// Make Thumbnail and change requests: fake folders and a fake image AI only, so no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { changeThumbnail, firstRequest, geminiImageArgs, isShort, lastReply, newestImage, nextConversationName, noImageError, sessionFrom, startThumbnail, thumbJobs, type MakeImage } from './thumbnails';
import { makeTree, removeTree } from './testing';
import { readProject, type BriefPick } from './projects';
import { checkedPick } from './thumbnail-feedback';

let tmp: string;
const saved = { projects: '', expressions: '' };
const LONGFORM = '005 - Series/005A - One/Longform';
const drafts = () => path.join(tmp, 'Projects', LONGFORM, 'Packaging', 'Drafts');
const PICK: BriefPick = { title: 'Rope Broke Me Open', thumbnailText: 'Rope broke me open', accent: 'OPEN', expression: 'Positive > Relief', background: 'warm brown', why: 'because', backedBy: ['Claude'] };

beforeEach(() => {
  tmp = makeTree({
    [`Projects/${LONGFORM}/Packaging/V01/YouTube.md`]: '',
    [`Projects/${LONGFORM}/Packaging/Drafts/Brief.md`]: '# Brief',
    'Projects/022 - Other/Longform/Packaging/Drafts/Gemini 01/01.png': 'png',
    'Expressions/Positive/Relief/Relief_008.jpg': 'photo',
    'Expressions/Empathy/Compassion/Compassion_005.jpg': 'new photo',
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

const choose = (photo: string | null = 'Positive/Relief/Relief_008.jpg', pick = PICK) =>
  fs.writeFileSync(path.join(drafts(), 'Choice.json'), JSON.stringify({ pick, index: 1, photo }));

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
  it('passes the chosen composition and supporting visual into the image request', async () => {
    const composition = 'A large unsent message at center. John is below it with the words across the top.';
    choose(undefined, { ...PICK, background: composition });
    const { job, finished } = startThumbnail(LONGFORM, 'codex', fakeMake);
    await finished;
    expect(job.state).toBe('done');
    expect(calls[0].prompt).toContain(composition);
    expect(calls[0].prompt).toContain('Follow the concept for the placement and scale');
    expect(calls[0].prompt).not.toContain('John on one side, the text on the other');
  });
  it('gives Gemini all reference photos and their distinct folders without enabling terminal commands', () => {
    const first = path.join(tmp, 'one', 'first.jpg');
    const second = path.join(tmp, 'two', 'second.jpg');
    const third = path.join(tmp, 'two', 'third.jpg');
    const args = geminiImageArgs('Make an image', tmp, { photo: first, refs: [second, third] });
    expect(args[args.indexOf('-p') + 1]).toContain(first);
    expect(args[args.indexOf('-p') + 1]).toContain(second);
    expect(args[args.indexOf('-p') + 1]).toContain(third);
    expect(args.filter((v) => v === '--add-dir')).toHaveLength(3);
    expect(args).toContain(path.dirname(first)); expect(args).toContain(path.dirname(second));
    expect(args).toContain('--sandbox');
    expect(JSON.parse(args[args.indexOf('--settings') + 1]).permissions.allow).toEqual(['read_file(*)']);
  });
  it('finds a generated image inside a subfolder of the session folder, ignoring dot-folders like .system_generated', () => {
    const dir = path.join(tmp, 'brain', 'sess-1');
    const hidden = path.join(dir, '.system_generated', 'logs', 'media');
    fs.mkdirSync(hidden, { recursive: true });
    fs.writeFileSync(path.join(hidden, 'step_2_media_0.jpg'), 'input-photo');
    const sub = path.join(dir, 'artifacts', 'media');
    fs.mkdirSync(sub, { recursive: true });
    const img = path.join(sub, 'thumb.png');
    fs.writeFileSync(img, 'png');
    expect(newestImage(dir, Date.now() - 5000)).toBe(img);
    fs.unlinkSync(img);
    expect(newestImage(dir, Date.now() - 5000)).toBeNull();
  });
  it('captures result and error messages when an AI finishes without an image', () => {
    expect(lastReply(JSON.stringify({ type: 'result', result: 'I could not generate that.' }))).toBe('I could not generate that.');
    expect(lastReply(JSON.stringify({ type: 'error', message: 'Quota exceeded' }))).toBe('Quota exceeded');
  });
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
    expect(fs.readdirSync(path.join(drafts(), 'ChatGPT 01'))).toEqual(['Conversation.json', 'Requests.md']);
  });
});

describe('change requests', () => {
  it('archives the approved metadata with the new image and keeps each earlier round intact', async () => {
    choose(undefined, { ...PICK, description: 'The video description.' });
    await startThumbnail(LONGFORM, 'codex', fakeMake).finished;
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    const idea = 'Put the two silhouettes below the new words, with a muted blue background.';
    const report: MakeImage = async (...args) => ({
      ...await fakeMake(...args),
      reply: `Saved 02.png.\nFinal Title: An unapproved alternative\nFinal Thumbnail Idea: ${idea}`,
    });
    const revised = changeThumbnail(LONGFORM, conversation, 'Replace the words.\nFinal Title: A Revised Title\nFinal Thumbnail Text: FOUND MY VOICE', report);
    await revised.finished;
    expect(revised.job.state).toBe('done');
    await changeThumbnail(LONGFORM, conversation, 'Move the portrait a little to the right.', fakeMake).finished;

    const draft = (n: string) => fs.readFileSync(path.join(config.videoProjectsDir, LONGFORM, 'Packaging', n, 'YouTube.md'), 'utf8');
    expect(draft('D01')).toContain(`## Title\n${PICK.title}`);
    expect(draft('D01')).toContain(`## Thumbnail text\n${PICK.thumbnailText.toUpperCase()}`);
    for (const n of ['D02', 'D03']) {
      expect(draft(n)).toContain('## Title\nA Revised Title');
      expect(draft(n)).toContain('## Thumbnail text\nFOUND MY VOICE');
      expect(draft(n)).toContain(`## Thumbnail idea\n${idea}`);
      expect(draft(n)).toContain('## Description\nThe video description.');
    }
    const card = readProject('005 - Series/005A - One').videos[0].pieces[0].drafts!.conversations[0];
    expect(card.pick?.title).toBe(PICK.title);
    expect(card.roundPicks?.['02.png']).toMatchObject({ title: 'A Revised Title', thumbnailText: 'FOUND MY VOICE', thumbnailIdea: idea });
    expect(card.roundPicks?.['01.png']).toBeUndefined();
    const folder = path.join(config.videoProjectsDir, conversation);
    expect(checkedPick(folder, path.join(folder, '01.png'))?.title).toBe(PICK.title);
    expect(checkedPick(folder, path.join(folder, '02.png'))?.title).toBe('A Revised Title');
  });

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

  it('numbers past gaps so deleting 01.png never overwrites 02.png, and removes the temp work folder', async () => {
    choose();
    let seenWork = '';
    const trackingMake: MakeImage = async (ai, prompt, work, out, opts) => {
      seenWork = work;
      return fakeMake(ai, prompt, work, out, opts);
    };
    await startThumbnail(LONGFORM, 'codex', trackingMake).finished;
    expect(fs.existsSync(seenWork)).toBe(false);
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    const folder = path.join(drafts(), 'ChatGPT 01');
    fs.renameSync(path.join(folder, '01.png'), path.join(folder, '02.png'));
    const keep = fs.readFileSync(path.join(folder, '02.png'));
    await changeThumbnail(LONGFORM, conversation, 'bigger text', trackingMake).finished;
    expect(fs.existsSync(seenWork)).toBe(false);
    expect(fs.readFileSync(path.join(folder, '02.png'))).toEqual(keep);
    expect(fs.existsSync(path.join(folder, '03.png'))).toBe(true);
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

describe('a change with the photo chosen since', () => {
  it('sends that photo as the new identity reference, and it becomes the conversation photo', async () => {
    choose();
    await startThumbnail(LONGFORM, 'codex', fakeMake).finished;
    choose('Empathy/Compassion/Compassion_005.jpg');
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    await changeThumbnail(LONGFORM, conversation, 'Regenerate with the newly selected image', fakeMake, { photo: true }).finished;
    const newPhoto = path.join(tmp, 'Expressions', 'Empathy', 'Compassion', 'Compassion_005.jpg');
    expect(calls[1]).toMatchObject({ session: 'session-codex', out: '02.png', photo: newPhoto });
    expect(calls[1].prompt).toContain(`saved at: ${newPhoto}). From now on it is THE IDENTITY REFERENCE`);
    expect(calls[1].prompt).not.toContain('especially his face and likeness');
    const folder = path.join(drafts(), 'ChatGPT 01');
    expect(fs.readFileSync(path.join(folder, 'Requests.md'), 'utf8')).toContain('New photo: Empathy/Compassion/Compassion_005.jpg');
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'Conversation.json'), 'utf8')).photo).toBe('Empathy/Compassion/Compassion_005.jpg');
  });
  it("is refused when no photo is chosen, and doesn't change the conversation's photo when not asked", async () => {
    choose();
    await startThumbnail(LONGFORM, 'codex', fakeMake).finished;
    const conversation = `${LONGFORM}/Packaging/Drafts/ChatGPT 01`;
    choose(null);
    expect(() => changeThumbnail(LONGFORM, conversation, 'x', fakeMake, { photo: true })).toThrow(/No photo is chosen/);
    choose('Empathy/Compassion/Compassion_005.jpg');
    await changeThumbnail(LONGFORM, conversation, 'bigger text', fakeMake).finished;
    expect(calls[1].photo).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(drafts(), 'ChatGPT 01', 'Conversation.json'), 'utf8')).photo).toBe('Positive/Relief/Relief_008.jpg');
  });
});

describe('when an AI makes no image', () => {
  it("says what the AI said, such as a question it asked", () => {
    const codex = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"I will check the folder first."}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"I need the newly selected photo. Please attach it."}}',
    ].join('\n');
    expect(lastReply(codex)).toBe('I need the newly selected photo. Please attach it.');
    expect(noImageError('ChatGPT', codex).message).toBe(`ChatGPT didn't make an image. It said: "I need the newly selected photo. Please attach it."`);
    expect(lastReply('{"type":"message","role":"assistant","content":[{"type":"text","text":"No can do."}]}')).toBe('No can do.');
    expect(noImageError('Gemini', 'not json').message).toBe("Gemini finished but didn't make an image.");
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
