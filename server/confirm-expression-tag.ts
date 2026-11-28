import fs from 'node:fs';
import path from 'node:path';
import { safeResolve } from './config.js';
import { REMOVED_LINE, allThreeAIsAgreed, clearExpressionIndex, expressionIndex, isExpressionPhoto, parseRemovedTags, parseTags } from './expressions.js';
import { writeFileSafely } from './files.js';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from './expression-attribute-vocabulary.js';

/** Confirm an existing suggestion without changing its score or any other tags. */
export function confirmExpressionTag(photoPath: string, name: string, confidence: unknown): void {
  const photo = isExpressionPhoto(photoPath);
  if (!photo || !name || (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)))) throw new Error('That photo or tag is not available.');
  const sidecarPath = photoPath.slice(0, -path.extname(photoPath).length) + '.txt';
  const sidecar = safeResolve('expressions', sidecarPath);
  if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
  const text = fs.readFileSync(sidecar, 'utf8');
  const lines = text.split(/(?<=\n)/);
  const matching = lines.map((line, i) => ({ i, tag: parseTags(line)[0] ?? parseRemovedTags(line)[0] })).filter(item => item.tag?.tag === name);
  if (matching.length !== 1 || matching[0].tag.confidence !== confidence) throw new Error('The tag changed since it was shown. Refresh and try again.');
  if (matching[0].tag.confirmed && !matching[0].tag.removed) return;
  const index = matching[0].i;
  const line = lines[index].replace(/^#\s*Removed:\s*/i, '');
  if (!/(?:UNCONFIRMED|DISCONFIRMED)(?=\s*(?:,|$))/i.test(line)) throw new Error('This tag cannot be confirmed automatically.');
  lines[index] = line.replace(/(?:UNCONFIRMED|DISCONFIRMED)(?=\s*(?:,|$))/i, 'CONFIRMED');
  writeFileSafely(sidecar, lines.join(''));
  clearExpressionIndex();
}

/** Record that an attribute does not apply; keep its score and model details. */
export function disconfirmExpressionTag(photoPath: string, name: string, confidence: unknown, confirmed: unknown, disconfirmed: unknown): void {
  const photo = isExpressionPhoto(photoPath);
  if (!photo || !name || typeof confirmed !== 'boolean' || typeof disconfirmed !== 'boolean' || (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)))) throw new Error('That photo or tag is not available.');
  const sidecar = safeResolve('expressions', photoPath.slice(0, -path.extname(photoPath).length) + '.txt');
  if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file.');
  const lines = fs.readFileSync(sidecar, 'utf8').split(/(?<=\n)/);
  const matching = lines.map((line, i) => ({ i, tag: parseTags(line)[0] ?? parseRemovedTags(line)[0] })).filter(item => item.tag?.tag === name);
  const match = matching[0];
  if (matching.length !== 1 || match.tag.confidence !== confidence || match.tag.confirmed !== confirmed || !!match.tag.disconfirmed !== disconfirmed) throw new Error('The tag changed since it was shown. Refresh and try again.');
  if (match.tag.disconfirmed && !match.tag.removed) return;
  const line = lines[match.i].replace(/^#\s*Removed:\s*/i, '');
  if (!/(?:UNCONFIRMED|CONFIRMED)(?=\s*(?:,|$))/i.test(line)) throw new Error('This tag cannot be disconfirmed automatically.');
  lines[match.i] = line.replace(/(?:UNCONFIRMED|CONFIRMED)(?=\s*(?:,|$))/i, 'DISCONFIRMED');
  writeFileSafely(sidecar, lines.join('')); clearExpressionIndex();
}

/** Remove exactly the tag the user reviewed; keep a "# Removed:" record when all three AIs had agreed on it. */
export function removeExpressionTag(photoPath: string, name: string, confidence: unknown, confirmed: unknown): void {
  const photo = isExpressionPhoto(photoPath);
  if (!photo || !name || typeof confirmed !== 'boolean' || (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)))) throw new Error('That photo or tag is not available.');
  const sidecar = safeResolve('expressions', photoPath.slice(0, -path.extname(photoPath).length) + '.txt');
  if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
  const lines = fs.readFileSync(sidecar, 'utf8').split(/(?<=\n)/);
  const matching = lines.map((line, i) => ({ i, tag: parseTags(line)[0] })).filter(item => item.tag?.tag === name);
  if (matching.length !== 1 || matching[0].tag.confidence !== confidence || matching[0].tag.confirmed !== confirmed) throw new Error('The tag changed since it was shown. Refresh and try again.');
  if (allThreeAIsAgreed(matching[0].tag)) lines[matching[0].i] = `# Removed: ${lines[matching[0].i]}`;
  else lines.splice(matching[0].i, 1);
  writeFileSafely(sidecar, lines.join(''));
  clearExpressionIndex();
}

/** Add a confirmed attribute from the appropriate existing vocabulary. */
export function addExpressionTag(photoPath: string, name: string, group: unknown = 'expression'): void {
  // The category names come from the library list kept for up to 30 seconds; the photo is looked up directly.
  const index = expressionIndex();
  const photo = isExpressionPhoto(photoPath);
  const category = index.categories.find(c => c.path && c.name.toLowerCase() === name.trim().toLowerCase());
  const vocabulary = group === 'framing' ? FRAMING_TAGS : group === 'pose' ? POSE_TAGS : group === 'morphology' ? MORPHOLOGY_TAGS : null;
  const canonical = group === 'expression' ? category?.name : vocabulary?.find(tag => tag.toLowerCase() === name.trim().toLowerCase());
  if (!photo || !canonical) throw new Error('Choose an existing attribute in the selected group.');
  const sidecar = safeResolve('expressions', photoPath.slice(0, -path.extname(photoPath).length) + '.txt');
  let text = ''; let exists = false;
  try {
    if (!fs.lstatSync(sidecar).isFile()) throw new Error('The tag file must be a real file, not a shortcut.');
    text = fs.readFileSync(sidecar, 'utf8'); exists = true;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (parseTags(text).some(tag => tag.tag.toLowerCase() === canonical.toLowerCase())) throw new Error('This attribute is already on the photo.');
  const kept = text.split(/(?<=\n)/).filter(line => !REMOVED_LINE.test(line.trim()) || parseRemovedTags(line)[0]?.tag.toLowerCase() !== canonical.toLowerCase()).join('');
  const newline = kept.includes('\r\n') ? '\r\n' : '\n';
  const updated = kept + (kept && !kept.endsWith('\n') ? newline : '') + `${canonical}, N/A, CONFIRMED${newline}`;
  if (exists) writeFileSafely(sidecar, updated); else fs.writeFileSync(sidecar, updated, { flag: 'wx' });
  clearExpressionIndex();
}
