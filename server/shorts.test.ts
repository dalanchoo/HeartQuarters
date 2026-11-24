// The shorts plan file and making a short. Fake folders and a fake Claude only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseAi } from './ai';
import { appDir, config } from './config';
import { buildPrompt, forgetRun, getRun, parseShortsJob, sendNote, shortsPrompt, startShortsProposal, stopRun } from './claude';
import { system } from './manage';
import {
  checkShorts,
  hasRetention,
  keepOldPlan,
  latestExport,
  makeShort,
  readPlan,
  readTranscript,
  readLongformUrl,
  regenerateShort,
  retentionInfo,
  retireRetention,
  savePlan,
  saveLongformUrl,
  saveRetention,
  shortsOverview,
  generatePiece,
  notePiece,
  pieceState,
  pieceJob,
} from './shorts';
import { makeTree, removeTree } from './testing';

const VIDEO = 'TEST-shorts-023 - Test';
// "Make this short" needs a number at the start of the video's name, as real videos have.
const NUMBERED = '777 - TEST shorts';
const NAME = '777_S01 - A Good Title';
const ROW = { id: 'S01', title: 'A Good Title', start: 10, end: 50, why: 'Strong hook' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const realCheck = system.isCapCutRunning;

let tmp: string;
let saved: { projects: string; drafts: string; cmd: string[]; skills: string; python: string };
const planPath = () => path.join(tmp, 'Videos', VIDEO, 'Shorts', 'Shorts Plan.json');

beforeEach(() => {
  tmp = makeTree({
    [`Videos/${VIDEO}/Longform/Raw/`]: '',
    [`Videos/${NUMBERED}/Longform/Raw/`]: '',
    'Videos/--- SHORTS TEMPLATE/Exports/': '',
    'Videos/--- SHORTS TEMPLATE/XXX - Topic - Script.docx': 'script',
    [`Drafts/${NUMBERED}/draft_meta_info.json`]: JSON.stringify({
      draft_name: '',
      draft_fold_path: '',
      draft_root_path: '',
      draft_id: '',
      tm_draft_create: 0,
      tm_draft_modified: 0,
    }),
    // A fake Claude that writes a plan file where the skill says to, then finishes.
    'fake-claude.cjs': `
      const fs = require('fs');
      fs.mkdirSync('Shorts', { recursive: true });
      fs.writeFileSync('Shorts/Shorts Plan.json', JSON.stringify({ shorts: [{ id: 'S01', title: 'From Claude', start: 1, end: 9 }] }));
      process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'One short.' }] } }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\\n');`,
  });
  saved = { projects: config.videoProjectsDir, drafts: config.capcutDraftsDir, cmd: config.claudeCommand, skills: config.skillsDir, python: config.python };
  // No checker here unless a test writes one, and it runs with node: never the real skill or the real project.
  config.skillsDir = path.join(tmp, 'Skills');
  config.python = process.execPath;
  config.videoProjectsDir = path.join(tmp, 'Videos');
  config.capcutDraftsDir = path.join(tmp, 'Drafts');
  config.claudeCommand = [process.execPath, path.join(tmp, 'fake-claude.cjs')];
  system.isCapCutRunning = () => false;
});

afterEach(() => {
  stopRun(VIDEO, 'shorts');
  stopRun(NUMBERED, 'short-S01');
  forgetRun(VIDEO, 'shorts');
  forgetRun(NUMBERED, 'short-S01');
  system.isCapCutRunning = realCheck;
  config.videoProjectsDir = saved.projects;
  config.capcutDraftsDir = saved.drafts;
  config.claudeCommand = saved.cmd;
  config.skillsDir = saved.skills;
  config.python = saved.python;
  removeTree(tmp);
});

describe("a card's AI box, the same for the longform and each short", () => {
  const settle = async (job: 'edit' | 'short-S01') => {
    for (let i = 0; i < 100 && getRun(NUMBERED, job)?.status === 'running'; i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    return getRun(NUMBERED, job)!;
  };
  const makeShortFolder = () => fs.mkdirSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME), { recursive: true });
  afterEach(() => {
    stopRun(NUMBERED, 'edit');
    forgetRun(NUMBERED);
    delete process.env.HQ_YOUTUBE_JOBS_DIR;
  });

  it("finds the right conversation and CapCut project for each card, and refuses anything else", () => {
    makeShortFolder();
    expect(pieceJob(NUMBERED, 'Longform')).toEqual({ job: 'edit', draft: NUMBERED });
    expect(pieceJob(NUMBERED, NAME)).toEqual({ job: 'short-S01', draft: NAME });
    expect(() => pieceJob(NUMBERED, '777_S09 - Missing')).toThrow(/no short called/);
    expect(() => pieceJob(NUMBERED, '../outside')).toThrow(/isn't named like/);
    expect(() => pieceJob(VIDEO + '-missing', 'Longform')).toThrow();
  });

  it("starts a short's conversation from a note when it has none, saying which short and skill, then continues it", async () => {
    makeShortFolder();
    notePiece(NUMBERED, NAME, 'Make the captions bigger');
    let run = await settle('short-S01');
    expect(run.messages[0]).toMatchObject({ from: 'john', text: 'Make the captions bigger' });
    expect(run.prompt).toMatch(/the short "777_S01 - A Good Title".*shorts-from-longform.*CapCut closed.*Make the captions bigger/s);
    notePiece(NUMBERED, NAME, 'And smaller font');
    run = await settle('short-S01');
    expect(run.messages.filter((m) => m.from === 'john').map((m) => m.text)).toEqual(['Make the captions bigger', 'And smaller font']);
    expect(() => notePiece(NUMBERED, NAME, '   ')).toThrow(/empty/);
  });

  it("Generate makes the longform's first cut when it has none", async () => {
    expect(pieceState(NUMBERED, 'Longform')).toEqual({ generated: false, canGenerate: true });
    await generatePiece(NUMBERED, 'Longform', false);
    const run = await settle('edit');
    expect(run.messages[0].text).toBe('Edit this video with the longform-edit skill.');
  });

  describe('Regenerate', () => {
    const draftDir = () => path.join(tmp, 'Drafts', NUMBERED);
    const savedTrash = config.trashDir;
    beforeEach(() => {
      config.trashDir = path.join(tmp, 'Trash');
      fs.writeFileSync(path.join(draftDir(), 'draft_content.json'), JSON.stringify({ tracks: [{ segments: [{ id: 'my work' }] }] }));
      fs.mkdirSync(path.join(tmp, 'Drafts', '--- LONGFORM TEMPLATE'));
      fs.writeFileSync(path.join(tmp, 'Drafts', '--- LONGFORM TEMPLATE', 'draft_meta_info.json'), fs.readFileSync(path.join(draftDir(), 'draft_meta_info.json')));
    });
    afterEach(() => {
      config.trashDir = savedTrash;
    });

    it('needs confirming once the longform has a first cut', async () => {
      expect(pieceState(NUMBERED, 'Longform').generated).toBe(true);
      await expect(generatePiece(NUMBERED, 'Longform', false)).rejects.toThrow(/Confirm/);
      expect(fs.existsSync(path.join(draftDir(), 'draft_content.json'))).toBe(true);
    });

    it('moves the CapCut project to the trash and starts again from a fresh copy of the template', async () => {
      await generatePiece(NUMBERED, 'Longform', true);
      await settle('edit');
      const [slot] = fs.readdirSync(path.join(tmp, 'Trash'));
      expect(slot).toMatch(/\(regenerated\)$/);
      expect(fs.readFileSync(path.join(tmp, 'Trash', slot, 'CapCut Drafts', NUMBERED, 'draft_content.json'), 'utf8')).toContain('my work');
      expect(fs.existsSync(path.join(draftDir(), 'draft_content.json'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(draftDir(), 'draft_meta_info.json'), 'utf8')).draft_name).toBe(NUMBERED);
      expect(pieceState(NUMBERED, 'Longform').generated).toBe(false);
    });

    it('changes nothing while CapCut is open, or with Gemini', async () => {
      system.isCapCutRunning = () => true;
      await expect(generatePiece(NUMBERED, 'Longform', true)).rejects.toThrow(/Close CapCut/);
      system.isCapCutRunning = () => false;
      const file = process.env.HQ_AI_FILE;
      process.env.HQ_AI_FILE = path.join(tmp, 'ai-choice.json');
      chooseAi('gemini');
      try {
        await expect(generatePiece(NUMBERED, 'Longform', true)).rejects.toThrow(/limited/);
      } finally {
        process.env.HQ_AI_FILE = file;
      }
      expect(fs.readFileSync(path.join(draftDir(), 'draft_content.json'), 'utf8')).toContain('my work');
      expect(fs.existsSync(path.join(tmp, 'Trash'))).toBe(false);
    });
  });

  it("can't regenerate a short made by hand, which has no clip times in the plan", async () => {
    makeShortFolder();
    expect(pieceState(NUMBERED, NAME)).toMatchObject({ generated: true, canGenerate: false });
    await expect(generatePiece(NUMBERED, NAME, true)).rejects.toThrow(/isn't in the shorts plan/);
  });

  it("takes the longform's URL from its linked YouTube video first, then the older saved file", () => {
    saveLongformUrl(NUMBERED, 'https://youtu.be/from-file');
    expect(readLongformUrl(NUMBERED)).toBe('https://youtu.be/from-file');
    process.env.HQ_YOUTUBE_JOBS_DIR = path.join(tmp, 'jobs');
    fs.mkdirSync(process.env.HQ_YOUTUBE_JOBS_DIR);
    fs.writeFileSync(path.join(process.env.HQ_YOUTUBE_JOBS_DIR, 'abc.json'), JSON.stringify({ id: 'abc', piece: `${NUMBERED}/Longform`, status: 'done', videoId: 'linkedVideo' }));
    expect(readLongformUrl(NUMBERED)).toBe('https://www.youtube.com/watch?v=linkedVideo');
  });
});

describe('checking a short after each turn', () => {
  const settle = async () => {
    for (let i = 0; i < 100 && getRun(NUMBERED, 'short-S01')?.status === 'running'; i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    return getRun(NUMBERED, 'short-S01')!;
  };
  const setUp = (checker: string) => {
    const script = path.join(tmp, 'Skills', 'HMF_Skills', 'shorts-from-longform', 'scripts', 'check_short.py');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, checker);
    fs.mkdirSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME, 'Subtitles'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME, 'Subtitles', 'x-captions.srt'), '1');
    fs.mkdirSync(path.join(tmp, 'Drafts', NAME), { recursive: true });
  };

  it("shows the problems it finds, whatever the AI said, and isn't finished until it has", async () => {
    setUp("console.log('Note: ignore me'); console.log('PROBLEM: The voice is silent.'); console.log('PROBLEM: No captions.'); process.exit(1);");
    notePiece(NUMBERED, NAME, 'Check this');
    const run = await settle();
    expect(run.status).toBe('idle');
    const said = run.messages.at(-1)!;
    expect(said.from).toBe('app');
    expect(said.text).toMatch(/found 2 problem\(s\)/);
    expect(said.text).toMatch(/- The voice is silent\.\n- No captions\./);
    expect(said.text).not.toMatch(/ignore me/);
  });

  it('says the settings are fine when they are, without claiming more', async () => {
    setUp("console.log('No problems found.');");
    notePiece(NUMBERED, NAME, 'Check this');
    const said = (await settle()).messages.at(-1)!;
    expect(said.from).toBe('app');
    expect(said.text).toMatch(/no problems in its settings.*how it looks or sounds/);
  });

  it('says so if the checker itself fails', async () => {
    setUp("process.exit(3);");
    notePiece(NUMBERED, NAME, 'Check this');
    expect((await settle()).messages.at(-1)!.text).toMatch(/couldn't check/);
  });

  it("counts a missing .srt for YouTube as a problem", async () => {
    setUp("console.log('No problems found.');");
    fs.rmSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME, 'Subtitles'), { recursive: true });
    notePiece(NUMBERED, NAME, 'Check this');
    const said = (await settle()).messages.at(-1)!;
    expect(said.text).toMatch(/found 1 problem\(s\)/);
    expect(said.text).toMatch(/no \.srt in the short's Subtitles folder.*--subtitles/);
  });

  it('adds nothing when there is no checker', async () => {
    fs.mkdirSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME), { recursive: true });
    notePiece(NUMBERED, NAME, 'Check this');
    expect((await settle()).messages.some((m) => m.from === 'app')).toBe(false);
  });
});

