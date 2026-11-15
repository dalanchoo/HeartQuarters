// Write Brief: finding the source, and the three AIs in turn writing Packaging\Drafts\Brief.md. Fake folders and fake
// AIs only: no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { briefSource, chooseBriefPhoto, chooseBriefPick, errorInAnswer, expressionCategories, findSource, fromHeading, noteWhoTookPart, picksFromAnswer, readSource, reviewerPrompt, shortNote, srtToText, startBrief, writerPrompt, startPicks, type AskAi, type BriefStep } from './brief';
import { readChoice, readPicks } from './projects';
import { config } from './config';
import { makeTree, removeTree } from './testing';

let tmp: string;
let original: string;
const LONGFORM = '022 - Worth Telling Them/Longform';
const draftsDir = () => path.join(tmp, LONGFORM, 'Packaging', 'Drafts');
const briefText = () => fs.readFileSync(path.join(draftsDir(), 'Brief.md'), 'utf8');

beforeEach(() => {
  tmp = makeTree({
    [`${LONGFORM}/Packaging/V01/YouTube.md`]: 'Title:\nx',
    [`${LONGFORM}/Subtitles/022-captions.srt`]: '1\n00:00:00,000 --> 00:00:02,000\nIf you have SDAM,\n\n2\n00:00:02,000 --> 00:00:04,000\nyou may have agonized.\n',
    [`${LONGFORM}/022 - Script.md`]: 'the script',
    '023 - Not Recorded/Longform/Packaging/V01/YouTube.md': '',
    '023 - Not Recorded/Longform/023 - Script.md': 'bullet points',
    '024 - Nothing Yet/Longform/Packaging/V01/YouTube.md': '',
  });
  original = config.videoProjectsDir;
  config.videoProjectsDir = tmp;
});

afterEach(() => {
  config.videoProjectsDir = original;
  removeTree(tmp);
});

/** A fake AI: Claude writes a brief, ChatGPT and Gemini review it, each saying a little first. */
const PICKS = { picks: [1, 2, 3].map((n) => ({ title: `Title ${n}`, thumbnailText: `TEXT ${n}`, accent: 'TEXT', expression: 'Composure > Calm', background: 'dark', why: 'because', backedBy: ['Claude', 'Gemini'] })) };
const fakeAi: AskAi = async (ai, prompt, cwd) => {
  if (fs.existsSync(path.join(cwd, 'source.txt'))) expect(fs.readFileSync(path.join(cwd, 'source.txt'), 'utf8')).toContain('agonized');
  if (fs.existsSync(path.join(cwd, 'notes.txt'))) expect(prompt).toContain('notes.txt');
  if (prompt.includes('"picks"')) {
    expect(fs.readFileSync(path.join(cwd, 'brief.md'), 'utf8')).toContain('# Brief:');
    return `Here are the top 3:
${JSON.stringify(PICKS)}
Done.`;
  }
  if (ai === 'claude') return 'Here is the brief.\n\n# Brief: 022\n\nMade from: transcript, 2026-11-14. Research: vidIQ. By: Claude.\n\n## John\'s notes\n';
  expect(fs.readFileSync(path.join(cwd, 'brief.md'), 'utf8')).toContain('# Brief: 022');
  const name = ai === 'codex' ? 'ChatGPT' : 'Gemini';
  expect(prompt).toContain(`## Review: ${name}`);
  return `Sure.\n## Review: ${name}\n- ranking`;
};

describe('the source', () => {
  it('turns an .srt into plain words', () => {
    expect(srtToText('1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nthere\n')).toBe('Hello there');
  });

  it('uses the transcript once there is one, else the script, else nothing', async () => {
    expect(briefSource(LONGFORM)).toEqual({ kind: 'transcript', path: `${LONGFORM}/Subtitles/022-captions.srt` });
    expect(briefSource('023 - Not Recorded/Longform')).toEqual({ kind: 'script', path: '023 - Not Recorded/Longform/023 - Script.md' });
    expect(briefSource('024 - Nothing Yet/Longform')).toBeNull();
    const found = findSource(path.join(tmp, LONGFORM))!;
    expect(await readSource(found.full)).toBe('If you have SDAM, you may have agonized.');
  });

  it('prefers the -captions.txt over an .srt', () => {
    fs.writeFileSync(path.join(tmp, LONGFORM, 'Subtitles', '022-captions.txt'), 'plain');
    expect(briefSource(LONGFORM)?.path).toBe(`${LONGFORM}/Subtitles/022-captions.txt`);
  });

  it('refuses folders outside the video projects or without packaging', () => {
    expect(() => briefSource('../outside')).toThrow();
    expect(() => briefSource('022 - Worth Telling Them')).toThrow(/no Packaging/);
  });
});

