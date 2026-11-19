import path from 'node:path';
import mammoth from 'mammoth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config.js';
import { buildDocx, readScript, saveScript } from './script.js';
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
  it('suggests the video folder name when no script file exists yet, and saves a valid .docx file', async () => {
    const empty = await readScript('022 - Worth Telling Them/Longform');
    expect(empty).toEqual({
      name: '022 - Worth Telling Them - Script.docx',
      path: '022 - Worth Telling Them/Longform/022 - Worth Telling Them - Script.docx',
      exists: false,
      text: '',
    });

    const scriptText = 'Opening hook about telling the truth.\n\n- First key point\n- Second key point with <special> & "quotes"\n\nClosing thought.';
    const saved = await saveScript('022 - Worth Telling Them/Longform', scriptText);
    expect(saved.exists).toBe(true);
    expect(saved.name).toBe('022 - Worth Telling Them - Script.docx');
    expect(saved.text).toBe(scriptText);

    // Verify mammoth (used by Write Brief and Google Docs / Word compatibility) reads the generated .docx cleanly.
    const full = path.join(config.videoProjectsDir, saved.path);
    const raw = await mammoth.extractRawText({ path: full });
    expect(raw.value).toContain('Opening hook about telling the truth.');
    expect(raw.value).toContain('First key point');
    const html = await mammoth.convertToHtml({ path: full });
    expect(html.value).toContain('<ul><li>First key point</li><li>Second key point with &lt;special&gt; &amp; "quotes"</li></ul>');
  });

  it('uses the standalone short folder name for standalone shorts', async () => {
    const saved = await saveScript('999 - Shorts/2026/999-2026-01 - Quick Tip', '- Bullet one\n- Bullet two');
    expect(saved.name).toBe('999-2026-01 - Quick Tip - Script.docx');
    expect(saved.text).toBe('- Bullet one\n- Bullet two');
  });

  it('rejects paths outside Video Projects or folders without Packaging', async () => {
    await expect(readScript('../outside')).rejects.toThrow();
    await expect(saveScript('../outside', 'x')).rejects.toThrow();
    await expect(readScript('022 - Worth Telling Them')).rejects.toThrow(/no Packaging folder/);
  });

  it('round-trips buildDocx through readScript', async () => {
    const buf = buildDocx('Line 1\n* Bullet A\n• Bullet B');
    const raw = await mammoth.extractRawText({ buffer: buf });
    expect(raw.value).toContain('Line 1');
    expect(raw.value).toContain('Bullet A');
  });
});
