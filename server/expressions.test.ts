// Reading the Expressions library: categories, photos, tag files.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { buildExpressionIndex, expressionCategories, isExpressionPhoto, parseMotion, parseTags, withMotionLine } from './expressions';
import { makeTree, removeTree } from './testing';

describe('parseTags', () => {
  it('reads confidence and confirmed status', () => {
    expect(parseTags('Joy, 82%, UNCONFIRMED\r\nWarmth, N/A, CONFIRMED\n\n')).toEqual([
      { tag: 'Joy', confidence: 82, confirmed: false },
      { tag: 'Warmth', confidence: null, confirmed: true },
    ]);
  });

  it('reads model scores without changing legacy tags', () => {
    expect(parseTags('Smile, 90%, UNCONFIRMED, claude=90%, codex=80%, gemini=76%')).toEqual([{ tag: 'Smile', confidence: 90, confirmed: false, assessments: { claude: 90, codex: 80, gemini: 76 } }]);
  });
  it('ignores blank or malformed lines', () => {
    expect(parseTags('\n  \nJustAWord\n, 50%, CONFIRMED')).toEqual([]);
  });
  it('reads older colon-separated tags and confirmations', () => {
    expect(parseTags('EyesClosed: N/A, CONFIRMED\nFrontal: 92, UNCONFIRMED')).toEqual([
      { tag: 'EyesClosed', confidence: null, confirmed: true },
      { tag: 'Frontal', confidence: 92, confirmed: false },
    ]);
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

  it('lists the categories with the same counts but no photos, for a fast first screen', () => {
    const quick = expressionCategories();
    const full = buildExpressionIndex();
    expect(quick.photos).toEqual([]);
    expect(quick.categories).toEqual(full.categories);
  });

  it('changes the image revision when a different photo takes the same filename', () => {
    const file = path.join(tmp, 'Positive/Joy/Joy_002.webp');
    const before = buildExpressionIndex().photos.find(p => p.path === 'Positive/Joy/Joy_002.webp')!.revision;
    fs.writeFileSync(file, 'a different image with a different length');
    const after = buildExpressionIndex().photos.find(p => p.path === 'Positive/Joy/Joy_002.webp')!.revision;
    expect(before).toBeTruthy(); expect(after).toBeTruthy(); expect(after).not.toBe(before);
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

  it('recognizes photos as assessed by all three AIs only when all three have a date', () => {
    const t = makeTree({
      'Positive/Joy/Joy_001.jpg': 'a',
      'Positive/Joy/Joy_001.txt': 'Joy, 90%, CONFIRMED\n# Assessed: claude=2026-11-20, codex=2026-11-24, gemini=2026-11-28\n',
      'Positive/Joy/Joy_002.jpg': 'b',
      'Positive/Joy/Joy_002.txt': 'Joy, 85%, UNCONFIRMED, claude=85%, codex=80%\n# Assessed: claude=2026-11-20, codex=2026-11-28\n',
      'Positive/Joy/Joy_003.jpg': 'c',
      'Positive/Joy/Joy_003.txt': 'Joy, 55%, UNCONFIRMED\n# AssessedWithAllThreeAIs\n',
    });
    const prev = config.expressionsDir;
    config.expressionsDir = t;
    try {
      const photos = buildExpressionIndex().photos;
      expect(photos.find((p) => p.name === 'Joy_001')?.assessedByThreeAIs).toBe(true);
      expect(photos.find((p) => p.name === 'Joy_001')?.tags).toHaveLength(1);
      expect(photos.find((p) => p.name === 'Joy_002')?.assessedByThreeAIs).toBeUndefined();
      expect(photos.find((p) => p.name === 'Joy_002')?.assessedAt).toEqual({ claude: '2026-11-20', codex: '2026-11-28' });
      expect(photos.find((p) => p.name === 'Joy_003')?.assessedByThreeAIs).toBeUndefined();
      expect(photos.find((p) => p.name === 'Joy_003')?.assessedAt).toBeUndefined();
    } finally {
      config.expressionsDir = prev;
      removeTree(t);
    }
  });

  it('detects embedded Google/Android Motion Photo headers automatically', () => {
    const t = makeTree({
      'Positive/Joy/Joy_001.jpg': 'fake-jpeg<x:xmpmeta GCamera:MotionPhoto="1">...</x:xmpmeta>',
      'Positive/Joy/Joy_002.jpg': 'plain-jpeg-bytes',
    });
    const prev = config.expressionsDir;
    config.expressionsDir = t;
    try {
      const photos = buildExpressionIndex().photos;
      expect(photos.find((p) => p.name === 'Joy_001')?.motionPhoto).toBe(true);
      expect(photos.find((p) => p.name === 'Joy_002')?.motionPhoto).toBeUndefined();
    } finally {
      config.expressionsDir = prev;
      removeTree(t);
    }
  });
});

describe('looking up one photo without scanning the library (code review #8)', () => {
  let tmp: string;
  let old: string;
  beforeAll(() => {
    tmp = makeTree({
      'Lib/Positive/Joy/Joy_001.jpg': 'x',
      'Lib/Positive/Joy/_Joy.png': 'reference picture',
      'Lib/Positive/Joy/notes.txt': 'not a photo',
      'Lib/_Archive/Old/Old_001.jpg': 'x',
      'Lib/Top.jpg': 'not in a category',
    });
    old = config.expressionsDir;
    config.expressionsDir = path.join(tmp, 'Lib');
  });
  afterAll(() => {
    config.expressionsDir = old;
    removeTree(tmp);
  });
  it('agrees with the library list on which files are photos', () => {
    const listed = new Set(buildExpressionIndex().photos.map((p) => p.path));
    for (const p of ['Positive/Joy/Joy_001.jpg', 'Positive/Joy/_Joy.png', 'Positive/Joy/notes.txt', '_Archive/Old/Old_001.jpg', 'Top.jpg', 'Positive/Joy/Missing.jpg']) {
      expect(isExpressionPhoto(p)).toBe(listed.has(p));
    }
    expect(isExpressionPhoto('Positive/Joy/Joy_001.jpg')).toBe(true);
  });
  it('refuses paths outside the library and backslash bypasses to _-prefixed files', () => {
    expect(isExpressionPhoto('../outside.jpg')).toBe(false);
    expect(isExpressionPhoto('Positive/../../x.jpg')).toBe(false);
    expect(isExpressionPhoto('Positive/Joy\\_Joy.png')).toBe(false);
    expect(isExpressionPhoto('Positive\\Joy\\Joy_001.jpg')).toBe(false);
    expect(isExpressionPhoto('')).toBe(false);
  });
});

describe('the Motion line in a tag file', () => {
  it('reads Yes and No, and nothing when there is no line', () => {
    expect(parseMotion('Joy, 80%, CONFIRMED\n# Motion: Yes\n')).toBe(true);
    expect(parseMotion('# motion:   No\r\n')).toBe(false);
    expect(parseMotion('Joy, 80%, CONFIRMED\n')).toBeUndefined();
  });
  it('adds or replaces only that line and keeps the line endings', () => {
    expect(withMotionLine('Joy, 80%, CONFIRMED\r\n# Rating: Liked\r\n', true)).toBe('Joy, 80%, CONFIRMED\r\n# Rating: Liked\r\n# Motion: Yes\r\n');
    expect(withMotionLine('Joy, 80%, CONFIRMED\n# Motion: Yes\n', false)).toBe('Joy, 80%, CONFIRMED\n# Motion: No\n');
    expect(withMotionLine('', false)).toBe('# Motion: No\n');
  });
  it('is not mistaken for a tag', () => {
    expect(parseTags('Joy, 80%, CONFIRMED\n# Motion: Yes\n')).toHaveLength(1);
  });
  it('is worked out once from the photo, written to its tag file, and then read from there', () => {
    const dir = makeTree({ 'Joy/Joy_001.jpg': 'GCamera:MotionPhoto="1"', 'Joy/Joy_001.txt': 'Joy, 80%, CONFIRMED\n', 'Joy/Joy_002.jpg': 'plain', 'Joy/Joy_002.txt': 'Joy, 70%, CONFIRMED\n', 'Joy/Joy_003.png': 'png' });
    const saved = config.expressionsDir; config.expressionsDir = dir;
    try {
      const photos = buildExpressionIndex().photos;
      expect(photos.filter(p => p.motionPhoto).map(p => p.path)).toEqual(['Joy/Joy_001.jpg']);
      expect(fs.readFileSync(path.join(dir, 'Joy/Joy_001.txt'), 'utf8')).toBe('Joy, 80%, CONFIRMED\n# Motion: Yes\n');
      expect(fs.readFileSync(path.join(dir, 'Joy/Joy_002.txt'), 'utf8')).toBe('Joy, 70%, CONFIRMED\n# Motion: No\n');
      expect(fs.existsSync(path.join(dir, 'Joy/Joy_003.txt'))).toBe(false);
      // The saved answer wins over the photo from now on, so the photo is not opened again.
      fs.writeFileSync(path.join(dir, 'Joy/Joy_002.txt'), 'Joy, 70%, CONFIRMED\n# Motion: Yes\n');
      expect(buildExpressionIndex().photos.find(p => p.path === 'Joy/Joy_002.jpg')?.motionPhoto).toBe(true);
    } finally { config.expressionsDir = saved; removeTree(dir); }
  });
});
