// The Skills page makes and removes links in each AI's skills folder. Fake folders only.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { listSkills, readHeader, setSkillLink, targetFolder } from './skills';
import { makeTree, removeTree } from './testing';

const HEAD = (name: string, desc: string) => `---\nname: ${name}\ndescription: "${desc}"\n---\n\n# ${name}\n`;

let tmp: string;
let saved: { dir: string; targets: typeof config.skillTargets };

beforeEach(() => {
  tmp = makeTree({
    'Skills/HMF_Skills/longform-edit/SKILL.md': HEAD('longform-edit', 'Edit a longform: cut, zoom.'),
    'Skills/HMF_Skills/longform-edit/scripts/tool.py': 'print(1)',
    'Skills/HMF_Skills/notes/readme.txt': 'not a skill (no SKILL.md)',
    'Skills/Downloaded/someones-skill/SKILL.md': HEAD('someones-skill', 'Something useful.'),
    'Claude/skills/hyperframes/SKILL.md': 'installed some other way',
    'Codex/skills/': '',
    // Gemini isn't installed: no Gemini folder at all
  });
  saved = { dir: config.skillsDir, targets: config.skillTargets };
  config.skillsDir = path.join(tmp, 'Skills');
  config.skillTargets = [
    { id: 'claude', name: 'Claude Code', dir: path.join(tmp, 'Claude', 'skills') },
    { id: 'codex', name: 'Codex', dir: path.join(tmp, 'Codex', 'skills') },
    { id: 'gemini', name: 'Gemini CLI', dir: path.join(tmp, 'Gemini', 'skills') },
  ];
});

afterEach(() => {
  config.skillsDir = saved.dir;
  config.skillTargets = saved.targets;
  removeTree(tmp);
});

const skill = (id: string) => listSkills().skills.find((s) => s.id === id)!;

describe('readHeader', () => {
  it('reads plain and quoted values, including colons inside quotes', () => {
    expect(readHeader('---\nname: a\ndescription: "Do this: then that."\n---\nbody')).toEqual({
      name: 'a',
      description: 'Do this: then that.',
    });
    expect(readHeader('no header')).toEqual({});
  });
});

describe('listSkills', () => {
  it('finds my skills and downloaded ones, and only folders with a SKILL.md', () => {
    const { skills } = listSkills();
    expect(skills.map((s) => [s.id, s.group])).toEqual([
      ['HMF_Skills/longform-edit', 'mine'],
      ['Downloaded/someones-skill', 'downloaded'],
    ]);
    expect(skills[0].description).toBe('Edit a longform: cut, zoom.');
  });

  it('shows which AIs are installed and what else is in their folders', () => {
    const { targets } = listSkills();
    expect(targets.map((t) => [t.id, t.installed])).toEqual([
      ['claude', true],
      ['codex', true],
      ['gemini', false],
    ]);
    expect(targets[0].others).toEqual(['hyperframes']);
  });
});