describe("a short's first message", () => {
  const SHORT = { id: 'S02', title: 'T', start: 100, end: 150, name: '777_S02 - T', source: '777 - TEST' };

  it("passes on the plan's notes, as something to follow", () => {
    const told = buildPrompt('D:/V', { ...SHORT, notes: 'Drop the reveal list.' });
    expect(told).toMatch(/notes on this clip, which you must follow: Drop the reveal list\./);
    expect(buildPrompt('D:/V', SHORT)).not.toMatch(/notes on this clip/);
  });

  it('asks for the project to be checked before reporting', () => {
    expect(buildPrompt('D:/V', SHORT)).toMatch(/check_short\.py.*fix every PROBLEM/);
  });

  it("gets the row's notes when a short is made", async () => {
    const shorts = path.join(tmp, 'Videos', NUMBERED, 'Shorts');
    fs.mkdirSync(shorts, { recursive: true });
    fs.writeFileSync(path.join(shorts, 'Shorts Plan.json'), JSON.stringify({ shorts: [{ ...ROW, visuals: 'Drop the reveal list.', why: 'Strong hook' }] }));
    await makeShort(NUMBERED, 'S01', NUMBERED);
    for (let i = 0; i < 100 && getRun(NUMBERED, 'short-S01')?.status === 'running'; i++) {
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(getRun(NUMBERED, 'short-S01')?.prompt).toMatch(/must follow: Drop the reveal list\. Strong hook/);
  });
});

describe("the longform's YouTube URL", () => {
  it('saves only a YouTube address, and an empty box clears it', () => {
    expect(() => saveLongformUrl(NUMBERED, 'https://evil.example/x')).toThrow(/isn't a YouTube address/);
    expect(() => saveLongformUrl(NUMBERED, 'javascript:alert(1)')).toThrow();
    expect(readLongformUrl(NUMBERED)).toBeNull();
    saveLongformUrl(NUMBERED, ' https://youtu.be/abc ');
    expect(readLongformUrl(NUMBERED)).toBe('https://youtu.be/abc');
    expect(shortsOverview(NUMBERED).longformUrl).toBe('https://youtu.be/abc');
    saveLongformUrl(NUMBERED, '');
    expect(readLongformUrl(NUMBERED)).toBeNull();
  });
});

describe('Gemini, which is limited', () => {
  const file = process.env.HQ_AI_FILE;
  afterEach(() => {
    process.env.HQ_AI_FILE = file;
  });

  it("refuses to make or regenerate a short, before touching anything", async () => {
    process.env.HQ_AI_FILE = path.join(tmp, 'ai-choice.json');
    chooseAi('gemini');
    const shorts = path.join(tmp, 'Videos', NUMBERED, 'Shorts');
    fs.mkdirSync(path.join(shorts, NAME), { recursive: true });
    fs.writeFileSync(path.join(shorts, 'Shorts Plan.json'), JSON.stringify({ shorts: [{ ...ROW, made: NAME }, { ...ROW, id: 'S02', title: 'Other' }] }));
    await expect(makeShort(NUMBERED, 'S02', NUMBERED)).rejects.toThrow(/limited/);
    await expect(regenerateShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/limited/);
    expect(fs.existsSync(path.join(shorts, NAME))).toBe(true);
    expect(fs.readdirSync(shorts).sort()).toEqual([NAME, 'Shorts Plan.json'].sort());
  });
});

describe('checkShorts', () => {
  it('accepts a good row and keeps its other fields', () => {
    expect(checkShorts([ROW])).toEqual([ROW]);
  });

  it('refuses rows that could not become a short', () => {
    expect(() => checkShorts([{ ...ROW, end: 5 }])).toThrow(/after the start/);
    expect(() => checkShorts([{ ...ROW, start: 'soon' }])).toThrow(/after the start/);
    expect(() => checkShorts([{ ...ROW, title: 'Half: A Title' }])).toThrow(/folder name/);
    expect(() => checkShorts([{ ...ROW, title: '../../Windows' }])).toThrow(/folder name/);
    expect(() => checkShorts([{ ...ROW, title: ' ' }])).toThrow(/no title/);
    expect(() => checkShorts([{ ...ROW, id: 'x' }])).toThrow(/number/);
    expect(() => checkShorts([ROW, ROW])).toThrow(/Two shorts/);
    expect(() => checkShorts('nope')).toThrow(/no list/);
  });
});

describe('the plan file', () => {
  const writeRaw = (body: unknown) => {
    fs.mkdirSync(path.dirname(planPath()), { recursive: true });
    fs.writeFileSync(planPath(), typeof body === 'string' ? body : JSON.stringify(body));
  };

  it("saves John's edits with the video and reads them back, keeping the near misses", () => {
    expect(readPlan(VIDEO)).toBeNull();
    writeRaw({ shorts: [ROW], rejected: [{ title: 'No', reason: 'Length', start: 1, end: 2 }] });
    savePlan(VIDEO, [{ ...ROW, title: 'Better Title' }]);
    const plan = readPlan(VIDEO)!;
    expect(plan.shorts[0].title).toBe('Better Title');
    expect(plan.rejected.map((r) => r.title)).toEqual(['No']);
  });

  it('gives a bare near miss what a row needs, and points out times it made up', () => {
    writeRaw({
      shorts: [ROW],
      rejected: [
        { title: 'Half: A Title', start: 5, end: 9, reason: 'Length' },
        { title: 'No Times', reason: 'Low Tension' },
        { id: 'S01', title: 'Same Number', start: 1, end: 2 },
      ],
    });
    const { rejected } = readPlan(VIDEO)!;
    expect(rejected.map((r) => r.id)).toEqual(['S02', 'S03', 'S04']);
    expect(rejected[0]).toMatchObject({ title: 'Half  A Title', start: 5, end: 9, reason: 'Length' });
    expect(rejected[1]).toMatchObject({ start: 0, end: 30 });
    expect(rejected[1].reason).toMatch(/Low Tension.*placeholders/);
  });

  it('moves a row between the lists by saving both, and refuses the same number in each', () => {
    const near = { ...ROW, id: 'S02', title: 'Near' };
    savePlan(VIDEO, [ROW], [near]);
    savePlan(VIDEO, [], [ROW, near]);
    const plan = readPlan(VIDEO)!;
    expect(plan.shorts).toEqual([]);
    expect(plan.rejected.map((r) => r.id)).toEqual(['S01', 'S02']);
    expect(() => savePlan(VIDEO, [ROW], [ROW])).toThrow(/Two shorts/);
  });

  it('a page can neither undo nor invent that a short was made', () => {
    writeRaw({ shorts: [{ ...ROW, made: 'Made Name' }], rejected: [] });
    savePlan(VIDEO, [{ ...ROW, title: 'Stale Page' }, { ...ROW, id: 'S02', made: 'Invented' }]);
    const { shorts } = readPlan(VIDEO)!;
    expect(shorts[0].made).toBe('Made Name');
    expect(shorts[1].made).toBeUndefined();
  });

  it("remembers Claude's times from a row's first edit, wherever the row goes", () => {
    writeRaw({ shorts: [ROW], rejected: [] });
    savePlan(VIDEO, [{ ...ROW, end: 30 }]);
    savePlan(VIDEO, [{ ...ROW, start: 20, end: 40 }]);
    expect(readPlan(VIDEO)!.shorts[0]).toMatchObject({ start: 20, end: 40, proposed: { start: 10, end: 50 } });
    savePlan(VIDEO, [], [{ ...ROW, start: 20, end: 40 }]);
    expect(readPlan(VIDEO)!.rejected[0].proposed).toEqual({ start: 10, end: 50 });
  });

  it("a page can't rewrite what Claude proposed, and a row John added has no proposal", () => {
    writeRaw({ shorts: [ROW], rejected: [] });
    savePlan(VIDEO, [
      { ...ROW, proposed: { start: 1, end: 2 } },
      { ...ROW, id: 'S02', proposed: { start: 1, end: 2 } },
    ]);
    const { shorts } = readPlan(VIDEO)!;
    expect(shorts[0].proposed).toEqual({ start: 10, end: 50 });
    expect(shorts[1].proposed).toBeNull();
  });

  it('ignores a damaged proposal in a plan written by hand', () => {
    writeRaw({ shorts: [{ ...ROW, proposed: { start: 'soon' } }], rejected: [] });
    expect(readPlan(VIDEO)!.shorts[0].proposed).toBeUndefined();
  });

  it('a bad edit changes nothing on disk', () => {
    savePlan(VIDEO, [ROW]);
    expect(() => savePlan(VIDEO, [{ ...ROW, end: 1 }])).toThrow();
    expect(readPlan(VIDEO)!.shorts).toEqual([ROW]);
  });

  it('reports a damaged file instead of treating it as empty', () => {
    writeRaw('{ not json');
    expect(() => readPlan(VIDEO)).toThrow(/not readable/);
    expect(shortsOverview(VIDEO).planError).toMatch(/not readable/);
  });

  it('reads a file saved with a byte order mark', () => {
    writeRaw('\uFEFF' + JSON.stringify({ shorts: [ROW] }));
    expect(readPlan(VIDEO)!.shorts).toEqual([ROW]);
  });

  it('proposing again keeps the old plan under a new name', () => {
    savePlan(VIDEO, [ROW]);
    const kept = keepOldPlan(VIDEO, new Date(2026, 10, 8, 9, 5, 7))!;
    expect(path.basename(kept)).toBe('Shorts Plan - before 2026-11-08 090507.json');
    expect(JSON.parse(fs.readFileSync(kept, 'utf8')).shorts).toEqual([ROW]);
    expect(readPlan(VIDEO)).toBeNull();
    expect(keepOldPlan(VIDEO)).toBeNull();
  });

  it('two plans kept in the same second both survive', () => {
    const when = new Date(2026, 10, 8, 9, 5, 7);
    savePlan(VIDEO, [ROW]);
    keepOldPlan(VIDEO, when);
    savePlan(VIDEO, [{ ...ROW, title: 'Second' }]);
    const second = keepOldPlan(VIDEO, when)!;
    expect(path.basename(second)).toBe('Shorts Plan - before 2026-11-08 090507 (2).json');
    expect(JSON.parse(fs.readFileSync(second, 'utf8')).shorts[0].title).toBe('Second');
    expect(JSON.parse(fs.readFileSync(path.join(path.dirname(second), 'Shorts Plan - before 2026-11-08 090507.json'), 'utf8')).shorts).toEqual([ROW]);
  });

  it('stays inside the video projects folder', () => {
    expect(() => savePlan('../..', [ROW])).toThrow(/outside/);
    expect(() => readPlan('../..')).toThrow(/outside/);
    expect(() => saveRetention('../..', PNG)).toThrow(/outside/);
    expect(() => readTranscript('../..')).toThrow(/outside/);
    expect(() => latestExport('../..')).toThrow(/outside/);
  });
});

describe('the transcript of a clip', () => {
  const write = (dir: string, name: string, body: object) => {
    const full = path.join(tmp, 'Videos', VIDEO, 'Longform', dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, name), JSON.stringify(body));
  };
  const words = (word: string) => ({ segments: [{ words: [{ start: 1, end: 2, word: ` ${word}` }] }] });

  it('prefers the finished cut, and never reads a take', () => {
    expect(readTranscript(VIDEO)).toBeNull();
    write('Intermediate/Transcript', 'Take 1.words.json', words('take'));
    expect(readTranscript(VIDEO)).toBeNull();
    write('AI/transcript', 'Video.words.json', words('rough'));
    expect(readTranscript(VIDEO)!.words[0].word).toBe('rough');
    write('AI/transcript', 'Video - final.words.json', words('finished'));
    const found = readTranscript(VIDEO)!;
    expect(found.file).toBe('Video - final.words.json');
    expect(found.words).toEqual([{ start: 1, end: 2, word: 'finished' }]);
  });

  it('never reads a transcript through a Subtitles junction that points outside (code review #3)', () => {
    const away = path.join(tmp, 'Outside');
    fs.mkdirSync(away);
    fs.writeFileSync(path.join(away, '001-captions.words.json'), JSON.stringify(words('secret')));
    fs.mkdirSync(path.join(tmp, 'Videos', VIDEO, 'Longform'), { recursive: true });
    fs.symlinkSync(away, path.join(tmp, 'Videos', VIDEO, 'Longform', 'Subtitles'), 'junction');
    expect(readTranscript(VIDEO)).toBeNull();
    write('AI/transcript', 'Video.words.json', words('ours'));
    expect(readTranscript(VIDEO)!.words[0].word).toBe('ours');
  });

  it('says plainly when the transcript is not valid', () => {
    const full = path.join(tmp, 'Videos', VIDEO, 'Longform', 'Subtitles');
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, '001-captions.words.json'), '{ not json');
    expect(() => readTranscript(VIDEO)).toThrow(/001-captions\.words\.json couldn't be read/);
  });

  it("prefers the final video's transcript in Subtitles over older places", () => {
    write('Intermediate/Transcript', 'Video - edit.words.json', words('older place'));
    write('AI/transcript', 'Video - final.words.json', words('work in progress'));
    expect(readTranscript(VIDEO)!.words[0].word).toBe('older place');
    write('Subtitles', '777-captions.words.json', words('final video'));
    const found = readTranscript(VIDEO)!;
    expect(found.file).toBe('777-captions.words.json');
    expect(found.words[0].word).toBe('final video');
  });

  it('reads a flat list of words too', () => {
    write('AI/transcript', 'Flat.words.json', { words: [{ start: 0, end: 1, word: 'flat' }] });
    expect(readTranscript(VIDEO)!.words[0].word).toBe('flat');
  });

  it('falls back to an .srt in Subtitles when there is no .words.json', () => {
    const subs = path.join(tmp, 'Videos', VIDEO, 'Longform', 'Subtitles');
    fs.mkdirSync(subs, { recursive: true });
    fs.writeFileSync(
      path.join(subs, '021-captions.srt'),
      '1\n00:00:01,000 --> 00:00:04,000\nHi there\n\n2\n00:00:05,000 --> 00:00:06,000\nDone\n',
    );
    const found = readTranscript(VIDEO)!;
    expect(found.file).toBe('021-captions.srt');
    expect(found.words.map((w) => w.word)).toEqual(['Hi', 'there', 'Done']);
    expect(found.words[0].start).toBe(1);
    expect(found.words[1].end).toBe(4);
    expect(found.words[2]).toEqual({ start: 5, end: 6, word: 'Done' });

    // A real .words.json still wins over .srt.
    write('Subtitles', '021-captions.words.json', words('exact'));
    expect(readTranscript(VIDEO)!.file).toBe('021-captions.words.json');
  });

  it('never reads an .srt through a Subtitles junction that points outside', () => {
    const away = path.join(tmp, 'OutsideSrt');
    fs.mkdirSync(away);
    fs.writeFileSync(path.join(away, '021-captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nsecret\n');
    fs.mkdirSync(path.join(tmp, 'Videos', VIDEO, 'Longform'), { recursive: true });
    fs.symlinkSync(away, path.join(tmp, 'Videos', VIDEO, 'Longform', 'Subtitles'), 'junction');
    expect(readTranscript(VIDEO)).toBeNull();
  });
});

describe('the export to preview', () => {
  it('is the newest video in Exports', () => {
    expect(latestExport(VIDEO)).toBeNull();
    const dir = path.join(tmp, 'Videos', VIDEO, 'Longform', 'Exports');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'old.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.utimesSync(path.join(dir, 'old.mp4'), new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.writeFileSync(path.join(dir, 'new.mp4'), 'x');
    expect(latestExport(VIDEO)).toBe(`${VIDEO}/Longform/Exports/new.mp4`);
  });
});

describe('the retention graph', () => {
  const shortsDir = () => path.join(tmp, 'Videos', VIDEO, 'Shorts');

  it('saves a pasted PNG beside the plan', () => {
    expect(hasRetention(VIDEO)).toBe(false);
    expect(retentionInfo(VIDEO)).toBeNull();
    saveRetention(VIDEO, PNG);
    expect(hasRetention(VIDEO)).toBe(true);
    expect(retentionInfo(VIDEO)!.path).toBe(`${VIDEO}/Shorts/Retention Graph.png`);
  });

  it('refuses what is not a PNG, and keeps the graph it already has', () => {
    saveRetention(VIDEO, PNG);
    expect(() => saveRetention(VIDEO, Buffer.from('<script>').toString('base64'))).toThrow(/PNG/);
    expect(() => saveRetention(VIDEO, undefined)).toThrow(/PNG/);
    expect(hasRetention(VIDEO)).toBe(true);
  });

  it('a new graph, or stopping, only renames the old one', () => {
    saveRetention(VIDEO, PNG, new Date(2026, 0, 1, 1, 1, 1));
    saveRetention(VIDEO, PNG, new Date(2026, 0, 1, 1, 1, 2));
    expect(fs.readdirSync(shortsDir())).toContain('Retention Graph - before 2026-01-01 010102.png');
    retireRetention(VIDEO, new Date(2026, 0, 1, 1, 1, 3));
    expect(hasRetention(VIDEO)).toBe(false);
    expect(fs.readdirSync(shortsDir())).toHaveLength(2);
    retireRetention(VIDEO);
    expect(fs.readdirSync(shortsDir())).toHaveLength(2);
  });

  it('two graphs replaced in the same second are both kept', () => {
    const when = new Date(2026, 0, 1, 1, 1, 1);
    saveRetention(VIDEO, PNG, when);
    saveRetention(VIDEO, PNG, when);
    saveRetention(VIDEO, PNG, when);
    expect(fs.readdirSync(shortsDir()).sort()).toEqual(['Retention Graph - before 2026-01-01 010101 (2).png', 'Retention Graph - before 2026-01-01 010101.png', 'Retention Graph.png']);
  });
});

describe('Propose shorts', () => {
  it('asks for the choosing steps only', () => {
    const p = shortsPrompt('D:/V/023');
    expect(p).toMatch(/shorts-from-longform/);
    expect(p).toMatch(/Shorts Plan\.json and stop/);
    expect(p).toMatch(/don't change anything in CapCut/i);
  });

  it('points Claude at the retention graph only when there is one', () => {
    expect(shortsPrompt('D:/V/023', true)).toMatch(/Retention Graph\.png/);
    expect(shortsPrompt('D:/V/023', false)).toMatch(/no retention graph/);
  });

  it('runs in the video folder, and its conversation is separate from the edit', async () => {
    startShortsProposal(VIDEO);
    expect(() => startShortsProposal(VIDEO)).toThrow(/already proposing/);
    for (let i = 0; i < 100 && getRun(VIDEO, 'shorts')!.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const run = getRun(VIDEO, 'shorts')!;
    expect(run.status).toBe('idle');
    expect(run.job).toBe('shorts');
    expect(getRun(VIDEO)).toBeNull();
    expect(readPlan(VIDEO)!.shorts[0].title).toBe('From Claude');
  });
});

describe('Make this short', () => {
  const settled = async () => {
    for (let i = 0; i < 100 && getRun(NUMBERED, 'short-S01')!.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return getRun(NUMBERED, 'short-S01')!;
  };

  beforeEach(() => {
    savePlan(NUMBERED, [ROW]);
    // This fake Claude only says what it was asked; it must not rewrite the plan in these tests.
    fs.writeFileSync(
      path.join(tmp, 'fake-claude.cjs'),
      `const args = process.argv.slice(2);
       const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
       out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Got: ' + args[args.indexOf('-p') + 1] }] } });
       out({ type: 'result', subtype: 'success', is_error: false });`,
    );
  });

  it('makes the folder and a copy of the CapCut project, marks the row, and starts Claude', async () => {
    await makeShort(NUMBERED, 'S01', NUMBERED);
    const folder = path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME);
    expect(fs.existsSync(path.join(folder, 'Exports'))).toBe(true);
    expect(fs.existsSync(path.join(folder, `${NAME} - Script.docx`))).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'Drafts', NAME, 'draft_meta_info.json'), 'utf8'));
    expect(meta.draft_name).toBe(NAME);
    expect(readPlan(NUMBERED)!.shorts[0].made).toBe(NAME);
    const run = await settled();
    expect(run.status).toBe('idle');
    expect(run.draft).toBe(NAME);
    expect(run.messages[1].text).toMatch(/Build each short/);
    const overview = shortsOverview(NUMBERED);
    expect(overview.builds.S01.draft).toBe(NAME);
    expect(overview.drafts).toContain(NUMBERED);
  });

  it("sends John's notes to that short's own conversation", async () => {
    await makeShort(NUMBERED, 'S01', NUMBERED);
    const first = await settled();
    sendNote(NUMBERED, 'Move me to the left', 'short-S01');
    const run = await settled();
    expect(run.sessionId).toBe(first.sessionId);
    expect(run.messages.at(-1)!.text).toBe('Got: Move me to the left');
    expect(getRun(NUMBERED)).toBeNull();
  });

  it('can make a near miss too', async () => {
    savePlan(NUMBERED, [], [ROW]);
    await makeShort(NUMBERED, 'S01', NUMBERED);
    await settled();
    expect(readPlan(NUMBERED)!.rejected[0].made).toBe(NAME);
  });

  it('makes each row only once', async () => {
    await makeShort(NUMBERED, 'S01', NUMBERED);
    await settled();
    await expect(makeShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/already been made/);
  });

  it('touches nothing while CapCut is open', async () => {
    system.isCapCutRunning = () => true;
    await expect(makeShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/Close CapCut/);
    expect(fs.existsSync(path.join(tmp, 'Drafts', NAME))).toBe(false);
    expect(fs.readdirSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts'))).toEqual(['Shorts Plan.json']);
    expect(readPlan(NUMBERED)!.shorts[0].made).toBeUndefined();
  });

  it('refuses a row or a CapCut project that is not there', async () => {
    await expect(makeShort(NUMBERED, 'S09', NUMBERED)).rejects.toThrow(/no S09/);
    await expect(makeShort(NUMBERED, 'S01', 'Nope')).rejects.toThrow(/no CapCut draft/);
    await expect(makeShort(NUMBERED, 'S01', '../..')).rejects.toThrow();
  });

  it('leaves no half-made folder if the CapCut project already exists, and keeps what was there', async () => {
    fs.mkdirSync(path.join(tmp, 'Drafts', NAME));
    fs.writeFileSync(path.join(tmp, 'Drafts', NAME, 'mine.txt'), 'keep');
    await expect(makeShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/already exists/);
    expect(fs.existsSync(path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME))).toBe(false);
    expect(fs.readFileSync(path.join(tmp, 'Drafts', NAME, 'mine.txt'), 'utf8')).toBe('keep');
    expect(readPlan(NUMBERED)!.shorts[0].made).toBeUndefined();
  });

  it('never replaces a short folder that already exists', async () => {
    const folder = path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'mine.txt'), 'keep');
    await expect(makeShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(folder, 'mine.txt'), 'utf8')).toBe('keep');
  });

  describe('Regenerate', () => {
    const folder = () => path.join(tmp, 'Videos', NUMBERED, 'Shorts', NAME);
    const draft = () => path.join(tmp, 'Drafts', NAME);
    let savedTrash: string;

    beforeEach(() => {
      savedTrash = config.trashDir;
      config.trashDir = path.join(tmp, 'Trash');
    });
    afterEach(() => {
      config.trashDir = savedTrash;
    });

    it('moves the old short to the trash and starts again from a fresh copy, with a new conversation', async () => {
      await makeShort(NUMBERED, 'S01', NUMBERED);
      const first = await settled();
      fs.writeFileSync(path.join(folder(), 'old work.txt'), 'old');
      fs.writeFileSync(path.join(draft(), 'old work.txt'), 'old');

      await regenerateShort(NUMBERED, 'S01', NUMBERED);
      const second = await settled();

      expect(fs.existsSync(path.join(folder(), 'old work.txt'))).toBe(false);
      expect(fs.existsSync(path.join(draft(), 'old work.txt'))).toBe(false);
      expect(fs.existsSync(path.join(folder(), 'Exports'))).toBe(true);
      expect(readPlan(NUMBERED)!.shorts[0].made).toBe(NAME);
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.messages).toHaveLength(2);
      const trashed = fs.readdirSync(path.join(tmp, 'Trash'), { recursive: true }).map(String);
      expect(trashed.filter((p) => p.endsWith('old work.txt'))).toHaveLength(2);
    });

    it('leaves the other rows made', async () => {
      savePlan(NUMBERED, [ROW, { ...ROW, id: 'S02', title: 'Other' }]);
      await makeShort(NUMBERED, 'S02', NUMBERED);
      for (let i = 0; i < 100 && getRun(NUMBERED, 'short-S02')!.status === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await makeShort(NUMBERED, 'S01', NUMBERED);
      await settled();
      await regenerateShort(NUMBERED, 'S01', NUMBERED);
      await settled();
      expect(readPlan(NUMBERED)!.shorts[1].made).toBe('777_S02 - Other');
      forgetRun(NUMBERED, 'short-S02');
    });

    it('recovers when the Drive folder is already gone and only the CapCut draft remains', async () => {
      await makeShort(NUMBERED, 'S01', NUMBERED);
      await settled();
      fs.rmSync(folder(), { recursive: true, force: true });
      fs.writeFileSync(path.join(draft(), 'leftover.txt'), 'old');
      await regenerateShort(NUMBERED, 'S01', NUMBERED);
      await settled();
      expect(fs.existsSync(path.join(draft(), 'leftover.txt'))).toBe(false);
      expect(fs.existsSync(path.join(folder(), 'Exports'))).toBe(true);
    });

    it('refuses, changing nothing, in every case it cannot finish', async () => {
      await expect(regenerateShort(NUMBERED, 'S09', NUMBERED)).rejects.toThrow(/no S09/);
      await expect(regenerateShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/hasn't been made/);
      await makeShort(NUMBERED, 'S01', NUMBERED);
      await settled();
      await expect(regenerateShort(NUMBERED, 'S01', NAME)).rejects.toThrow(/its own CapCut project/);
      await expect(regenerateShort(NUMBERED, 'S01', 'Nope')).rejects.toThrow(/no CapCut draft/);
      await expect(regenerateShort(NUMBERED, 'S01', '../..')).rejects.toThrow();
      system.isCapCutRunning = () => true;
      await expect(regenerateShort(NUMBERED, 'S01', NUMBERED)).rejects.toThrow(/Close CapCut/);
      system.isCapCutRunning = () => false;
      expect(fs.existsSync(folder())).toBe(true);
      expect(fs.existsSync(draft())).toBe(true);
      expect(readPlan(NUMBERED)!.shorts[0].made).toBe(NAME);
    });
  });

  it('tells Claude which clip, and that the copy is already made', () => {
    const p = buildPrompt('D:/V/023', { id: 'S01', title: 'T', start: 10, end: 50, name: '023_S01 - T', source: '023 - V' });
    expect(p).toMatch(/from 10 to 50 seconds/);
    expect(p).toMatch(/"023_S01 - T"/);
    expect(p).toMatch(/copy of the longform's project "023 - V", so don't copy/);
  });
});

describe('which conversations the shorts page can reach', () => {
  it('only its own, with names safe for a file', () => {
    expect(parseShortsJob('shorts')).toBe('shorts');
    expect(parseShortsJob('short-S07')).toBe('short-S07');
    expect(() => parseShortsJob('edit')).toThrow();
    expect(() => parseShortsJob('short-../../x')).toThrow();
    expect(() => parseShortsJob(undefined)).toThrow();
  });
});
