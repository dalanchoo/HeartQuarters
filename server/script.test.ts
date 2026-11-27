import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config.js';
import { buildDocx, readScript, saveScript, ScriptConflict } from './script.js';
import { makeTree, removeTree } from './testing.js';

let tmp: string;
let oldProjects: string;

beforeEach(() => {
  tmp = makeTree({
    'Videos/022 - Worth Telling Them/Longform/Packaging/V01/YouTube.md': '# YouTube\n',
    'Videos/999 - Shorts/2026/999-2026-01 - Quick Tip/Packaging/V01/YouTube.md': '# YouTube\n',
  });
  oldProjects = config.videoProjectsDir;
  config.videoProjectsDir = path.join(tmp, 'Videos');
});

afterEach(() => {
  config.videoProjectsDir = oldProjects;
  removeTree(tmp);
});

describe('video script reader and .docx writer', () => {
  it('suggests the video folder name when no script file exists yet, and round-trips rich HTML through .docx', async () => {
    const empty = await readScript('022 - Worth Telling Them/Longform');
    expect(empty).toEqual({
      name: '022 - Worth Telling Them - Script.docx',
      path: '022 - Worth Telling Them/Longform/022 - Worth Telling Them - Script.docx',
      exists: false,
      revision: 'missing',
      html: '',
      text: '',
    });

    const richHtml =
      '<h1>Act One</h1>' +
      '<p>Opening hook with <strong>bold</strong>, <em>italic</em>, <u>underline</u>, and <s>strike</s>.</p>' +
      '<ul><li>First key point<ul><li>Nested sub-point</li></ul></li><li>Second key point with &lt;special&gt; &amp; "quotes"</li></ul>' +
      '<ol><li>Step one</li><li>Step two</li></ol>' +
      '<blockquote>A quiet reflection.</blockquote>';

    const saved = await saveScript('022 - Worth Telling Them/Longform', { html: richHtml }, empty.revision);
    expect(saved.exists).toBe(true);
    expect(saved.name).toBe('022 - Worth Telling Them - Script.docx');
    expect(saved.html).toContain('<h1>Act One</h1>');
    expect(saved.html).toContain('<strong>bold</strong>');
    expect(saved.html).toContain('<em>italic</em>');
    expect(saved.html).toContain('<u>underline</u>');
    expect(saved.html).toContain('<s>strike</s>');
    expect(saved.html).toContain('<ul><li>First key point<ul><li>Nested sub-point</li></ul></li>');
    expect(saved.html).toContain('<ol><li>Step one</li><li>Step two</li></ol>');
    expect(saved.html).toContain('<blockquote>A quiet reflection.</blockquote>');
    expect(saved.text).toContain('- First key point\n  - Nested sub-point');
    expect(saved.text).toContain('1. Step one\n2. Step two');

    // Verify mammoth.extractRawText (used by Write Brief) reads the generated .docx cleanly.
    const full = path.join(config.videoProjectsDir, saved.path);
    const raw = await mammoth.extractRawText({ path: full });
    expect(raw.value).toContain('Opening hook with bold');
    expect(raw.value).toContain('Nested sub-point');
  });

  it('uses the standalone short folder name for standalone shorts', async () => {
    const piece = '999 - Shorts/2026/999-2026-01 - Quick Tip';
    const { revision } = await readScript(piece);
    const saved = await saveScript(piece, '- Bullet one\n- Bullet two', revision);
    expect(saved.name).toBe('999-2026-01 - Quick Tip - Script.docx');
    expect(saved.html).toContain('<ul><li>Bullet one</li><li>Bullet two</li></ul>');
    expect(saved.text).toBe('- Bullet one\n- Bullet two');
  });

  it('rejects paths outside Video Projects or folders without Packaging', async () => {
    await expect(readScript('../outside')).rejects.toThrow();
    await expect(saveScript('../outside', 'x', 'missing')).rejects.toThrow();
    await expect(readScript('022 - Worth Telling Them')).rejects.toThrow(/no Packaging folder/);
  });

  it('rejects older editors and two saves based on the same script revision', async () => {
    const piece = '022 - Worth Telling Them/Longform';
    const { revision } = await readScript(piece);
    await expect(saveScript(piece, 'Old editor', undefined)).rejects.toBeInstanceOf(ScriptConflict);
    expect((await readScript(piece)).exists).toBe(false);
    const first = await saveScript(piece, 'Original script', revision);
    const [winner, stale] = await Promise.allSettled([
      saveScript(piece, 'First update', first.revision),
      saveScript(piece, 'Stale update', first.revision),
    ]);
    expect(winner.status).toBe('fulfilled');
    expect(stale).toMatchObject({ status: 'rejected', reason: expect.any(ScriptConflict) });
    expect((await readScript(piece)).text).toBe('First update');
  });

  it('detects external changes to a text script before converting it to Word', async () => {
    const piece = '022 - Worth Telling Them/Longform';
    const source = path.join(config.videoProjectsDir, piece, 'Script.txt');
    fs.writeFileSync(source, 'First draft');
    const script = await readScript(piece);
    fs.writeFileSync(source, 'Other draft');
    await expect(saveScript(piece, 'Unsaved editor text', script.revision)).rejects.toBeInstanceOf(ScriptConflict);
    expect((await readScript(piece)).text).toBe('Other draft');
    expect(fs.existsSync(path.join(path.dirname(source), '022 - Worth Telling Them - Script.docx'))).toBe(false);
  });

  it('round-trips buildDocx through mammoth', async () => {
    const buf = buildDocx('Line 1\n* Bullet A\n• Bullet B');
    const raw = await mammoth.extractRawText({ buffer: buf });
    expect(raw.value).toContain('Line 1');
    expect(raw.value).toContain('Bullet A');
  });
});