describe('targetFolder', () => {
  it("gives the AI's skills folder, or its own folder before it has one", () => {
    expect(targetFolder('claude')).toBe(path.join(tmp, 'Claude', 'skills'));
    fs.rmdirSync(path.join(tmp, 'Codex', 'skills'));
    expect(targetFolder('codex')).toBe(path.join(tmp, 'Codex'));
  });

  it('refuses an AI that is not installed, or not in the list', () => {
    expect(() => targetFolder('gemini')).toThrow(/isn't installed/);
    expect(() => targetFolder('C:\\Windows')).toThrow(/No AI/);
  });
});

describe('setSkillLink', () => {
  it('turning a skill on makes a link to the one real copy', () => {
    expect(setSkillLink('HMF_Skills/longform-edit', 'claude', true)).toBe('on');
    const link = path.join(tmp, 'Claude', 'skills', 'longform-edit');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(link, 'scripts', 'tool.py'))).toBe(true);
    expect(skill('HMF_Skills/longform-edit').links).toEqual({ claude: 'on', codex: 'off', gemini: 'off' });
  });

  it('turning it off removes only the link, never the skill itself', () => {
    setSkillLink('HMF_Skills/longform-edit', 'codex', true);
    expect(setSkillLink('HMF_Skills/longform-edit', 'codex', false)).toBe('off');
    expect(fs.existsSync(path.join(tmp, 'Codex', 'skills', 'longform-edit'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'Skills', 'HMF_Skills', 'longform-edit', 'scripts', 'tool.py'))).toBe(true);
  });

  it('doing it twice is harmless', () => {
    setSkillLink('Downloaded/someones-skill', 'claude', true);
    expect(setSkillLink('Downloaded/someones-skill', 'claude', true)).toBe('on');
    setSkillLink('Downloaded/someones-skill', 'claude', false);
    expect(setSkillLink('Downloaded/someones-skill', 'claude', false)).toBe('off');
  });

  it('leaves a real folder of the same name alone', () => {
    fs.mkdirSync(path.join(tmp, 'Skills', 'HMF_Skills', 'hyperframes'));
    fs.writeFileSync(path.join(tmp, 'Skills', 'HMF_Skills', 'hyperframes', 'SKILL.md'), HEAD('hyperframes', 'x'));
    expect(skill('HMF_Skills/hyperframes').links.claude).toBe('other');
    expect(() => setSkillLink('HMF_Skills/hyperframes', 'claude', false)).toThrow(/Left alone/);
    expect(() => setSkillLink('HMF_Skills/hyperframes', 'claude', true)).toThrow(/Left alone/);
    expect(fs.existsSync(path.join(tmp, 'Claude', 'skills', 'hyperframes', 'SKILL.md'))).toBe(true);
  });

  it('refuses an AI that is not installed, or not in the list', () => {
    expect(() => setSkillLink('HMF_Skills/longform-edit', 'gemini', true)).toThrow(/isn't installed/);
    expect(() => setSkillLink('HMF_Skills/longform-edit', 'chatgpt', true)).toThrow(/No AI/);
  });

  it('refuses anything that is not a skill folder inside the skills folder', () => {
    expect(() => setSkillLink('../Claude/skills/hyperframes', 'codex', true)).toThrow();
    expect(() => setSkillLink('HMF_Skills/notes', 'codex', true)).toThrow(/no SKILL.md/);
    expect(() => setSkillLink('HMF_Skills/longform-edit/scripts', 'codex', true)).toThrow(/isn't a skill/);
    expect(() => setSkillLink('Elsewhere/longform-edit', 'codex', true)).toThrow(/isn't a skill/);
    expect(fs.readdirSync(path.join(tmp, 'Codex', 'skills'))).toEqual([]);
  });
});

describe('an AI that reads a list file instead of links (Antigravity)', () => {
  let listFile: string;
  const read = () => JSON.parse(fs.readFileSync(listFile, 'utf8'));
  const mine = () => path.join(tmp, 'Skills', 'HMF_Skills').replace(/\\/g, '/');

  beforeEach(() => {
    fs.mkdirSync(path.join(tmp, 'Antigravity', 'config'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'Skills', 'HMF_Skills', 'thumbnails'));
    fs.writeFileSync(path.join(tmp, 'Skills', 'HMF_Skills', 'thumbnails', 'SKILL.md'), HEAD('thumbnails', 'x'));
    listFile = path.join(tmp, 'Antigravity', 'config', 'skills.json');
    config.skillTargets = [{ id: 'agy', name: 'Gemini (Antigravity)', dir: path.join(tmp, 'Antigravity', 'config'), listFile }];
  });

  it('turning a skill on adds it to the list, without making a link', () => {
    expect(skill('HMF_Skills/longform-edit').links.agy).toBe('off');
    expect(setSkillLink('HMF_Skills/longform-edit', 'agy', true)).toBe('on');
    expect(read()).toEqual({ entries: [{ path: mine(), include_only: ['longform-edit'] }] });
    expect(fs.readdirSync(path.join(tmp, 'Antigravity', 'config'))).toEqual(['skills.json']);
    expect(skill('HMF_Skills/longform-edit').links.agy).toBe('on');
    expect(skill('HMF_Skills/thumbnails').links.agy).toBe('off');
    expect(setSkillLink('HMF_Skills/longform-edit', 'agy', true)).toBe('on'); // twice is harmless
    expect(read().entries[0].include_only).toEqual(['longform-edit']);
  });

  it('turning the last one off removes its entry and keeps the rest of the file', () => {
    fs.writeFileSync(listFile, JSON.stringify({ inherits: [{ path: '~/team.json' }], entries: [{ path: '~/elsewhere' }] }));
    setSkillLink('Downloaded/someones-skill', 'agy', true);
    expect(setSkillLink('Downloaded/someones-skill', 'agy', false)).toBe('off');
    expect(read()).toEqual({ inherits: [{ path: '~/team.json' }], entries: [{ path: '~/elsewhere' }] });
    expect(listSkills().targets[0].others).toEqual(['~/elsewhere']);
  });

  it('an entry for the whole folder counts every skill in it; turning one off keeps the others', () => {
    fs.writeFileSync(listFile, JSON.stringify({ entries: [{ path: path.join(tmp, 'Skills', 'HMF_Skills').toUpperCase() }] }));
    expect(skill('HMF_Skills/thumbnails').links.agy).toBe('on');
    expect(setSkillLink('HMF_Skills/longform-edit', 'agy', false)).toBe('off');
    expect(read().entries[0].include_only).toEqual(['thumbnails']);
    expect(skill('HMF_Skills/thumbnails').links.agy).toBe('on');
  });

  it('a list it cannot read is shown as other and left alone', () => {
    fs.writeFileSync(listFile, 'not json');
    expect(skill('HMF_Skills/longform-edit').links.agy).toBe('other');
    expect(() => setSkillLink('HMF_Skills/longform-edit', 'agy', true)).toThrow(/Left alone/);
    expect(fs.readFileSync(listFile, 'utf8')).toBe('not json');
  });

  it('refuses when the AI is not installed', () => {
    removeTree(path.join(tmp, 'Antigravity'));
    expect(() => setSkillLink('HMF_Skills/longform-edit', 'agy', true)).toThrow(/isn't installed/);
    expect(fs.existsSync(listFile)).toBe(false);
  });
});
