// Write Brief: finding the source, and the three AIs in turn writing Packaging\Drafts\Brief.md. Fake folders and fake
// AIs only: no real AI runs.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { briefSource, briefSourceText, chooseBriefPhoto, chooseBriefPick, errorInAnswer, expressionCategories, notesWithImages, saveResearchImages, findSource, fromHeading, noteWhoTookPart, picksFromAnswer, picksPrompt, readSource, reviewerPrompt, shortNote, srtToText, startBrief, writerPrompt, startPicks, type AskAi, type BriefStep } from './brief';
import { readChoice, readPicks } from './projects';
import { config } from './config';
import { makeTree, removeTree } from './testing';
import { stageLongformThumbnails } from './brief-thumbnail-comparison';

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
const PICKS = { picks: [1, 2, 3].map((n) => ({ title: `Title ${n}`, thumbnailText: `TEXT ${n}`, accent: 'TEXT', expression: 'Composure > Calm', background: 'dark', why: 'because', backedBy: ['Claude', 'Gemini'], description: 'A description.\n\n#SDAM', tags: 'SDAM, memory', pinnedComment: 'What do you think?'  })) };
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

  it('gives the source as text, for the research question', async () => {
    expect(await briefSourceText(LONGFORM)).toEqual({ kind: 'transcript', path: `${LONGFORM}/Subtitles/022-captions.srt`, text: 'If you have SDAM, you may have agonized.' });
    expect(await briefSourceText('024 - Nothing Yet/Longform')).toBeNull();
    await expect(briefSourceText('../outside')).rejects.toThrow();
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
  it('gives every AI the previous numbered cover and separates the current episode’s revision context', async () => {
    const previous = '021 - Earlier/Longform';
    const files = {
      [`${previous}/Packaging/V01/Thumbnail/Thumbnail.jpg`]: 'recorded predecessor',
      [`${previous}/Packaging/V01/Notes.md`]: 'On YouTube: from 2026-11-05.',
      [`${previous}/Packaging/V02/Thumbnail/Thumbnail.png`]: 'title-only update',
      [`${previous}/Packaging/V02/Notes.md`]: 'On YouTube: 2026-11-23 (sent Title).',
      [`${previous}/Packaging/V03/Thumbnail/Thumbnail.png`]: 'unpublished draft',
      [`${previous}/Packaging/V03/Notes.md`]: 'On YouTube: not yet.',
      [`${LONGFORM}/Packaging/V02/Thumbnail/Thumbnail.png`]: 'current local revision',
      '023 - Not Recorded/Longform/Packaging/V01/Thumbnail/Thumbnail.png': 'later episode',
    };
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(tmp, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const check: AskAi = async (ai, prompt, cwd, images) => {
      expect(prompt).toContain(`from "${previous}" (V01, publication recorded in local notes)`);
      expect(prompt).toContain('A color or expression can repeat');
      expect(prompt).toContain("this video's latest local thumbnail version (V02)");
      expect(images?.map(file => fs.readFileSync(file, 'utf8'))).toEqual(['recorded predecessor', 'current local revision']);
      return fakeAi(ai, prompt, cwd, images);
    };
    const calls: string[] = [];
    const { job, finished } = await startBrief(LONGFORM, '', async (...args) => { calls.push(args[0]); return check(...args); });
    await finished;
    expect(job.steps.map(step => step.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(calls).toEqual(['claude', 'codex', 'gemini', 'claude']);
    const retry = await startPicks(LONGFORM, '', check);
    await retry.finished;
    expect(retry.job.status).toBe('done');
  });

  it('labels an unverified local comparison and keeps a missing previous cover from selecting an unrelated episode', () => {
    const prior = '021 - Earlier/Longform';
    const folder = path.join(tmp, prior, 'Packaging', 'V01');
    const older = path.join(tmp, '020 - Older', 'Longform', 'Packaging', 'V08');
    const work = path.join(tmp, 'test work');
    for (const dir of [folder, older, work]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(older, 'Thumbnail.jpg'), 'different episode');
    const missing = stageLongformThumbnails(LONGFORM, work);
    expect(missing.context).toContain(`previous numbered longform is "${prior}"`);
    expect(missing.images).toEqual([]);
    const local = path.join(folder, 'Thumbnail.jpg');
    fs.writeFileSync(local, 'local');
    const found = stageLongformThumbnails(LONGFORM, work);
    expect(found.context).toContain('local version, YouTube status unverified');
    expect(found.images.map(file => fs.readFileSync(file, 'utf8'))).toEqual(['local']);
  });
  it('asks the brief and final picker to use search phrases and favor vidIQ evidence', () => {
    const writer = writerPrompt('Video/Longform', { kind: 'transcript', path: 'captions.txt' }, true, '2026-11-23');
    const picker = picksPrompt(true);
    expect(writer).toContain('Record the exact phrases checked');
    expect(picker).toContain('Use the keyword results recorded in the brief');
    for (const prompt of [writer, picker]) {
      expect(prompt).toContain('tags in Title Case');
      expect(prompt).toContain('Leave out quotes, dialogue, title hooks');
      expect(prompt).toContain('omit exact phrases reported at zero volume or score');
      expect(prompt).toContain('never invent scores');
    }
  });
  it('asks each AI to label complete expression suggestions so they can be reviewed for the shot list', () => {
    const source = { kind: 'transcript' as const, path: 'captions.txt' };
    expect(writerPrompt('Video/Longform', source, false, '2026-11-17')).toContain('beginning "Expression:"');
    expect(reviewerPrompt('ChatGPT', source)).toContain('beginning "Expression:"');
  });
  it('uses the story to decide when a strongly negative expression fits', () => {
    const source = { kind: 'transcript' as const, path: 'captions.txt' };
    for (const prompt of [writerPrompt('Video/Longform', source, false, '2026-11-23'), reviewerPrompt('ChatGPT', source), picksPrompt(false)]) {
      expect(prompt).toContain('Avoid a strongly negative look when a more inviting expression also fits.');
      expect(prompt).toContain('Anger can fit a story about being consumed by rage.');
      expect(prompt).toContain('swinging between anger and joy, favor joy when it fits the concept');
      expect(prompt).not.toContain('most positive');
    }
  });
  it('Claude writes it, then ChatGPT and Gemini add their reviews, and the brief says who took part', async () => {
    const { job, finished } = await startBrief(LONGFORM, 'V01 is on YouTube. Ask Studio says: SDAM is rising', fakeAi);
    expect(job.status).toBe('running');
    await finished;
    expect(job.status).toBe('done');
    expect(job.steps.map((s) => `${s.name} ${s.role} ${s.state}`)).toEqual(['Claude writes done', 'ChatGPT reviews done', 'Gemini reviews done', 'Claude picks done']);
    expect(readPicks(path.join(draftsDir(), 'Picks.json'))?.map((p) => p.title)).toEqual(['Title 1', 'Title 2', 'Title 3']);
    expect(readPicks(path.join(draftsDir(), 'Picks.json'))?.[0]).toMatchObject({ description: 'A description.\n\n#SDAM', tags: 'SDAM, Memory', pinnedComment: 'What do you think?' });
    const text = briefText();
    expect(text.startsWith('# Brief: 022')).toBe(true); // what the AI said before the brief is dropped
    expect(text.indexOf('## Review: ChatGPT')).toBeLessThan(text.indexOf('## Review: Gemini'));
    expect(text).not.toContain('Sure.');
    expect(text).toContain('By: Claude (brief), ChatGPT and Gemini (reviews).');
  });

  it('supplies reliable subtitle times for chapter suggestions', async () => {
    let sawTimes = false;
    const inspect: AskAi = (ai, prompt, cwd, images) => { if (prompt.includes('"picks"')) { sawTimes = fs.readFileSync(path.join(cwd, 'source-timings.srt'), 'utf8').includes('00:00:02,000'); } return fakeAi(ai, prompt, cwd, images); };
    const { finished } = await startBrief(LONGFORM, '', inspect); await finished;
    expect(sawTimes).toBe(true);
  });

  it('supplies WebVTT timestamps when a transcript has a single VTT subtitle file', async () => {
    const subs = path.join(tmp, LONGFORM, 'Subtitles');
    fs.unlinkSync(path.join(subs, '022-captions.srt'));
    fs.writeFileSync(path.join(subs, '022-captions.txt'), 'A transcript without timestamps about being agonized.');
    fs.writeFileSync(path.join(subs, '022-captions.vtt'), 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nA chapter.\n');
    let sawTimes = false;
    const inspect: AskAi = (ai, prompt, cwd, images) => { if (prompt.includes('"picks"')) sawTimes = fs.readFileSync(path.join(cwd, 'source-timings.vtt'), 'utf8').includes('00:00:02.000'); return fakeAi(ai, prompt, cwd, images); };
    const { finished } = await startBrief(LONGFORM, '', inspect); await finished;
    expect(sawTimes).toBe(true);
  });

  it('supplies WebVTT timestamps when picking from an existing brief', async () => {
    const subs = path.join(tmp, LONGFORM, 'Subtitles');
    fs.unlinkSync(path.join(subs, '022-captions.srt'));
    fs.writeFileSync(path.join(subs, '022-captions.txt'), 'A transcript about being agonized.');
    fs.writeFileSync(path.join(subs, '022-captions.vtt'), 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nA chapter.\n');
    fs.mkdirSync(draftsDir(), { recursive: true });
    fs.writeFileSync(path.join(draftsDir(), 'Brief.md'), '# Brief: 022\n');
    let sawTimes = false;
    const inspect: AskAi = (ai, prompt, cwd, images) => { if (prompt.includes('"picks"')) sawTimes = fs.readFileSync(path.join(cwd, 'source-timings.vtt'), 'utf8').includes('00:00:02.000'); return fakeAi(ai, prompt, cwd, images); };
    const { finished } = await startPicks(LONGFORM, '', inspect); await finished;
    expect(sawTimes).toBe(true);
  });

  it('does not guess which timed subtitles to use when multiple files exist', async () => {
    fs.writeFileSync(path.join(tmp, LONGFORM, 'Subtitles', 'other.vtt'), 'WEBVTT\n');
    let timedFiles: string[] = [];
    const inspect: AskAi = (ai, prompt, cwd, images) => { if (prompt.includes('"picks"')) timedFiles = fs.readdirSync(cwd).filter(name => name.startsWith('source-timings.')); return fakeAi(ai, prompt, cwd, images); };
    const { finished } = await startBrief(LONGFORM, '', inspect); await finished;
    expect(timedFiles).toEqual([]);
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
    expect(readPicks(path.join(draftsDir(), 'Picks.json'))?.[0].tags).toBe('SDAM, Memory');
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
  it("lists the expressions library's categories two levels deep, including empty ones", () => {
    const lib = path.join(tmp, 'Expressions');
    for (const d of ['Positive/Warmth/Glow', 'Positive/Joy', 'Positive/Amusement', 'Composure/Calm', '_blind_pending/x']) fs.mkdirSync(path.join(lib, d), { recursive: true });
    fs.writeFileSync(path.join(lib, 'Positive/Warmth/Glow/Glow_001.jpg'), 'jpg'); // a photo in a sub-category counts
    fs.writeFileSync(path.join(lib, 'Positive/Joy/Joy_001.png'), 'png');
    fs.writeFileSync(path.join(lib, 'Composure/Calm/Calm_001.jpg'), 'jpg');
    fs.writeFileSync(path.join(lib, 'Positive/Amusement/_Amusement.png'), 'reference picture only');
    fs.writeFileSync(path.join(lib, '_blind_pending/x/a.jpg'), 'jpg');
    expect(expressionCategories(lib)).toEqual(['Composure > Calm', 'Positive > Amusement', 'Positive > Joy', 'Positive > Warmth']);
    expect(expressionCategories(path.join(tmp, 'missing'))).toEqual([]);
  });

  it('reads the top 3 from an answer, and refuses anything else', () => {
    expect(picksFromAnswer(`Sure:
${JSON.stringify(PICKS)}`)).toHaveLength(3);
    expect(() => picksFromAnswer('no json')).toThrow(/expected form/);
    expect(() => picksFromAnswer('{"picks":[{"title":"no thumbnail text"}]}')).toThrow(/expected form/);
  });
  it('accepts only supported photo cues and still reads older picks', () => {
    const [withCues, older] = picksFromAnswer(JSON.stringify({ picks: [
      { ...PICKS.picks[0], photoAttributes: ['LookRight', 123, 'MouthOpen', 'LookRight', 'EyesWide'] },
      PICKS.picks[0],
    ] }));
    expect(withCues.photoAttributes).toEqual(['LookRight', 'MouthOpen']);
    expect(older.photoAttributes).toBeUndefined();
    expect(picksPrompt(false)).toContain('Use photoAttributes only when a particular gaze or mouth position helps the concept.');
  });

  it('capitalizes generated tags while preserving acronyms, apostrophes, and existing mixed case', () => {
    const tags = 'active listening, how to be heard, Daryl Davis KKK, long-term memory, why people don’t listen, émotions, vidIQ';
    const [pick] = picksFromAnswer(JSON.stringify({ picks: [{ ...PICKS.picks[0], tags }] }));
    expect(pick.tags).toBe('Active Listening, How To Be Heard, Daryl Davis KKK, Long-Term Memory, Why People Don’t Listen, Émotions, vidIQ');
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

describe('shortcuts and junctions (code review #2)', () => {
  const outside = () => {
    const dir = fs.mkdtempSync(path.join(path.dirname(tmp), 'hq-outside-'));
    fs.writeFileSync(path.join(dir, 'secret-captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nNot this video\n');
    return dir;
  };
  it("won't send a transcript from a Subtitles junction that points outside to the AIs", async () => {
    const away = outside();
    try {
      fs.rmSync(path.join(tmp, LONGFORM, 'Subtitles'), { recursive: true });
      fs.symlinkSync(away, path.join(tmp, LONGFORM, 'Subtitles'), 'junction');
      let asked = false;
      await expect(startBrief(LONGFORM, '', async () => { asked = true; return ''; })).rejects.toThrow(/outside/);
      expect(asked).toBe(false);
    } finally {
      fs.rmSync(away, { recursive: true, force: true });
    }
  });
  it("won't write a brief through a Drafts junction, and stops before the AIs start", async () => {
    const away = outside();
    try {
      fs.symlinkSync(away, draftsDir(), 'junction');
      let asked = false;
      await expect(startBrief(LONGFORM, '', async () => { asked = true; return ''; })).rejects.toThrow(/outside|shortcut or junction/);
      expect(asked).toBe(false);
      expect(fs.readdirSync(away)).toEqual(['secret-captions.srt']);
    } finally {
      fs.rmSync(away, { recursive: true, force: true });
    }
  });
});

describe('one brief at a time for a video', () => {
  it('refuses a second start made before the first has finished getting ready', async () => {
    const first = startBrief(LONGFORM, '', fakeAi);
    const second = startBrief(LONGFORM, '', fakeAi);
    await expect(second).rejects.toThrow(/already being written/);
    await (await first).finished;
  });
  it('frees the video again when getting ready fails', async () => {
    await expect(startBrief(LONGFORM, '', fakeAi, { vidiq: ['not an image'] })).rejects.toThrow(/could not be read/);
    const { finished } = await startBrief(LONGFORM, '', fakeAi);
    await finished;
  });
});

describe('screenshots pasted into the brief boxes', () => {
  const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]).toString('base64');
  it('are kept with the brief and copied where the AIs work, named by their box', () => {
    const work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    const when = new Date(2026, 10, 15, 9, 5);
    const saved = saveResearchImages(draftsDir(), work, { vidiq: [PNG, JPG], studio: [PNG], notes: [] }, when);
    expect(saved.map((s) => path.basename(s.file))).toEqual(['vidIQ 1.png', 'vidIQ 2.jpg', 'Ask Studio 1.png']);
    expect(fs.readdirSync(path.join(draftsDir(), 'Research', '2026-11-15 09.05')).sort()).toEqual(['Ask Studio 1.png', 'vidIQ 1.png', 'vidIQ 2.jpg']);
    expect(saveResearchImages(draftsDir(), work, { vidiq: [PNG] }, when)).toHaveLength(1); // a second brief in the same minute
    expect(fs.existsSync(path.join(draftsDir(), 'Research', '2026-11-15 09.05 (2)', 'vidIQ 1.png'))).toBe(true);
    const notes = notesWithImages('My notes.', saved);
    expect(notes).toMatch(/^My notes\.\n\nScreenshots John pasted\. Open and read each one/);
    expect(notes).toContain(`From vidIQ:\n- ${saved[0].file}\n- ${saved[1].file}`);
    expect(notes).toContain(`From Ask Studio:\n- ${saved[2].file}`);
    expect(notesWithImages(' only text ', [])).toBe('only text');
  });
  it('refuses anything that is not an image, and too many, before writing anything', () => {
    const work = path.join(tmp, 'work2');
    fs.mkdirSync(work);
    expect(() => saveResearchImages(draftsDir(), work, { vidiq: [PNG, 'bm90IGFuIGltYWdl'] }, new Date())).toThrow(/PNG, JPEG or WebP/);
    expect(() => saveResearchImages(draftsDir(), work, { notes: Array(13).fill(PNG) }, new Date())).toThrow(/at most 12/);
    expect(fs.existsSync(path.join(draftsDir(), 'Research'))).toBe(false);
    expect(saveResearchImages(draftsDir(), work, undefined, new Date())).toEqual([]);
  });
  it('reach every AI: listed in notes.txt, and passed along for ChatGPT', async () => {
    const seen: { ai: string; images: string[]; notes: string }[] = [];
    const recording: AskAi = async (ai, prompt, cwd, images = []) => {
      seen.push({ ai, images, notes: fs.existsSync(path.join(cwd, 'notes.txt')) ? fs.readFileSync(path.join(cwd, 'notes.txt'), 'utf8') : '' });
      return fakeAi(ai, prompt, cwd);
    };
    const { finished } = await startBrief(LONGFORM, '', recording, { vidiq: [PNG] });
    await finished;
    expect(seen.map((s) => s.ai)).toEqual(['claude', 'codex', 'gemini', 'claude']);
    for (const s of seen) {
      expect(s.images.map((i) => path.basename(i))).toEqual(['vidIQ 1.png']);
      expect(s.notes).toContain('From vidIQ:');
    }
  });
});
