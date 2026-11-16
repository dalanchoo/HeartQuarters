import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config';
import { applySidecarCleanup, planSidecarCleanup } from './expression-sidecar-cleanup';
import { makeTree, removeTree } from './testing';

let tmp: string; let original: { expressions: string; trash: string };
const photo = 'Fear/Fear_001_Miranda_Sneeze.png';
const alias = { [photo]: 'Fear_001' };
beforeEach(() => {
  tmp = makeTree({
    'Expressions/Fear/Fear_001_Miranda_Sneeze.png': 'photo',
    'Expressions/Fear/Fear_001.txt': 'Confidence: N/A, CONFIRMED\nCloseUp: 60, UNCONFIRMED\n',
    'Expressions/Fear/Fear_001_GPT-5.5_Light.txt': 'Fear, 80%, UNCONFIRMED\nCloseUp, 90%, UNCONFIRMED\n',
    'Expressions/Fear/Fear_001_Sonnet_5_Med_OLD_UNBLINDED.txt': 'Fear, 99%, UNCONFIRMED\nStanding, 70%, UNCONFIRMED\n',
    'Expressions/Fear/Fear_001_QWEN.txt': 'other model',
    'Expressions/Fear/Fear.txt': 'definition',
  });
  original = { expressions: config.expressionsDir, trash: config.trashDir };
  config.expressionsDir = path.join(tmp, 'Expressions'); config.trashDir = path.join(tmp, 'Trash');
});
afterEach(() => { config.expressionsDir = original.expressions; config.trashDir = original.trash; removeTree(tmp); });

describe('expression sidecar cleanup', () => {
  it('backs up every original, uses the renamed-photo alias and archives model files', () => {
    const plan = planSidecarCleanup(alias);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].result).toContain('Fear, 80%, UNCONFIRMED');
    expect(plan.rows[0].result).toContain('Confidence, N/A, CONFIRMED');
    expect(plan.rows[0].result).toContain('Standing, 70%, UNCONFIRMED');
    expect(plan.rows[0].result).toContain('CloseUp, 90%, UNCONFIRMED');
    const result = applySidecarCleanup(alias, plan.token);
    const folder = path.join(tmp, 'Expressions/Fear');
    expect(fs.readdirSync(folder).sort()).toEqual(['Fear.txt', 'Fear_001_Miranda_Sneeze.png', 'Fear_001_Miranda_Sneeze.txt']);
    expect(fs.readFileSync(path.join(result.backup, 'Originals/Fear/Fear_001.txt'), 'utf8')).toContain('CONFIRMED');
    expect(fs.readFileSync(path.join(result.backup, 'Archived Model Sidecars/Fear/Fear_001_QWEN.txt'), 'utf8')).toBe('other model');
    expect(fs.readFileSync(path.join(folder, 'Fear_001_Miranda_Sneeze.txt'), 'utf8')).toBe(plan.rows[0].result);
    expect(fs.readFileSync(path.join(folder, 'Fear_001_Miranda_Sneeze.png'), 'utf8')).toBe('photo');
  });
  it('refuses a changed file between preview and apply', () => {
    const plan = planSidecarCleanup(alias);
    const file = path.join(tmp, 'Expressions/Fear/Fear_001.txt'); fs.appendFileSync(file, 'extra');
    expect(() => applySidecarCleanup(alias, plan.token)).toThrow();
    expect(fs.existsSync(path.join(tmp, 'Expressions/Fear/Fear_001_GPT-5.5_Light.txt'))).toBe(true);
  });
  it('rejects invalid aliases and a trash folder inside the library', () => {
    expect(() => planSidecarCleanup({ [photo]: '../bad' })).toThrow();
    const plan = planSidecarCleanup(alias); config.trashDir = path.join(config.expressionsDir, 'trash');
    expect(() => applySidecarCleanup(alias, plan.token)).toThrow(/outside/);
  });
  it('rolls back changes if an archive move fails', () => {
    const plan = planSidecarCleanup(alias);
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).endsWith('_GPT-5.5_Light.txt')) throw new Error('simulated move failure');
      return rename(from, to);
    });
    try { expect(() => applySidecarCleanup(alias, plan.token)).toThrow(/rolled back/); }
    finally { spy.mockRestore(); }
    const folder = path.join(tmp, 'Expressions/Fear');
    expect(fs.existsSync(path.join(folder, 'Fear_001_Miranda_Sneeze.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(folder, 'Fear_001.txt'), 'utf8')).toContain('CONFIRMED');
    expect(fs.existsSync(path.join(folder, 'Fear_001_GPT-5.5_Light.txt'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'Fear_001_QWEN.txt'))).toBe(true);
  });
  it('can leave photos with conflicting GPT scores untouched for review', () => {
    fs.appendFileSync(path.join(tmp, 'Expressions/Fear/Fear_001_GPT-5.5_Light.txt'), 'Fear, 95%, UNCONFIRMED\n');
    const plan = planSidecarCleanup(alias, 'review');
    expect(plan.rows).toHaveLength(0);
    expect(plan.skipped).toEqual([photo]);
    expect(fs.existsSync(path.join(tmp, 'Expressions/Fear/Fear_001_GPT-5.5_Light.txt'))).toBe(true);
  });
});
