// Finishing a preview: file errors become a refused preview, never an error that stops the server. Fake folders only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from './testing';
import { finishPreview, previewScaleFilter, thumbnail } from './thumbs';

let tmp: string;
beforeEach(() => {
  tmp = makeTree({ 'cache/made.tmp.jpg': 'jpeg', 'cache/blocked.jpg/keep.txt': 'a folder sits where the preview would go' });
});
afterEach(() => removeTree(tmp));

function jpegDimensions(file: string): { width: number; height: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], { encoding: 'utf8' }).trim();
  const [width, height] = out.split('x').map(Number);
  return { width, height };
}

describe('finishing a preview', () => {
  it('moves a finished preview into place', () => {
    const out = path.join(tmp, 'cache', 'made.jpg');
    expect(finishPreview(0, path.join(tmp, 'cache', 'made.tmp.jpg'), out, '')).toBe(out);
    expect(fs.readFileSync(out, 'utf8')).toBe('jpeg');
  });
  it('throws, and cleans up, when the preview cannot be saved', () => {
    const made = path.join(tmp, 'cache', 'made.tmp.jpg');
    expect(() => finishPreview(0, made, path.join(tmp, 'cache', 'blocked.jpg'), '')).toThrow(/Couldn't save the preview/);
    expect(fs.existsSync(made)).toBe(false);
  });
  it('explains an FFmpeg failure', () => {
    expect(() => finishPreview(1, path.join(tmp, 'cache', 'none.tmp.jpg'), path.join(tmp, 'cache', 'x.jpg'), 'bad input')).toThrow(/bad input/);
  });
});

describe('preview scaling', () => {
  it('scales by the shorter side with Lanczos without upscaling', () => {
    expect(previewScaleFilter(360)).toContain('flags=lanczos');
    expect(previewScaleFilter(360)).toContain('min(iw,360)');
    expect(previewScaleFilter(360)).toContain('min(ih,360)');
  });

  it('keeps the shorter side at the requested size for both landscape and portrait photos', async () => {
    const landscape = path.join(tmp, 'landscape.png');
    const portrait = path.join(tmp, 'portrait.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1600x900', '-frames:v', '1', landscape]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=900x1600', '-frames:v', '1', portrait]);

    const made: string[] = [];
    try {
      const landThumb = await thumbnail(landscape, 360);
      made.push(landThumb);
      expect(jpegDimensions(landThumb)).toEqual({ width: 640, height: 360 });

      const portThumb = await thumbnail(portrait, 360);
      made.push(portThumb);
      expect(jpegDimensions(portThumb)).toEqual({ width: 360, height: 640 });
    } finally {
      for (const file of made) fs.rmSync(file, { force: true });
    }
  });
});
