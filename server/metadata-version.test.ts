import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { prepareMetadataVersion } from './metadata-version';
import { makeTree, removeTree } from './testing';
let tmp: string; let previous: string;
beforeEach(() => { tmp = makeTree({ 'piece/Packaging/V04/YouTube.md': 'Title:\nExisting title\n', 'piece/Packaging/V04/Thumbnail/Thumbnail.png': 'original thumbnail', 'piece/Packaging/V05/YouTube.md': 'Title:\n\nVideo language:\nen-US\n' }); previous = config.videoProjectsDir; config.videoProjectsDir = tmp; });
afterEach(() => { config.videoProjectsDir = previous; removeTree(tmp); });
describe('metadata version preparation', () => {
  it('creates the next version and copies the selected version thumbnail without changing the source', () => {
    expect(prepareMetadataVersion('piece', 'piece/Packaging/V04')).toBe('piece/Packaging/V06');
    expect(fs.readFileSync(path.join(tmp, 'piece/Packaging/V06/Thumbnail/Thumbnail.png'), 'utf8')).toBe('original thumbnail');
    expect(fs.readFileSync(path.join(tmp, 'piece/Packaging/V04/YouTube.md'), 'utf8')).toContain('Existing title');
    expect(fs.existsSync(path.join(tmp, 'piece/Packaging/V06/YouTube.md'))).toBe(false);
  });
  it('uses a blank version in place and refuses another piece', () => {
    expect(prepareMetadataVersion('piece', 'piece/Packaging/V05')).toBe('piece/Packaging/V05');
    expect(() => prepareMetadataVersion('other', 'piece/Packaging/V04')).toThrow();
  });
});
