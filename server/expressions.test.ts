// Reading the Expressions library: categories, photos, tag files.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from './config';
import { buildExpressionIndex, parseTags } from './expressions';
import { makeTree, removeTree } from './testing';

describe('parseTags', () => {
  it('reads confidence and confirmed status', () => {
    expect(parseTags('Joy, 82%, UNCONFIRMED\r\nWarmth, N/A, CONFIRMED\n\n')).toEqual([
      { tag: 'Joy', confidence: 82, confirmed: false },
      { tag: 'Warmth', confidence: null, confirmed: true },
    ]);
  });

  it('ignores blank or malformed lines', () => {
    expect(parseTags('\n  \nJustAWord\n, 50%, CONFIRMED')).toEqual([]);
  });
});

describe('buildExpressionIndex', () => {
  let tmp: string;
  let original: string;

  beforeAll(() => {
    tmp = makeTree({
      '_INSTRUCTIONS.txt': 'not a category',
      'populate.py': '',
      '_blind_pending/QWEN/abc.jpg': 'skip me',
      'Positive/Positive.txt': 'Good-feeling states.',
      'Positive/Joy/Joy.txt': 'Happiness.',
      'Positive/Joy/_Joy.png': 'reference',
      'Positive/Joy/Joy_001.jpg': 'photo',
      'Positive/Joy/Joy_001.txt': 'Joy, 90%, CONFIRMED',
      'Positive/Joy/Joy_001_GPT-5.5_Light.txt': 'Sad, 10%, UNCONFIRMED',
      'Positive/Joy/Joy_002.webp': 'photo',
      'Positive/Warmth/Warmth_001.png': 'photo',
    });
    original = config.expressionsDir;
    config.expressionsDir = tmp;
  });

  afterAll(() => {
    config.expressionsDir = original;
    removeTree(tmp);
  });

  it('finds photos, skipping reference images and _ folders', () => {
    const index = buildExpressionIndex();
    expect(index.photos.map((p) => p.path)).toEqual([
      'Positive/Joy/Joy_001.jpg',
      'Positive/Joy/Joy_002.webp',
      'Positive/Warmth/Warmth_001.png',
    ]);
  });

  it('uses only the matching tag file, not other AI guesses', () => {
    const joy1 = buildExpressionIndex().photos.find((p) => p.name === 'Joy_001')!;
    expect(joy1.tags).toEqual([{ tag: 'Joy', confidence: 90, confirmed: true }]);
  });

  it('builds categories with definitions, reference images and counts', () => {
    const cats = new Map(buildExpressionIndex().categories.map((c) => [c.path, c]));
    expect(cats.has('_blind_pending')).toBe(false);
    expect(cats.get('Positive')).toMatchObject({ definition: 'Good-feeling states.', ownCount: 0, totalCount: 3 });
    expect(cats.get('Positive/Joy')).toMatchObject({
      parent: 'Positive',
      reference: 'Positive/Joy/_Joy.png',
      ownCount: 2,
      totalCount: 2,
    });
    expect(cats.get('')?.totalCount).toBe(3);
  });
});
