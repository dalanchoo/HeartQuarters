import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { confirmExpressionTag } from './confirm-expression-tag';
import { makeTree, removeTree } from './testing';

let tmp: string; let original: string;
beforeEach(() => { tmp = makeTree({ 'Joy/Joy_001.jpg': 'photo', 'Joy/Joy_001.txt': 'Smile, 88%, UNCONFIRMED\r\nEyesWide: 72, UNCONFIRMED\r\nJoy, N/A, CONFIRMED\r\n' }); original = config.expressionsDir; config.expressionsDir = tmp; });
afterEach(() => { config.expressionsDir = original; removeTree(tmp); });
describe('confirming expression tags', () => {
  it('confirms one tag without changing its score, line endings or other tags', () => {
    confirmExpressionTag('Joy/Joy_001.jpg', 'Smile', 88);
    confirmExpressionTag('Joy/Joy_001.jpg', 'EyesWide', 72);
    expect(fs.readFileSync(path.join(tmp, 'Joy/Joy_001.txt'), 'utf8')).toBe('Smile, 88%, CONFIRMED\r\nEyesWide: 72, CONFIRMED\r\nJoy, N/A, CONFIRMED\r\n');
  });
  it('refuses stale confidence, ambiguous tags and paths outside the library', () => {
    expect(() => confirmExpressionTag('Joy/Joy_001.jpg', 'Smile', 85)).toThrow(/changed/);
    expect(() => confirmExpressionTag('../outside.jpg', 'Smile', 88)).toThrow();
    fs.appendFileSync(path.join(tmp, 'Joy/Joy_001.txt'), 'Smile, 88%, UNCONFIRMED\r\n');
    expect(() => confirmExpressionTag('Joy/Joy_001.jpg', 'Smile', 88)).toThrow(/changed/);
  });
});
