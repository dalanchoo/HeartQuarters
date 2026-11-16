import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex } from './expressions.js';
import { isAiExpression } from './expression-origin.js';
import { writeFileSafely } from './files.js';

/** The explicit Mark as AI action adds a tag while preserving the other tags. */
export function markExpressionAi(photoPath: string): void {
  const photo = buildExpressionIndex().photos.find(p => p.path === photoPath);
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
