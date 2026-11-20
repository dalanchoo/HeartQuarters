import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex, findExpressionPhoto } from './expressions.js';
import { isAiExpression, isMotionExpression } from './expression-origin.js';
import { writeFileSafely } from './files.js';

/** The explicit Mark as AI action adds a tag while preserving the other tags. */
export function markExpressionAi(photoPath: string): void {
  const photo = findExpressionPhoto(buildExpressionIndex(), photoPath);
  if (!photo) throw new Error('That expression photo is no longer available.');
  if (isAiExpression(photo)) return;
  const image = safeResolve('expressions', photoPath);
  if (!fs.lstatSync(image).isFile()) throw new Error('The photo must be a real file, not a shortcut.');
  const sidecarPath = photoPath.slice(0, -path.extname(photoPath).length) + '.txt';
  const sidecar = safeResolve('expressions', sidecarPath);
  let existing = '';
  try {
    if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
    existing = fs.readFileSync(sidecar, 'utf8');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const separator = existing && !existing.endsWith('\n') ? newline : '';
  const updated = existing + separator + (existing ? `==========${newline}` : '') + `AIGenerated, N/A, CONFIRMED${newline}`;
  if (existing || fs.existsSync(sidecar)) writeFileSafely(sidecar, updated);
  else fs.writeFileSync(sidecar, updated, { flag: 'wx' });
  clearExpressionIndex();
}

/** Marks or unmarks an expression photo as a motion image (e.g. a video frame snapshot). */
export function setExpressionMotion(photoPath: string, motion: unknown): void {
  if (typeof motion !== 'boolean') throw new Error('Choose whether this is a motion image.');
  const photo = findExpressionPhoto(buildExpressionIndex(), photoPath);
  if (!photo) throw new Error('That expression photo is no longer available.');
  if (isMotionExpression(photo) === motion) return;
  const image = safeResolve('expressions', photoPath);
  if (!fs.lstatSync(image).isFile()) throw new Error('The photo must be a real file, not a shortcut.');
  const sidecarPath = photoPath.slice(0, -path.extname(photoPath).length) + '.txt';
  const sidecar = safeResolve('expressions', sidecarPath);
  let existing = '';
  try {
    if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
    existing = fs.readFileSync(sidecar, 'utf8');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }

  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  if (motion) {
    const separator = existing && !existing.endsWith('\n') ? newline : '';
    const updated = existing + separator + (existing ? `==========${newline}` : '') + `MotionImage, N/A, CONFIRMED${newline}`;
    if (existing || fs.existsSync(sidecar)) writeFileSafely(sidecar, updated);
    else fs.writeFileSync(sidecar, updated, { flag: 'wx' });
  } else if (existing) {
    const kept = existing
      .split(/\r?\n/)
      .filter(line => !/^MotionImage\b/i.test(line.trim()))
      .join(newline);
    writeFileSafely(sidecar, kept);
  }
  clearExpressionIndex();
}
