import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { setExpressionRating } from './expression-rating';
import { buildExpressionIndex, inboxExpressionPhotos, parseRating } from './expressions';
import { mergeAssessment } from './expression-assessment';
import { makeTree, removeTree } from './testing';

let tmp: string; let original: string;
beforeEach(() => {
  tmp = makeTree({ 'Joy/Joy_001.jpg': 'photo', 'Joy/Joy_001.txt': 'Smile, 88%, UNCONFIRMED\r\nJoy, N/A, CONFIRMED\r\n# Motion: No\r\n', 'Joy/Joy_002.jpg': 'photo', '_Inbox/New.jpg': 'photo' });
  original = config.expressionsDir; config.expressionsDir = tmp;
});
afterEach(() => { config.expressionsDir = original; removeTree(tmp); });
const sidecar = (name: string) => path.join(tmp, name);
const TAGS = 'Smile, 88%, UNCONFIRMED\r\nJoy, N/A, CONFIRMED\r\n# Motion: No\r\n';

describe('expression ratings', () => {
  it('adds, switches and removes the rating line without touching tags or line endings', () => {
    setExpressionRating('Joy/Joy_001.jpg', 'liked');
    expect(fs.readFileSync(sidecar('Joy/Joy_001.txt'), 'utf8')).toBe(`${TAGS}# Rating: Liked\r\n`);
    setExpressionRating('Joy/Joy_001.jpg', 'disliked');
    expect(fs.readFileSync(sidecar('Joy/Joy_001.txt'), 'utf8')).toBe(`${TAGS}# Rating: Disliked\r\n`);
    setExpressionRating('Joy/Joy_001.jpg', 'meh');
    expect(fs.readFileSync(sidecar('Joy/Joy_001.txt'), 'utf8')).toBe(`${TAGS}# Rating: Meh\r\n`);
    expect(buildExpressionIndex().photos.find(p => p.path === 'Joy/Joy_001.jpg')!.rating).toBe('meh');
    setExpressionRating('Joy/Joy_001.jpg', null);
    expect(fs.readFileSync(sidecar('Joy/Joy_001.txt'), 'utf8')).toBe(TAGS);
  });
  it('creates a sidecar when there is none, and works in the inbox', () => {
    setExpressionRating('Joy/Joy_002.jpg', 'liked');
    expect(fs.readFileSync(sidecar('Joy/Joy_002.txt'), 'utf8')).toBe('# Rating: Liked\n');
    setExpressionRating('_Inbox/New.jpg', 'disliked');
    expect(inboxExpressionPhotos()[0].rating).toBe('disliked');
  });
  it('shows the rating in the library and keeps it out of the tags', () => {
    setExpressionRating('Joy/Joy_001.jpg', 'liked');
    const photo = buildExpressionIndex().photos.find(p => p.path === 'Joy/Joy_001.jpg')!;
    expect(photo.rating).toBe('liked');
    expect(photo.tags.map(t => t.tag)).toEqual(['Smile', 'Joy']);
    expect(buildExpressionIndex().photos.find(p => p.path === 'Joy/Joy_002.jpg')!.rating).toBeUndefined();
  });
  it('survives an AI reassessment', () => {
    const merged = mergeAssessment('Smile, 88%, UNCONFIRMED\n# Rating: Liked\n', [], []);
    expect(parseRating(merged)).toBe('liked');
  });
  it('refuses unknown ratings and paths outside the library', () => {
    expect(() => setExpressionRating('Joy/Joy_001.jpg', 'love')).toThrow();
    expect(() => setExpressionRating('../outside.jpg', 'liked')).toThrow();
    expect(() => setExpressionRating('Joy/Missing.jpg', 'liked')).toThrow();
  });
});

describe('the kept library list after a rating', () => {
  it('updates the photo in place without re-reading the library', async () => {
    const { clearExpressionIndex, expressionIndex } = await import('./expressions');
    clearExpressionIndex();
    const before = expressionIndex();
    setExpressionRating('Joy/Joy_001.jpg', 'meh');
    const after = expressionIndex();
    expect(after.photos.find(p => p.path === 'Joy/Joy_001.jpg')!.rating).toBe('meh');
    expect(after.categories).toBe(before.categories); // the same list, patched, not rebuilt
    setExpressionRating('Joy/Joy_001.jpg', null);
    expect(expressionIndex().photos.find(p => p.path === 'Joy/Joy_001.jpg')!.rating).toBeUndefined();
  });
});
