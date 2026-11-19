import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { buildExpressionIndex, clearExpressionIndex, EXPRESSION_INBOX, findExpressionPhoto, parseTags } from './expressions.js';
import { fileInboxPhoto } from './expression-inbox.js';
import { applyExpressionChange, previewExpressionChange } from './expression-manage.js';
import { writeFileSafely } from './files.js';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from './expression-attribute-vocabulary.js';

/** Confirm one folder expression, moving the photo and renumbering its old folder as one operation. */
export function confirmExpressionFolder(photoPath: string, name: string, confidence: unknown): { path: string } {
  const index = buildExpressionIndex(); const photo = findExpressionPhoto(index, photoPath);
  if (!photo || !name || (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)))) throw new Error('That photo or expression is not available.');
  const parents = new Set(index.categories.map(c => c.parent));
  const named = index.categories.filter(c => c.path && c.name.toLowerCase() === name.toLowerCase());
  const leaves = named.filter(c => !parents.has(c.path));
  const destinations = leaves.length ? leaves : named;
  if (destinations.length !== 1) throw new Error('Could not identify one destination folder for this expression. Nothing was changed.');
  const sidecar = safeResolve('expressions', photoPath.slice(0, -path.extname(photoPath).length) + '.txt');
  if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file.');
  const before = fs.readFileSync(sidecar, 'utf8'); const lines = before.split(/(?<=\n)/);
  const matches = lines.map((line, i) => ({ i, tag: parseTags(line)[0] })).filter(item => item.tag?.tag === name);
  if (matches.length !== 1 || matches[0].tag.confidence !== confidence) throw new Error('The expression changed since it was shown. Refresh and try again.');
  const attributeNames = new Set([...FRAMING_TAGS, ...POSE_TAGS, ...MORPHOLOGY_TAGS, 'AIGenerated'].map(s => s.toLowerCase()));
  for (let i = 0; i < lines.length; i++) {
    const tag = parseTags(lines[i])[0]; if (!tag) continue;
    if (i === matches[0].i) {
      if (!tag.confirmed && !/(?:UNCONFIRMED|DISCONFIRMED)(?=\s*(?:,|$))/i.test(lines[i])) throw new Error('This expression cannot be confirmed automatically.');
      lines[i] = lines[i].replace(/(?:UNCONFIRMED|DISCONFIRMED)(?=\s*(?:,|$))/i, 'CONFIRMED');
    } else if (tag.confirmed && !attributeNames.has(tag.tag.toLowerCase())) {
      if (!/CONFIRMED(?=\s*(?:,|$))/i.test(lines[i])) throw new Error('An existing confirmation cannot be updated safely.');
      lines[i] = lines[i].replace(/CONFIRMED(?=\s*(?:,|$))/i, 'UNCONFIRMED');
    }
  }
  const after = lines.join(''); const destination = destinations[0].path;
  if (photo.category === EXPRESSION_INBOX) return fileInboxPhoto(photoPath, destination, { before, after });
  if (destination === photo.category) { if (after !== before) writeFileSafely(sidecar, after); clearExpressionIndex(); return { path: photoPath }; }
  const plan = previewExpressionChange(photoPath, destination);
  const result = applyExpressionChange(photoPath, destination, plan.token, { before, after });
  return { path: result.changes[0].to! };
}
