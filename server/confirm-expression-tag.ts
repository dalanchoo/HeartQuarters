import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex, parseTags } from './expressions.js';
import { writeFileSafely } from './files.js';

/** Confirm an existing suggestion without changing its score or any other tags. */
export function confirmExpressionTag(photoPath: string, name: string, confidence: unknown): void {
  const photo = buildExpressionIndex().photos.find(p => p.path === photoPath);
  if (!photo || !name || (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)))) throw new Error('That photo or tag is not available.');
  const sidecarPath = photoPath.slice(0, -path.extname(photoPath).length) + '.txt';
  const sidecar = safeResolve('expressions', sidecarPath);
  if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
  const text = fs.readFileSync(sidecar, 'utf8');
  const lines = text.split(/(?<=\n)/);
  const matching = lines.map((line, i) => ({ i, tag: parseTags(line)[0] })).filter(item => item.tag?.tag === name);
  if (matching.length !== 1 || matching[0].tag.confidence !== confidence) throw new Error('The tag changed since it was shown. Refresh and try again.');
  if (matching[0].tag.confirmed) return;
  const index = matching[0].i;
  if (!/UNCONFIRMED(?=\s*$)/i.test(lines[index])) throw new Error('This tag cannot be confirmed automatically.');
  lines[index] = lines[index].replace(/UNCONFIRMED(?=\s*$)/i, 'CONFIRMED');
  writeFileSafely(sidecar, lines.join(''));
  clearExpressionIndex();
}
