// The shorts plan file and making a short. Fake folders and a fake Claude only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appDir, config } from './config';
import { buildPrompt, getRun, parseShortsJob, sendNote, shortsPrompt, startShortsProposal, stopRun } from './claude';
import { system } from './manage';
import {
  checkShorts,
  hasRetention,
  keepOldPlan,
  latestExport,
  makeShort,
  readPlan,
  readTranscript,
  regenerateShort,
  retentionInfo,
  retireRetention,
  savePlan,
  saveRetention,
  shortsOverview,
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
let saved: { projects: string; drafts: string; cmd: string[] };
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
  saved = { projects: config.videoProjectsDir, drafts: config.capcutDraftsDir, cmd: config.claudeCommand };
  config.videoProjectsDir = path.join(tmp, 'Videos');
  config.capcutDraftsDir = path.join(tmp, 'Drafts');
  config.claudeCommand = [process.execPath, path.join(tmp, 'fake-claude.cjs')];
  system.isCapCutRunning = () => false;
});

afterEach(() => {
  stopRun(VIDEO, 'shorts');
  stopRun(NUMBERED, 'short-S01');
  fs.rmSync(path.join(appDir, 'data', 'claude', `${VIDEO}#shorts.json`), { force: true });
  fs.rmSync(path.join(appDir, 'data', 'claude', `${NUMBERED}#short-S01.json`), { force: true });
  system.isCapCutRunning = realCheck;
  config.videoProjectsDir = saved.projects;
  config.capcutDraftsDir = saved.drafts;
  config.claudeCommand = saved.cmd;
  removeTree(tmp);
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
    write('Claude/transcript', 'Video.words.json', words('rough'));
    expect(readTranscript(VIDEO)!.words[0].word).toBe('rough');
    write('Claude/transcript', 'Video - final.words.json', words('finished'));
    const found = readTranscript(VIDEO)!;
    expect(found.file).toBe('Video - final.words.json');
    expect(found.words).toEqual([{ start: 1, end: 2, word: 'finished' }]);
  });

  it('reads a flat list of words too', () => {
    write('Claude/transcript', 'Flat.words.json', { words: [{ start: 0, end: 1, word: 'flat' }] });
    expect(readTranscript(VIDEO)!.words[0].word).toBe('flat');
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
      fs.rmSync(path.join(appDir, 'data', 'claude', `${NUMBERED}#short-S02.json`), { force: true });
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
