import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { addExpressionTag, confirmExpressionTag, removeExpressionTag } from './confirm-expression-tag';
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
  it('removes only the chosen tag and refuses stale changes', () => {
    expect(() => removeExpressionTag('Joy/Joy_001.jpg', 'Smile', 88, true)).toThrow(/changed/);
    removeExpressionTag('Joy/Joy_001.jpg', 'Smile', 88, false);
    expect(fs.readFileSync(path.join(tmp, 'Joy/Joy_001.txt'), 'utf8')).toBe('EyesWide: 72, UNCONFIRMED\r\nJoy, N/A, CONFIRMED\r\n');
    removeExpressionTag('Joy/Joy_001.jpg', 'Joy', null, true);
    expect(fs.readFileSync(path.join(tmp, 'Joy/Joy_001.txt'), 'utf8')).toBe('EyesWide: 72, UNCONFIRMED\r\n');
  });
  it('adds an existing expression as confirmed and rejects duplicates or invented values', () => {
    fs.mkdirSync(path.join(tmp, 'Calm'));
    addExpressionTag('Joy/Joy_001.jpg', 'calm');
    expect(fs.readFileSync(path.join(tmp, 'Joy/Joy_001.txt'), 'utf8')).toContain('Calm, N/A, CONFIRMED\r\n');
    expect(() => addExpressionTag('Joy/Joy_001.jpg', 'Calm')).toThrow(/already/);
    expect(() => addExpressionTag('Joy/Joy_001.jpg', 'unknown')).toThrow(/existing attribute/);
    expect(() => addExpressionTag('../outside.jpg', 'Calm')).toThrow();
  });
  it('creates a sidecar when adding an expression to a photo without one', () => {
    fs.writeFileSync(path.join(tmp, 'Joy/Joy_002.jpg'), 'photo');
    addExpressionTag('Joy/Joy_002.jpg', 'Joy');
    expect(fs.readFileSync(path.join(tmp, 'Joy/Joy_002.txt'), 'utf8')).toBe('Joy, N/A, CONFIRMED\n');
  });
  it('adds framing, pose and morphology from the matching vocabulary as confirmed', () => {
    addExpressionTag('Joy/Joy_001.jpg', 'closeup', 'framing');
    addExpressionTag('Joy/Joy_001.jpg', 'LookAtCamera', 'pose');
    addExpressionTag('Joy/Joy_001.jpg', 'FurrowedBrow', 'morphology');
    const text = fs.readFileSync(path.join(tmp, 'Joy/Joy_001.txt'), 'utf8');
    expect(text).toContain('CloseUp, N/A, CONFIRMED\r\n');
    expect(text).toContain('LookAtCamera, N/A, CONFIRMED\r\n');
    expect(text).toContain('FurrowedBrow, N/A, CONFIRMED\r\n');
    expect(() => addExpressionTag('Joy/Joy_001.jpg', 'Frontal', 'morphology')).toThrow(/selected group/);
    expect(() => addExpressionTag('Joy/Joy_001.jpg', 'LookUp', 'framing')).toThrow(/selected group/);
    expect(() => addExpressionTag('Joy/Joy_001.jpg', 'Smile', 'morphology')).toThrow(/already/);
    expect(() => addExpressionTag('Joy/Joy_001.jpg', 'CloseUp', 'unknown')).toThrow(/selected group/);
  });
});