describe('writing the brief', () => {
  it('Claude writes it, then ChatGPT and Gemini add their reviews, and the brief says who took part', async () => {
    const { job, finished } = await startBrief(LONGFORM, 'V01 is on YouTube. Ask Studio says: SDAM is rising', fakeAi);
    expect(job.status).toBe('running');
    await finished;
    expect(job.status).toBe('done');
    expect(job.steps.map((s) => `${s.name} ${s.role} ${s.state}`)).toEqual(['Claude writes done', 'ChatGPT reviews done', 'Gemini reviews done', 'Claude picks done']);
    expect(readPicks(path.join(draftsDir(), 'Picks.json'))?.map((p) => p.title)).toEqual(['Title 1', 'Title 2', 'Title 3']);
    const text = briefText();
    expect(text.startsWith('# Brief: 022')).toBe(true); // what the AI said before the brief is dropped
    expect(text.indexOf('## Review: ChatGPT')).toBeLessThan(text.indexOf('## Review: Gemini'));
    expect(text).not.toContain('Sure.');
    expect(text).toContain('By: Claude (brief), ChatGPT and Gemini (reviews).');
  });

  it('keeps an earlier brief, renamed with its date and time', async () => {
    fs.mkdirSync(draftsDir(), { recursive: true });
    fs.writeFileSync(path.join(draftsDir(), 'Brief.md'), 'the old brief');
    const { job, finished } = await startBrief(LONGFORM, '', fakeAi);
    await finished;
    expect(job.kept).toMatch(/^Brief - \d{4}-\d\d-\d\d \d\d\.\d\d\.md$/);
    expect(fs.readFileSync(path.join(draftsDir(), job.kept!), 'utf8')).toBe('the old brief');
  });

  it('carries on when a reviewer fails, and says only who took part', async () => {
    const geminiFails: AskAi = (ai, prompt, cwd) => (ai === 'gemini' ? Promise.reject(new Error('out of credits')) : fakeAi(ai, prompt, cwd));
    const { job, finished } = await startBrief(LONGFORM, '', geminiFails);
    await finished;
    expect(job.status).toBe('done');
    expect(job.steps[2]).toMatchObject({ state: 'failed', error: 'out of credits' });
    expect(briefText()).toContain('By: Claude (brief), ChatGPT (reviews).');
    expect(briefText()).not.toContain('## Review: Gemini');
  });

  it('when Claude fails, nothing is written and an earlier brief is left as it was', async () => {
    fs.mkdirSync(draftsDir(), { recursive: true });
    fs.writeFileSync(path.join(draftsDir(), 'Brief.md'), 'the old brief');
    const { job, finished } = await startBrief(LONGFORM, '', async () => 'I could not do it.');
    await finished;
    expect(job.status).toBe('failed');
    expect(job.steps.map((s) => s.state)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
    expect(fs.readdirSync(draftsDir())).toEqual(['Brief.md']);
    expect(briefText()).toBe('the old brief');
  });

  it("keeps the brief when Claude's top 3 come back in the wrong form", async () => {
    const badPicks: AskAi = (ai, prompt, cwd) => (prompt.includes('"picks"') ? Promise.resolve('Sorry, no JSON.') : fakeAi(ai, prompt, cwd));
    const { job, finished } = await startBrief(LONGFORM, '', badPicks);
    await finished;
    expect(job.status).toBe('done');
    expect(job.steps[3]).toMatchObject({ state: 'failed', error: "Claude's top 3 weren't in the expected form." });
    expect(briefText()).toContain('## Review: Gemini');
    expect(fs.existsSync(path.join(draftsDir(), 'Picks.json'))).toBe(false);
  });

  it('Pick Top 3 works on a brief that is already there, keeping earlier picks', async () => {
    await expect(startPicks(LONGFORM, '', fakeAi)).rejects.toThrow(/no Brief.md/);
    fs.mkdirSync(draftsDir(), { recursive: true });
    fs.writeFileSync(path.join(draftsDir(), 'Brief.md'), '# Brief: 022\n\nan older brief');
    fs.writeFileSync(path.join(draftsDir(), 'Picks.json'), '{"picks":[]}');
    const { job, finished } = await startPicks(LONGFORM, 'Avoid blue', fakeAi);
    await finished;
    expect(job.status).toBe('done');
    expect(job.steps.map((s) => s.role)).toEqual(['picks']);
    expect(readPicks(path.join(draftsDir(), 'Picks.json'))).toHaveLength(3);
    expect(fs.readdirSync(draftsDir()).filter((f) => /^Picks - .*\.json$/.test(f))).toHaveLength(1);
    expect(briefText()).toBe('# Brief: 022\n\nan older brief');
  });

  it('refuses a second brief while one is being written, and a video with no source', async () => {
    let release!: () => void;
    const slow: AskAi = (ai, prompt, cwd) => new Promise((r) => (release = () => r(fakeAi(ai, prompt, cwd)))) ;
    const { finished } = await startBrief(LONGFORM, '', slow);
    await expect(startBrief(LONGFORM, '', fakeAi)).rejects.toThrow(/already being written/);
    let done = false;
    void finished.then(() => (done = true));
    while (!done) {
      release(); // lets the AI that's waiting answer, one step at a time
      await new Promise((r) => setTimeout(r, 10));
    }
    await expect(startBrief('024 - Nothing Yet/Longform', '', fakeAi)).rejects.toThrow(/no transcript/);
  });
});

describe("John's choice", () => {
  let savedLibrary: string;
  beforeEach(() => {
    savedLibrary = config.expressionsDir;
    config.expressionsDir = path.join(tmp, 'Expressions');
    fs.mkdirSync(path.join(tmp, 'Expressions', 'Positive', 'Relief'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Expressions', 'Positive', 'Relief', 'Relief_001.jpg'), 'jpg');
    fs.writeFileSync(path.join(tmp, 'Expressions', 'Positive', 'Relief', 'Relief.txt'), 'definition');
    fs.mkdirSync(draftsDir(), { recursive: true });
  });
  afterEach(() => {
    config.expressionsDir = savedLibrary;
  });
  const choiceFile = () => path.join(draftsDir(), 'Choice.json');

  it('saves the chosen pair, then the photo for it', () => {
    fs.writeFileSync(path.join(draftsDir(), 'Picks.json'), JSON.stringify(PICKS));
    expect(chooseBriefPick(LONGFORM, 1)).toMatchObject({ index: 1, photo: null, pick: { title: 'Title 2' } });
    expect(chooseBriefPhoto(LONGFORM, 'Positive\\Relief\\Relief_001.jpg').photo).toBe('Positive/Relief/Relief_001.jpg');
    expect(readChoice(choiceFile())).toMatchObject({ index: 1, photo: 'Positive/Relief/Relief_001.jpg', pick: { thumbnailText: 'TEXT 2' } });
    expect(chooseBriefPick(LONGFORM, 0).photo).toBeNull(); // choosing another pair starts its photo afresh
  });

  it('refuses a pick that is not there, and a photo before a pair is chosen', () => {
    expect(() => chooseBriefPick(LONGFORM, 0)).toThrow(/no top 3/);
    fs.writeFileSync(path.join(draftsDir(), 'Picks.json'), JSON.stringify(PICKS));
    expect(() => chooseBriefPick(LONGFORM, 5)).toThrow(/not one of the top 3/);
    expect(() => chooseBriefPick(LONGFORM, '1')).toThrow(/not one of the top 3/);
    expect(() => chooseBriefPhoto(LONGFORM, 'Positive/Relief/Relief_001.jpg')).toThrow(/Choose one of the top 3 first/);
  });

  it('accepts only images inside the expressions library', () => {
    fs.writeFileSync(path.join(draftsDir(), 'Picks.json'), JSON.stringify(PICKS));
    chooseBriefPick(LONGFORM, 0);
    expect(() => chooseBriefPhoto(LONGFORM, 'Positive/Relief/Relief.txt')).toThrow(/isn't in the expressions library/);
    expect(() => chooseBriefPhoto(LONGFORM, 'Positive/Relief/Missing.jpg')).toThrow(/isn't in the expressions library/);
    expect(() => chooseBriefPhoto(LONGFORM, '../022 - Worth Telling Them/x.jpg')).toThrow();
    expect(readChoice(choiceFile())?.photo).toBeNull();
  });
});

describe('small helpers', () => {
  it("lists the expressions library's categories that have photos, two levels deep", () => {
    const lib = path.join(tmp, 'Expressions');
    for (const d of ['Positive/Warmth/Glow', 'Positive/Joy', 'Positive/Amusement', 'Composure/Calm', '_blind_pending/x']) fs.mkdirSync(path.join(lib, d), { recursive: true });
    fs.writeFileSync(path.join(lib, 'Positive/Warmth/Glow/Glow_001.jpg'), 'jpg'); // a photo in a sub-category counts
    fs.writeFileSync(path.join(lib, 'Positive/Joy/Joy_001.png'), 'png');
    fs.writeFileSync(path.join(lib, 'Composure/Calm/Calm_001.jpg'), 'jpg');
    fs.writeFileSync(path.join(lib, 'Positive/Amusement/_Amusement.png'), 'reference picture only');
    fs.writeFileSync(path.join(lib, '_blind_pending/x/a.jpg'), 'jpg');
    expect(expressionCategories(lib)).toEqual(['Composure > Calm', 'Positive > Joy', 'Positive > Warmth']);
    expect(expressionCategories(path.join(tmp, 'missing'))).toEqual([]);
  });

  it('reads the top 3 from an answer, and refuses anything else', () => {
    expect(picksFromAnswer(`Sure:
${JSON.stringify(PICKS)}`)).toHaveLength(3);
    expect(() => picksFromAnswer('no json')).toThrow(/expected form/);
    expect(() => picksFromAnswer('{"picks":[{"title":"no thumbnail text"}]}')).toThrow(/expected form/);
  });

  it('takes an answer from its heading on, and complains when there is none', () => {
    expect(fromHeading('chat\n## Review: Gemini\nx', /^## Review: Gemini/m, 'Gemini')).toBe('## Review: Gemini\nx');
    expect(() => fromHeading('nothing', /^# Brief:/m, 'Claude')).toThrow(/expected form/);
  });

  it("writes who took part on the brief's Made from line", () => {
    const steps = [
      { ai: 'claude', name: 'Claude', role: 'writes', state: 'done' },
      { ai: 'codex', name: 'ChatGPT', role: 'reviews', state: 'done' },
    ] as BriefStep[];
    expect(noteWhoTookPart('# B\n\nMade from: script. Research: none.\n', steps)).toBe('# B\n\nMade from: script. Research: none. By: Claude (brief), ChatGPT (reviews).\n');
  });
});

describe('a Short', () => {
  it('tells every AI to plan a vertical cover and compare it with other Shorts', () => {
    const source = { kind: 'transcript' as const, path: 'x.txt' };
    expect(shortNote('022 - V/Longform')).toEqual([]);
    expect(writerPrompt('022 - V/Longform', source, false, '2026-11-14')).not.toMatch(/YouTube Short/);
    expect(writerPrompt('022 - V/Shorts/022_S04 - X', source, false, '2026-11-14')).toMatch(/YouTube Short \(vertical, 9:16\).*2160 x 3840/);
    expect(reviewerPrompt('ChatGPT', source, false, '999 - Shorts/S01')).toMatch(/YouTube Short/);
  });
});

describe("an AI's error", () => {
  it("shows Claude's own reason, with how to sign in again when that's the problem", () => {
    const expired = JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' });
    expect(errorInAnswer(expired)).toMatch(/^Failed to authenticate.*Sign in again: run claude in a terminal and type \/login\.$/);
    expect(errorInAnswer(JSON.stringify({ is_error: true, result: 'Overloaded' }))).toBe('Overloaded');
    expect(errorInAnswer(JSON.stringify({ is_error: false, result: 'fine' }))).toBe('');
    expect(errorInAnswer('')).toBe('');
  });
});
